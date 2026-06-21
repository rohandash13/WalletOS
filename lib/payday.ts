import { getWallet } from "./wallet";
import {
  addTx,
  addAutomation,
  getPortfolio,
  listAutomations,
  moveBetweenBuckets,
  publishEvent,
  setBucket,
} from "./redis";
import { BUCKET_LABELS, type Automation, type TxRecord } from "./wallet-types";
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

async function runProtectBucket(a: Automation, grossPay: number): Promise<string> {
  const amount = automationAmount(a, grossPay);
  if (!amount || !a.bucket) return "Skipped incomplete protected-bucket rule";
  const p = await getPortfolio();
  if (p.available < amount) return `Skipped ${amount}: only ${p.available} Available`;
  await moveBetweenBuckets("available", a.bucket, amount);
  await publishEvent("portfolio", `Payday reserved ${amount} into ${BUCKET_LABELS[a.bucket]}`, {
    bucket: a.bucket,
    delta: amount,
  });
  return `Reserved ${amount} into ${BUCKET_LABELS[a.bucket]}`;
}

async function runAutoSave(a: Automation, grossPay: number): Promise<string> {
  const amount = automationAmount(a, grossPay);
  if (!amount) return "Skipped incomplete auto-save rule";
  const p = await getPortfolio();
  if (p.available < amount) return `Skipped ${amount}: only ${p.available} Available`;
  await moveBetweenBuckets("available", "savings", amount);
  await publishEvent("portfolio", `Payday auto-saved ${amount} to Savings`, {
    bucket: "savings",
    delta: amount,
  });
  return `Auto-saved ${amount} to Savings`;
}

async function runRecurringTransfer(a: Automation, grossPay: number): Promise<string> {
  const amount = automationAmount(a, grossPay);
  if (!amount || !a.to) return "Skipped incomplete transfer rule";
  const result = await executeTool("send_payment", {
    to: a.to,
    amount,
    note: a.note ?? "Payday automation",
  });
  if (!result.ok) return `Transfer failed: ${JSON.stringify(result.result)}`;
  return `Sent ${amount} to ${a.to}`;
}

async function runRecurringInvest(a: Automation, grossPay: number): Promise<string> {
  const amount = automationAmount(a, grossPay);
  if (!amount) return "Skipped incomplete invest rule";
  const result = await executeTool("route_to_agent", {
    amount,
    riskScore: 3,
  });
  if (!result.ok) return `Invest failed: ${JSON.stringify(result.result)}`;
  return `Invested ${amount}`;
}

async function executeAutomation(a: Automation, grossPay: number): Promise<string> {
  if (a.type === "protect_bucket") return runProtectBucket(a, grossPay);
  if (a.type === "recurring_transfer") return runRecurringTransfer(a, grossPay);
  if (a.category === "auto_save") return runAutoSave(a, grossPay);
  if (a.category === "recurring_invest") return runRecurringInvest(a, grossPay);
  return `Recorded rule not executable on payday: ${a.category ?? a.type}`;
}

export async function processPayday({
  amount = 2000,
  autoFundPayroll = true,
}: {
  amount?: number;
  autoFundPayroll?: boolean;
} = {}) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Invalid paycheck amount: ${amount}`);
  }

  const wallet = getWallet();
  const userAddress = await wallet.getAddress();
  const chainAmount = toChainUsdc(amount);

  const fundingTxs = autoFundPayroll ? await fundPayrollIfNeeded(chainAmount) : [];
  const payrollBalance = await wallet.getUsdcBalanceForAccount(PAYROLL_ACCOUNT_NAME);
  if (payrollBalance < chainAmount) {
    throw new Error(
      `Payroll wallet has ${payrollBalance} test USDC, needs ${chainAmount} (${scaleLabel()})`,
    );
  }

  const transfer = await wallet.sendUsdcFromAccount(PAYROLL_ACCOUNT_NAME, userAddress, chainAmount);

  const tx: TxRecord = {
    id: genId("payday"),
    kind: "on_chain",
    type: "deposit",
    amount,
    token: USDC,
    from: PAYROLL_ACCOUNT_NAME,
    to: userAddress,
    toBucket: "available",
    txHash: transfer.transactionHash,
    explorerUrl: transfer.explorerUrl,
    note: `Paycheck deposit (${scaleLabel()}; ${chainAmount} test USDC on-chain)`,
    status: "confirmed",
    ts: Date.now(),
  };
  await addTx(tx);
  await publishEvent("tx", `Paycheck landed: $${amount.toLocaleString("en-US")}`, {
    ...tx,
    settledOnChain: chainAmount,
    scale: scaleLabel(),
  });

  const before = await getPortfolio();
  const available = Math.round((before.available + amount) * 100) / 100;
  await setBucket("available", available);
  await publishEvent("portfolio", `Paycheck deposit: +$${amount.toLocaleString("en-US")} to Available`, {
    bucket: "available",
    delta: amount,
    balance: available,
    settledOnChain: chainAmount,
    scale: scaleLabel(),
  });

  const automations = (await listAutomations()).filter((a) => a.active);
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
    automationResults.push(await executeAutomation(automation, amount));
  }

  await publishEvent("message", `Payday processed. ${automationResults.join(" ")}`.trim(), {
    amount,
    settledOnChain: chainAmount,
    scale: scaleLabel(),
    automationResults,
  });

  return {
    ok: true,
    amount,
    settledOnChain: chainAmount,
    scale: scaleLabel(),
    payrollAccount: PAYROLL_ACCOUNT_NAME,
    userAddress,
    txHash: transfer.transactionHash,
    explorerUrl: transfer.explorerUrl,
    fundingTxs,
    automationResults,
    portfolio: await getPortfolio(),
  };
}

export async function createPaycheckAutomation({
  category,
  amount,
  percent,
  to,
  bucket,
  note,
}: {
  category: "auto_save" | "recurring_invest" | "paycheck_split";
  amount?: number;
  percent?: number;
  to?: string;
  bucket?: Automation["bucket"];
  note?: string;
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
  await addAutomation(automation);
  await publishEvent("automation", `Automation set up: ${note ?? category}`, automation);
  return automation;
}
