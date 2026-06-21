/**
 * lib/tools.ts — Claude tool definitions + dispatch.
 *
 * The MCP-style tools Claude is allowed to call. Tool handlers are the ONLY code
 * that touches the wallet + Redis: each money action enforces the spending policy,
 * writes a TxRecord, and publishes a realtime event. The agent (lib/agent.ts) never
 * touches the rail directly — it can only request these tools.
 *
 * All state is per-user (userId), so each authenticated user has an isolated ledger.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { getWallet, PolicyViolationError } from "./wallet";
import {
  getPortfolio,
  adjustBucket,
  moveBetweenBuckets,
  addTx,
  listTxs,
  publishEvent,
  setStoredPolicy,
  getStoredPolicy,
  addAutomation,
} from "./redis";
import {
  USER_ID,
  BUCKETS,
  BUCKET_LABELS,
  type BucketId,
  type TxRecord,
  type Automation,
} from "./wallet-types";
import { selectAgent, resolveAgent, routeViaAgent, agentAccountName } from "./marketplace";
import { toChainUsdc, scaleLabel } from "./money";

const USDC = "usdc" as const;

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isBucket(v: unknown): v is BucketId {
  return typeof v === "string" && (BUCKETS as string[]).includes(v);
}

/**
 * Read the real on-chain balance. Deposits are credited only by explicit payroll
 * or paycheck flows, never as a side effect of viewing balance.
 */
async function reconcile(): Promise<{ usdc: number; eth: number }> {
  const wallet = getWallet();
  const [usdc, eth] = await Promise.all([
    wallet.getUsdcBalance(),
    wallet.getEthBalance(),
  ]);
  return { usdc, eth };
}

/* --------------------------- tool definitions ----------------------------- */

