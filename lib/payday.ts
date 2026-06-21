import { getWallet } from "./wallet";
import {
  addTx,
  addAutomation,
  addPendingApproval,
  getPortfolio,
  getStoredPolicy,
  listAutomations,
  moveBetweenBuckets,
  publishEvent,
  setBucket,
} from "./redis";
import { USER_ID, BUCKET_LABELS, type Automation, type TxRecord } from "./wallet-types";
import { executeTool } from "./tools";
import { toChainUsdc, scaleLabel } from "./money";

const USDC = "usdc" as const;
const PAYROLL_ACCOUNT_NAME = process.env.CDP_PAYROLL_ACCOUNT_NAME ?? "walletos-payroll";

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForPayrollBalance(required: number, timeoutMs = 90_000): Promise<number> {
  const wallet = getWallet();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const balance = await wallet.getUsdcBalanceForAccount(PAYROLL_ACCOUNT_NAME);
    if (balance >= required) return balance;
    await sleep(3_000);
  }
  return wallet.getUsdcBalanceForAccount(PAYROLL_ACCOUNT_NAME);
}

async function fundPayrollIfNeeded(required: number): Promise<string[]> {
  const wallet = getWallet();
  const txs: string[] = [];
  const balance = await wallet.getUsdcBalanceForAccount(PAYROLL_ACCOUNT_NAME);
  const missing = Math.max(0, required - balance);
  if (missing <= 0.000001) return txs;

  try {
    txs.push(await wallet.requestFaucetForAccount(PAYROLL_ACCOUNT_NAME, "eth"));
  } catch {
    // Payroll may already have gas or the faucet may be cooling down.
  }

  const requestsNeeded = Math.ceil(missing);
  for (let i = 0; i < requestsNeeded; i += 1) {
    txs.push(await wallet.requestFaucetForAccount(PAYROLL_ACCOUNT_NAME, "usdc"));
  }

  const finalBalance = await waitForPayrollBalance(required);
  if (finalBalance < required) {
    throw new Error(
      `Payroll wallet has ${finalBalance} test USDC, needs ${required}. CDP faucet may be rate-limited.`,
    );
  }
  return txs;
}

function automationAmount(a: Automation, grossPay: number): number | undefined {
  if (a.percent != null && Number.isFinite(a.percent)) {
    return Math.round(grossPay * (a.percent / 100) * 100) / 100;
  }
  if (a.amount != null && Number.isFinite(a.amount)) return a.amount;
  return undefined;
}

async function runProtectBucket(a: Automation, grossPay: number, userId: string): Promise<string> {
  const amount = automationAmount(a, grossPay);
  if (!amount || !a.bucket) return "Skipped incomplete protected-bucket rule";
  const p = await getPortfolio(userId);
  if (p.available < amount) return `Skipped ${amount}: only ${p.available} Available`;
  await moveBetweenBuckets("available", a.bucket, amount, userId);
  await publishEvent("portfolio", `Payday reserved ${amount} into ${BUCKET_LABELS[a.bucket]}`, {
    bucket: a.bucket,
    delta: amount,
  }, userId);
  return `Reserved ${amount} into ${BUCKET_LABELS[a.bucket]}`;
}

async function runAutoSave(a: Automation, grossPay: number, userId: string): Promise<string> {
  const amount = automationAmount(a, grossPay);
  if (!amount) return "Skipped incomplete auto-save rule";
  const p = await getPortfolio(userId);
  if (p.available < amount) return `Skipped ${amount}: only ${p.available} Available`;
  await moveBetweenBuckets("available", "savings", amount, userId);
  await publishEvent("portfolio", `Payday auto-saved ${amount} to Savings`, {
    bucket: "savings",
    delta: amount,
  }, userId);
  return `Auto-saved ${amount} to Savings`;
}

async function deferForApproval(
  kind: "transfer" | "invest",
  fields: { amount: number; to?: string; riskScore?: number; note?: string },
  threshold: number,
  userId: string,
): Promise<string> {
  await addPendingApproval(
    {
      id: genId("appr"),
      kind,
      amount: fields.amount,
      to: fields.to,
      riskScore: fields.riskScore,
      note: fields.note,
      createdAt: Date.now(),
    },
    userId,
  );
  const label = fields.note ? `${fields.note} ` : "";
  await publishEvent(
    "message",
    `Approval needed: ${label}$${fields.amount} is over your $${threshold} limit — approve it to ${kind === "transfer" ? "send" : "invest"}.`,
    undefined,
    userId,
  );
  return `Pending your approval: $${fields.amount}${fields.to ? ` to ${fields.to}` : ""}`;
}

async function runRecurringTransfer(
  a: Automation,
  grossPay: number,
  userId: string,
  threshold: number,
): Promise<string> {
  const amount = automationAmount(a, grossPay);
  if (!amount || !a.to) return "Skipped incomplete transfer rule";
  const note = a.note ?? "Payday automation";
  if (amount > threshold) {
    return deferForApproval("transfer", { amount, to: a.to, note }, threshold, userId);
  }
  const result = await executeTool("send_payment", { to: a.to, amount, note }, { userId });
  if (!result.ok) return `Transfer failed: ${JSON.stringify(result.result)}`;
  return `Sent ${amount} to ${a.to}`;
}

async function runRecurringInvest(
  a: Automation,
  grossPay: number,
  userId: string,
  threshold: number,
): Promise<string> {
  const amount = automationAmount(a, grossPay);
  if (!amount) return "Skipped incomplete invest rule";
  if (amount > threshold) {
    return deferForApproval("invest", { amount, riskScore: 3, note: a.note ?? "Invest leftover" }, threshold, userId);
  }
  const result = await executeTool("route_to_agent", { amount, riskScore: 3 }, { userId });
  if (!result.ok) return `Invest failed: ${JSON.stringify(result.result)}`;
  return `Invested ${amount}`;
}