export const tools: Anthropic.Tool[] = [
  {
    name: "get_balance",
    description:
      "Get the wallet's current on-chain USDC and ETH balance plus the per-bucket portfolio (available, rent, savings, stable_invest) and recent transactions. Call this before moving money so you know what is actually available.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "send_payment",
    description:
      "Send a REAL on-chain USDC payment on Base Sepolia to an external address. Enforces the spending policy. Deducts from a bucket (default 'available'). Use for paying a person, e.g. sending money to family.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient 0x address" },
        amount: { type: "number", description: "Amount of USDC to send" },
        note: { type: "string", description: "Optional human-readable memo" },
        fromBucket: {
          type: "string",
          enum: BUCKETS,
          description: "Bucket to debit (default 'available')",
        },
      },
      required: ["to", "amount"],
    },
  },
  {
    name: "set_policy",
    description:
      "Update the user's preferences. Use 'riskScore' (1-10) when the user states or changes their risk tolerance (e.g. 'set my risk to 3', 'I'm a 3 out of 10', 'make me more conservative'). Use 'approvalThreshold' to change the 'approve before moving money' limit when the user asks (e.g. 'approve anything over $200', 'change my limit to $50'). Also supports a hard per-transaction max and a recipient allowlist.",
    input_schema: {
      type: "object",
      properties: {
        riskScore: {
          type: "number",
          description:
            "The user's risk tolerance, 1 (most conservative) to 10 (most aggressive). Set this whenever the user states or changes their risk score.",
        },
        approvalThreshold: {
          type: "number",
          description:
            "Dollar amount at/below which moves auto-run; above it the user must approve. Set this when the user wants to change their approval limit.",
        },
        maxUsdcPerTx: { type: "number", description: "Hard max USDC per single transfer" },
        allowlist: {
          type: "array",
          items: { type: "string" },
          description: "Allowed recipient 0x addresses",
        },
      },
      required: [],
    },
  },
  {
    name: "create_automation",
    description:
      "Create a recurring money rule. 'recurring_transfer' sends an amount to an address on a schedule (e.g. monthly bill or money to family). 'protect_bucket' reserves an amount into a protected bucket (e.g. keep rent safe). 'rule' records any other everyday automation (auto-save from paycheck, invest on a schedule, round-up savings, smart credit-card payment, split paycheck, low-balance alert, subscription watch) — set category accordingly.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["recurring_transfer", "protect_bucket", "rule"] },
        category: {
          type: "string",
          description:
            "Friendly template: bill, family, auto_save, recurring_invest, roundup, smart_card, paycheck_split, low_balance_alert, subscription_watch.",
        },
        amount: { type: "number" },
        percent: { type: "number", description: "For % rules, e.g. save 20% of each paycheck" },
        threshold: { type: "number", description: "For alerts / smart payments (balance threshold)" },
        to: { type: "string", description: "Recipient address (recurring_transfer)" },
        schedule: { type: "string", description: "e.g. 'monthly', 'weekly', or 'monthly:1'" },
        bucket: { type: "string", enum: BUCKETS, description: "Target bucket (protect_bucket)" },
        note: { type: "string" },
      },
      required: ["type"],
    },
  },
  {
    name: "route_to_agent",
    description:
      "Route funds to a specialized Fetch AI marketplace agent based on the user's risk score (1=conservative .. 10=aggressive). The agent is auto-selected by risk AND amount: low risk → Savings/Stable-Invest, mid → Balanced-Growth, high risk with enough funds → Growth (min $500) or High-Yield (min $1000). Omit the agent field to auto-select. This calls the live uAgent for its strategy and makes a real on-chain agent-to-agent USDC transfer. Use for 'invest the rest'.",
    input_schema: {
      type: "object",
      properties: {
        agent: {
          type: "string",
          description:
            "Optional explicit agent — either an id (e.g. savings, stable_invest, balanced_growth, growth, high_yield) OR the agent's display name (e.g. 'Stable-Invest', 'Home Fund Keeper', or any user-created agent's name). Pass this whenever the user names a specific agent. Omit ONLY to auto-select by risk + amount.",
        },
        amount: { type: "number", description: "USDC to route" },
        riskScore: { type: "number", description: "User risk score 1-10" },
      },
      required: ["amount", "riskScore"],
    },
  },
  {
    name: "rebalance_funds",
    description:
      "Move USDC from a holding bucket (stable_invest, savings, or rent) back into Available — e.g. when the user says they need cash back ('I need $200 back'). Internal ledger move, not an external transfer. Defaults to pulling from stable_invest. Avoid touching protected rent unless the user explicitly asks.",
    input_schema: {
      type: "object",
      properties: {
        amount: { type: "number", description: "USDC to move back to Available" },
        fromBucket: {
          type: "string",
          enum: BUCKETS,
          description: "Bucket to pull from (default 'stable_invest')",
        },
      },
      required: ["amount"],
    },
  },
  {
    name: "explain_decision",
    description:
      "Record a plain-English explanation of what you did and why, for the user-facing 'why' panel. Call this last to teach the user about the financial decision.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Plain-English explanation" },
      },
      required: ["summary"],
    },
  },
];

export const toolNames = tools.map((t) => t.name);

/**
 * Apply any persisted spending policy to the wallet singleton. Call once before
 * processing a request so a policy set in a previous run still applies.
 */
export async function hydratePolicy(userId: string = USER_ID): Promise<void> {
  const stored = await getStoredPolicy(userId);
  if (stored) getWallet().setPolicy(stored);
}

/* ------------------------------ dispatch ---------------------------------- */

export interface ToolOutcome {
  ok: boolean;
  result: unknown;
}

export interface ToolContext {
  userId?: string;
}

/**
 * Execute a tool call. Returns a JSON-serializable result that is sent back to
 * Claude as the tool_result. All side effects (rail + ledger + events) happen here.
 */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  context: ToolContext = {},
): Promise<ToolOutcome> {
  try {
    const userId = context.userId ?? USER_ID;
    switch (name) {
      case "get_balance":
        return { ok: true, result: await getBalanceSnapshot(userId) };
      case "send_payment":
        return { ok: true, result: await handleSendPayment(input, userId) };
      case "set_policy":
        return { ok: true, result: await handleSetPolicy(input, userId) };
      case "create_automation":
        return { ok: true, result: await handleCreateAutomation(input, userId) };
      case "route_to_agent":
        return { ok: true, result: await handleRouteToAgent(input, userId) };
      case "rebalance_funds":
        return { ok: true, result: await handleRebalance(input, userId) };
      case "explain_decision":
        return { ok: true, result: await handleExplain(input, userId) };
      default:
        return { ok: false, result: { error: `Unknown tool: ${name}` } };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isPolicy = err instanceof PolicyViolationError;
    return {
      ok: false,
      result: { error: message, kind: isPolicy ? "policy_violation" : "error" },
    };
  }
}

/** Shared balance snapshot used by both the get_balance tool and GET /api/balance. */
export async function getBalanceSnapshot(userId: string = USER_ID) {
  const { usdc, eth } = await reconcile();
  const [portfolio, txs] = await Promise.all([getPortfolio(userId), listTxs(10, userId)]);
  const address = await getWallet().getAddress();
  return { address, onChain: { usdc, eth }, portfolio, recentTransactions: txs };
}

async function handleSendPayment(input: Record<string, unknown>, userId: string) {
  const to = String(input.to ?? "");
  const amount = Number(input.amount);
  const note = input.note ? String(input.note) : undefined;
  const fromBucket: BucketId = isBucket(input.fromBucket) ? input.fromBucket : "available";

  if (!/^0x[a-fA-F0-9]{40}$/.test(to)) {
    throw new Error(`Invalid recipient address: ${to}`);
  }

  const wallet = getWallet();
  // Enforce the spending policy against the full intended (logical) amount.
  const policy = wallet.getPolicy();
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new PolicyViolationError(`Invalid transfer amount: ${amount}`);
  }
  if (amount > policy.maxUsdcPerTx) {
    throw new PolicyViolationError(
      `Transfer of ${amount} USDC exceeds per-tx limit of ${policy.maxUsdcPerTx} USDC`,
    );
  }

  const portfolio = await getPortfolio(userId);
  if (portfolio[fromBucket] < amount) {
    throw new Error(
      `Insufficient ${BUCKET_LABELS[fromBucket]} balance: ${portfolio[fromBucket]} < ${amount}`,
    );
  }

  // Real on-chain settlement only, scaled for the demo economy. User-facing
  // amounts stay in relatable dollars; Base Sepolia moves the scaled test USDC.
  const chainAmount = toChainUsdc(amount);
  const onChainUsdc = await wallet.getUsdcBalance();
  if (onChainUsdc < chainAmount) {
    throw new Error(
      `Insufficient on-chain USDC: ${onChainUsdc} < ${chainAmount} (${scaleLabel()})`,
    );
  }
  const transfer = await wallet.sendUsdc(to, chainAmount);
  const txHash = transfer.transactionHash;
  const explorerUrl = transfer.explorerUrl;

  const newBucket = await adjustBucket(fromBucket, -amount, userId);

  const tx: TxRecord = {
    id: genId("tx"),
    kind: txHash ? "on_chain" : "internal",
    type: "send_payment",
    amount,
    token: USDC,
    from: await wallet.getAddress(),
    to,
    fromBucket,
    txHash,
    explorerUrl,
    note,
    status: "confirmed",
    ts: Date.now(),
  };
  await addTx(tx, userId);

  await publishEvent("tx", `Sent ${amount} USDC${note ? ` (${note})` : ""}`, tx, userId);
  await publishEvent("portfolio", `${BUCKET_LABELS[fromBucket]} → ${newBucket} USDC`, {
    bucket: fromBucket,
    balance: newBucket,
  }, userId);

  return {
    transactionHash: txHash,
    explorerUrl,
    amount,
    settledOnChain: chainAmount,
    scale: scaleLabel(),
    to,
    fromBucket,
    bucketBalance: newBucket,
  };
}

async function handleSetPolicy(input: Record<string, unknown>, userId: string) {
  const patch: { maxUsdcPerTx?: number; allowlist?: string[] } = {};
  if (input.maxUsdcPerTx != null) patch.maxUsdcPerTx = Number(input.maxUsdcPerTx);
  if (Array.isArray(input.allowlist)) {
    patch.allowlist = input.allowlist.map((a) => String(a).toLowerCase());
  }
  getWallet().setPolicy(patch);

  // Persist (incl. the approve-before-moving-money threshold and risk score).
  const stored = (await getStoredPolicy(userId)) ?? {};
  const merged = { ...stored, ...patch };
  let changedThreshold = false;
  let changedRisk = false;
  if (input.approvalThreshold != null) {
    const t = Number(input.approvalThreshold);
    if (Number.isFinite(t) && t >= 0) {
      merged.approvalThreshold = Math.round(t);
      changedThreshold = true;
    }
  }
  if (input.riskScore != null) {
    const r = Number(input.riskScore);
    if (Number.isFinite(r)) {
      merged.riskScore = Math.max(1, Math.min(10, Math.round(r)));
      changedRisk = true;
    }
  }
  await setStoredPolicy(merged, userId);

  const summary = changedRisk
    ? `Risk score updated to ${merged.riskScore}/10`
    : changedThreshold
      ? `Approval limit updated: ask above $${merged.approvalThreshold}`
      : `Policy updated: max ${merged.maxUsdcPerTx} USDC/tx`;
  await publishEvent("policy", summary, merged, userId);
  return merged;
}