async function executeAutomation(
  a: Automation,
  grossPay: number,
  userId: string,
  threshold: number,
): Promise<string> {
  // Internal reallocations (protect, auto-save) are safe and always run; only
  // outflows/at-risk moves (transfer, invest) over the threshold need approval.
  if (a.type === "protect_bucket") return runProtectBucket(a, grossPay, userId);
  if (a.type === "recurring_transfer") return runRecurringTransfer(a, grossPay, userId, threshold);
  if (a.category === "auto_save") return runAutoSave(a, grossPay, userId);
  if (a.category === "recurring_invest") return runRecurringInvest(a, grossPay, userId, threshold);
  return `Recorded rule not executable on payday: ${a.category ?? a.type}`;
}

export async function processPayday({
  amount = 2000,
  autoFundPayroll = true,
  userId = USER_ID,
}: {
  amount?: number;
  autoFundPayroll?: boolean;
  userId?: string;
} = {}) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Invalid paycheck amount: ${amount}`);
  }

  const wallet = getWallet();
  const userAddress = await wallet.getAddress();
  const chainAmount = toChainUsdc(amount);

  // Best-effort on-chain payroll settlement: fund payroll + transfer to the user
  // wallet if we can. If the faucet is rate-limited or gas is missing, the paycheck
  // still lands in the ledger so the demo keeps working; a real tx hash is recorded
  // only when settlement succeeds.
  const fundingTxs: string[] = [];
  let txHash: string | undefined;
  let explorerUrl: string | undefined;
  let settledOnChain = 0;
  try {
    if (autoFundPayroll) fundingTxs.push(...(await fundPayrollIfNeeded(chainAmount)));
    const payrollBalance = await wallet.getUsdcBalanceForAccount(PAYROLL_ACCOUNT_NAME);
    if (payrollBalance >= chainAmount) {
      const transfer = await wallet.sendUsdcFromAccount(PAYROLL_ACCOUNT_NAME, userAddress, chainAmount);
      txHash = transfer.transactionHash;
      explorerUrl = transfer.explorerUrl;
      settledOnChain = chainAmount;
    }
  } catch {
    /* on-chain payroll settlement skipped — paycheck still credits the ledger */
  }

  const tx: TxRecord = {
    id: genId("payday"),
    kind: txHash ? "on_chain" : "internal",
    type: "deposit",
    amount,
    token: USDC,
    from: PAYROLL_ACCOUNT_NAME,
    to: userAddress,
    toBucket: "available",
    txHash,
    explorerUrl,
    note: `Paycheck deposit (${scaleLabel()}${txHash ? `; ${chainAmount} test USDC on-chain` : ""})`,
    status: "confirmed",
    ts: Date.now(),
  };
  await addTx(tx, userId);
  await publishEvent("tx", `Paycheck landed: $${amount.toLocaleString("en-US")}`, {
    ...tx,
    settledOnChain,
    scale: scaleLabel(),
  }, userId);

  const before = await getPortfolio(userId);
  const available = Math.round((before.available + amount) * 100) / 100;
  await setBucket("available", available, userId);
  await publishEvent("portfolio", `Paycheck deposit: +$${amount.toLocaleString("en-US")} to Available`, {
    bucket: "available",
    delta: amount,
    balance: available,
    settledOnChain,
    scale: scaleLabel(),
  }, userId);

  const policy = await getStoredPolicy(userId);
  const threshold = policy?.approvalThreshold ?? Number.POSITIVE_INFINITY;

  const automations = (await listAutomations(50, userId)).filter((a) => a.active);
  const ordered = [
    ...automations.filter((a) => a.type === "protect_bucket"),
    ...automations.filter((a) => a.type === "recurring_transfer"),
    ...automations.filter((a) => a.category === "auto_save"),
    ...automations.filter((a) => a.category === "recurring_invest"),
    ...automations.filter(
      (a) =>
        a.type !== "protect_bucket" &&
        a.type !== "recurring_transfer" &&
        a.category !== "auto_save" &&
        a.category !== "recurring_invest",
    ),
  ];

  const automationResults: string[] = [];
  for (const automation of ordered) {
    automationResults.push(await executeAutomation(automation, amount, userId, threshold));
  }

  await publishEvent("message", `Payday processed. ${automationResults.join(" ")}`.trim(), {
    amount,
    settledOnChain,
    scale: scaleLabel(),
    automationResults,
  }, userId);

  return {
    ok: true,
    amount,
    settledOnChain,
    scale: scaleLabel(),
    payrollAccount: PAYROLL_ACCOUNT_NAME,
    userAddress,
    txHash,
    explorerUrl,
    fundingTxs,
    automationResults,
    portfolio: await getPortfolio(userId),
  };
}

export async function createPaycheckAutomation({
  category,
  amount,
  percent,
  to,
  bucket,
  note,
  userId = USER_ID,
}: {
  category: "auto_save" | "recurring_invest" | "paycheck_split";
  amount?: number;
  percent?: number;
  to?: string;
  bucket?: Automation["bucket"];
  note?: string;
  userId?: string;
}) {
  const automation: Automation = {
    id: genId("auto"),
    type: "rule",
    category,
    amount,
    percent,
    to,
    bucket,
    schedule: "payday",
    note,
    active: true,
    createdAt: Date.now(),
  };
  await addAutomation(automation, userId);
  await publishEvent("automation", `Automation set up: ${note ?? category}`, automation, userId);
  return automation;
}