async function handleCreateAutomation(input: Record<string, unknown>, userId: string) {
  const type: Automation["type"] =
    input.type === "protect_bucket"
      ? "protect_bucket"
      : input.type === "recurring_transfer"
        ? "recurring_transfer"
        : "rule";
  const automation: Automation = {
    id: genId("auto"),
    type,
    category: input.category ? String(input.category) : undefined,
    amount: input.amount != null ? Number(input.amount) : undefined,
    percent: input.percent != null ? Number(input.percent) : undefined,
    threshold: input.threshold != null ? Number(input.threshold) : undefined,
    to: input.to ? String(input.to) : undefined,
    schedule: input.schedule ? String(input.schedule) : undefined,
    bucket: isBucket(input.bucket) ? input.bucket : undefined,
    note: input.note ? String(input.note) : undefined,
    active: true,
    createdAt: Date.now(),
  };
  await addAutomation(automation, userId);

  const isPaydayRule = automation.schedule?.toLowerCase() === "payday";

  // protect_bucket reserves funds immediately only for immediate rules. Paycheck
  // rules are stored and run when /api/payday lands new income.
  if (type === "protect_bucket" && automation.amount && automation.bucket && !isPaydayRule) {
    const portfolio = await getPortfolio(userId);
    if (portfolio.available < automation.amount) {
      throw new Error(
        `Insufficient Available balance to protect ${automation.amount}: ${portfolio.available} available`,
      );
    }
    await moveBetweenBuckets("available", automation.bucket, automation.amount, userId);
    await publishEvent(
      "portfolio",
      `Reserved ${automation.amount} USDC into ${BUCKET_LABELS[automation.bucket]}`,
      { bucket: automation.bucket, delta: automation.amount },
      userId,
    );
  }

  await publishEvent(
    "automation",
    `Automation set up: ${automationLabel(automation)}`,
    automation,
    userId,
  );
  return automation;
}

/** A short, plain-English label for an automation (shared with the UI mapping). */
export function automationLabel(a: Automation): string {
  const amt = a.amount != null ? `$${a.amount}` : a.percent != null ? `${a.percent}%` : "";
  const when = a.schedule ? ` ${a.schedule}` : "";
  switch (a.category) {
    case "bill":
      return `Pay bill ${amt}${when}`.trim();
    case "family":
      return `Send family ${amt}${when}`.trim();
    case "auto_save":
      return `Auto-save ${amt} each paycheck`.trim();
    case "recurring_invest":
      return `Invest ${amt}${when}`.trim();
    case "roundup":
      return "Round-up savings on purchases";
    case "smart_card":
      return `Pay card in full${a.threshold ? ` unless below $${a.threshold}` : ""}`;
    case "paycheck_split":
      return "Split paycheck into accounts";
    case "low_balance_alert":
      return `Low-balance alert${a.threshold ? ` below $${a.threshold}` : ""}`;
    case "subscription_watch":
      return "Watch for unused subscriptions";
    default:
      if (a.type === "recurring_transfer") return `Send ${amt}${when}`.trim();
      if (a.type === "protect_bucket")
        return `Protect ${amt}${a.bucket ? ` in ${BUCKET_LABELS[a.bucket]}` : ""}`.trim();
      return a.note || "Automation";
  }
}

async function handleRouteToAgent(input: Record<string, unknown>, userId: string) {
  const amount = Number(input.amount);
  const riskScore = Number(input.riskScore);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`Invalid amount: ${amount}`);

  const portfolio = await getPortfolio(userId);
  if (portfolio.available < amount) {
    throw new Error(`Insufficient Available balance: ${portfolio.available} < ${amount}`);
  }

  const preferred = input.agent ? String(input.agent) : undefined;
  const agent =
    (preferred ? await resolveAgent(preferred) : undefined) ??
    selectAgent(Number.isFinite(riskScore) ? riskScore : 5, amount, preferred);

  // 1. Ask the Fetch uAgent for its allocation/decision (local fallback if down).
  const plan = await routeViaAgent(agent, amount, riskScore);

  // 2. Real on-chain agent-to-agent settlement to the agent's CDP wallet.
  const wallet = getWallet();
  const agentAddress = await wallet.resolveAddress(agentAccountName(agent.id));
  const chainAmount = toChainUsdc(amount);
  const onChainUsdc = await wallet.getUsdcBalance();
  if (onChainUsdc < chainAmount) {
    throw new Error(
      `Insufficient on-chain USDC: ${onChainUsdc} < ${chainAmount} (${scaleLabel()})`,
    );
  }
  const transfer = await wallet.sendUsdc(agentAddress, chainAmount);
  const txHash = transfer.transactionHash;
  const explorerUrl = transfer.explorerUrl;

  // 3. Logical ledger move available -> agent's bucket (full amount).
  await moveBetweenBuckets("available", agent.bucket, amount, userId);
  const updated = await getPortfolio(userId);

  const tx: TxRecord = {
    id: genId("tx"),
    kind: txHash ? "on_chain" : "internal",
    type: "route_to_agent",
    amount,
    token: USDC,
    from: await wallet.getAddress(),
    to: agentAddress,
    fromBucket: "available",
    toBucket: agent.bucket,
    agentId: agent.id,
    txHash,
    explorerUrl,
    note: `${agent.title} · risk ${riskScore}/10 · ${plan.strategy}`,
    status: "confirmed",
    ts: Date.now(),
  };
  await addTx(tx, userId);

  await publishEvent(
    "agent",
    `Routed ${amount} USDC to ${agent.title} (risk ${riskScore}/10, ~${plan.projectedApy}% APY)${plan.live ? "" : " [offline strategy]"}`,
    { agent: agent.id, plan, settledOnChain: chainAmount, scale: scaleLabel(), txHash, explorerUrl, agentAddress },
    userId,
  );
  await publishEvent("portfolio", `${BUCKET_LABELS[agent.bucket]} → ${updated[agent.bucket]} USDC`, {
    bucket: agent.bucket,
    balance: updated[agent.bucket],
  }, userId);

  return {
    agent: agent.id,
    title: agent.title,
    amount,
    riskScore,
    strategy: plan.strategy,
    allocation: plan.allocation,
    projectedApy: plan.projectedApy,
    explanation: plan.explanation,
    agentAddress,
    settledOnChain: chainAmount,
    scale: scaleLabel(),
    txHash,
    explorerUrl,
    live: plan.live,
    portfolio: updated,
  };
}

async function handleRebalance(input: Record<string, unknown>, userId: string) {
  const amount = Number(input.amount);
  const fromBucket: BucketId = isBucket(input.fromBucket) ? input.fromBucket : "stable_invest";
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`Invalid amount: ${amount}`);

  const portfolio = await getPortfolio(userId);
  if (portfolio[fromBucket] < amount) {
    throw new Error(
      `Insufficient ${BUCKET_LABELS[fromBucket]} balance: ${portfolio[fromBucket]} < ${amount}`,
    );
  }

  await moveBetweenBuckets(fromBucket, "available", amount, userId);
  const updated = await getPortfolio(userId);

  const tx: TxRecord = {
    id: genId("tx"),
    kind: "internal",
    type: "rebalance",
    amount,
    token: USDC,
    from: BUCKET_LABELS[fromBucket],
    to: BUCKET_LABELS.available,
    fromBucket,
    toBucket: "available",
    note: `Moved ${amount} USDC from ${BUCKET_LABELS[fromBucket]} back to Available`,
    status: "confirmed",
    ts: Date.now(),
  };
  await addTx(tx, userId);

  await publishEvent(
    "portfolio",
    `Moved ${amount} USDC from ${BUCKET_LABELS[fromBucket]} back to Available`,
    { bucket: "available", balance: updated.available, delta: amount },
    userId,
  );

  return { amount, fromBucket, toBucket: "available", portfolio: updated };
}

async function handleExplain(input: Record<string, unknown>, userId: string) {
  const summary = String(input.summary ?? "");
  await publishEvent("message", summary, undefined, userId);
  return { summary };
}
