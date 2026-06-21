/**
 * lib/adapter.ts — maps the REAL backend's internal shapes onto the frontend's
 * JSON contract (lib/types.ts), so the UI runs unchanged on the real
 * Claude + CDP + Fetch backend.
 *
 * Bucket reconciliation: the backend ledger uses `available/rent/savings/
 * stable_invest`; the UI renders each bucket separately.
 *   available     -> checking (Available)
 *   savings       -> savings  (Savings; funded by auto-save rules)
 *   rent          -> rent_safe (Protected)
 *   stable_invest -> stable_invest (Invested)
 */

import type {
  Portfolio as LedgerPortfolio,
  AppEvent,
  Automation as LedgerAutomation,
  EventType,
} from "./wallet-types";
import { USER_ID } from "./wallet-types";
import type {
  Portfolio as UiPortfolio,
  Bucket,
  WalletEvent,
  Automation as UiAutomation,
  Action,
  ChatResponse,
  BalanceResponse,
} from "./types";
import type { AgentTurn, AgentToolCall } from "./agent";
import { getPortfolio, getEventsSince, listAutomations, getStoredPolicy } from "./redis";
import { getBalanceSnapshot, automationLabel } from "./tools";

const round = (n: number) => Math.round(n * 1e6) / 1e6;

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/* ------------------------------- portfolio -------------------------------- */

export function toUiPortfolio(p: LedgerPortfolio): UiPortfolio {
  return {
    checking: round(p.available),
    savings: round(p.savings),
    rent_safe: round(p.rent),
    family_payment: 0,
    stable_invest: round(p.stable_invest),
  };
}

export function toBuckets(p: LedgerPortfolio): Bucket[] {
  const ui = toUiPortfolio(p);
  return [
    { name: "Available", key: "checking", balance: ui.checking, protected: false },
    { name: "Savings", key: "savings", balance: ui.savings, protected: false },
    { name: "Protected", key: "rent_safe", balance: ui.rent_safe, protected: true },
    { name: "Invested", key: "stable_invest", balance: ui.stable_invest, protected: false },
  ];
}

/* -------------------------------- balance --------------------------------- */

type Snapshot = Awaited<ReturnType<typeof getBalanceSnapshot>>;

export function toBalanceResponse(snap: Snapshot): BalanceResponse {
  const buckets = toBuckets(snap.portfolio);
  return {
    walletAddress: snap.address,
    network: "base-sepolia",
    asset: "USD",
    walletBalance: round(buckets.reduce((sum, b) => sum + b.balance, 0)),
    buckets,
    updatedAt: new Date().toISOString(),
  };
}

/* --------------------------------- events --------------------------------- */

const EVENT_TYPE_MAP: Record<EventType, WalletEvent["type"]> = {
  tx: "payment_confirmed",
  portfolio: "portfolio_updated",
  policy: "policy_updated",
  automation: "automation_created",
  agent: "agent_routed",
  message: "explanation_ready",
};

export function toWalletEvent(e: AppEvent): WalletEvent {
  const data = asRecord(e.data);
  return {
    id: String(e.id),
    type: EVENT_TYPE_MAP[e.type],
    message: e.summary,
    status: "confirmed",
    txHash: str(data.txHash),
    explorerUrl: str(data.explorerUrl),
    createdAt: new Date(e.ts).toISOString(),
  };
}

/** Newest-first, for the "Live activity" feed. */
export function toWalletEvents(events: AppEvent[]): WalletEvent[] {
  return [...events]
    .filter((e) => {
      // Hide the on-chain balance-sync events (from reset) — they're plumbing.
      const data = asRecord(e.data);
      const isBalanceSync =
        e.type === "portfolio" &&
        (e.summary === "Balance refreshed" ||
          e.summary.toLowerCase().startsWith("synced ")) &&
        data.onChainUsdc != null;
      return !isBalanceSync;
    })
    .sort((a, b) => b.id - a.id)
    .map(toWalletEvent);
}

/* ------------------------------ automations ------------------------------- */

function nextRun(a: LedgerAutomation): string {
  const now = new Date();
  if ((a.schedule ?? "").toLowerCase().includes("month")) {
    return new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
  }
  return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
}

export function toUiAutomation(a: LedgerAutomation): UiAutomation {
  return {
    id: a.id,
    name: automationLabel(a),
    status: a.active ? "active" : "paused",
    nextRunAt: nextRun(a),
    explanation: a.note ?? "Runs automatically on schedule.",
  };
}

/* -------------------------------- actions --------------------------------- */

export function toActions(toolCalls: AgentToolCall[]): Action[] {
  const actions: Action[] = [];
  for (const call of toolCalls) {
    const input = asRecord(call.input);
    const result = asRecord(call.result);
    const status: Action["status"] = call.ok ? "confirmed" : "failed";
    switch (call.name) {
      case "send_payment":
        actions.push({
          type: "send_payment",
          status,
          amount: Number(result.amount ?? input.amount) || undefined,
          asset: "USD",
          txHash: str(result.transactionHash),
          explorerUrl: str(result.explorerUrl),
        });
        break;
      case "route_to_agent":
        actions.push({
          type: "route_to_agent",
          status,
          amount: Number(result.amount ?? input.amount) || undefined,
          asset: "USD",
          agentName: str(result.title) ?? "Stable-Invest",
          txHash: str(result.txHash),
          explorerUrl: str(result.explorerUrl),
        });
        break;
      case "rebalance_funds":
        actions.push({
          type: "rebalance_funds",
          status,
          amount: Number(result.amount ?? input.amount) || undefined,
          asset: "USD",
        });
        break;
      case "set_policy":
        actions.push({ type: "policy_updated", status });
        break;
      case "create_automation":
        actions.push({
          type: "automation_created",
          status,
          amount: Number(input.amount) || undefined,
        });
        break;
      // get_balance / explain_decision are not user-facing actions.
    }
  }
  return actions;
}

function extractRisk(toolCalls: AgentToolCall[]): number | undefined {
  // An explicit set_policy this turn is the strongest signal (latest wins).
  for (let i = toolCalls.length - 1; i >= 0; i--) {
    const c = toolCalls[i];
    if (c.name === "set_policy") {
      const r = Number(asRecord(c.input).riskScore);
      if (Number.isFinite(r)) return Math.max(1, Math.min(10, Math.round(r)));
    }
  }
  for (const c of toolCalls) {
    if (c.name === "route_to_agent") {
      const r = Number(asRecord(c.input).riskScore);
      if (Number.isFinite(r)) return r;
    }
  }
  return undefined;
}

function normalizeRisk(n: number): number | undefined {
  if (!Number.isFinite(n)) return undefined;
  return Math.max(1, Math.min(10, Math.round(n)));
}

/** Pull a risk score the user stated in plain text, so the badge updates live. */
export function extractRiskFromText(text: string): number | undefined {
  const patterns = [
    /(\d{1,2})\s*(?:\/|out of)\s*10/i, // "3 out of 10", "3/10"
    /\brisk\b[^.]{0,30}?\b(?:to|at|of)\s+(\d{1,2})\b/i, // "risk ... set it to 3"
    /\bset\s+(?:it|my\s+risk|risk)?\s*(?:to|at)\s+(\d{1,2})\b/i, // "set it to 3"
    /(?:risk|comfort)[^\d]{0,20}(\d{1,2})/i, // "risk score 3"
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const score = match ? normalizeRisk(Number(match[1])) : undefined;
    if (score != null) return score;
  }
  if (/\blow[-\s]?risk\b|\bconservative\b/i.test(text)) return 3;
  if (/\bmedium[-\s]?risk\b|\bmoderate\b|\bbalanced\b/i.test(text)) return 5;
  if (/\bhigh[-\s]?risk\b|\baggressive\b/i.test(text)) return 8;
  return undefined;
}

function extractWhy(toolCalls: AgentToolCall[]): string | undefined {
  // Last explain_decision summary wins.
  for (let i = toolCalls.length - 1; i >= 0; i--) {
    if (toolCalls[i].name === "explain_decision") {
      const s = str(asRecord(toolCalls[i].input).summary);
      if (s) return s;
    }
  }
  return undefined;
}

/* ---------------------------------- chat ---------------------------------- */

export async function toChatResponse(
  turn: AgentTurn,
  userId: string = USER_ID,
  userText?: string,
): Promise<ChatResponse> {
  const [portfolio, events, autos, policy] = await Promise.all([
    getPortfolio(userId),
    getEventsSince(0, 100, userId),
    listAutomations(50, userId),
    getStoredPolicy(userId),
  ]);
  // Prefer a risk score the agent acted on this turn (set_policy/route_to_agent),
  // then one the user stated in text, then the persisted value — so saying
  // "set my risk to 3" mid-chat updates the badge and it stays put afterward.
  const riskScore =
    extractRisk(turn.toolCalls) ??
    (userText ? extractRiskFromText(userText) : undefined) ??
    policy?.riskScore;
  return {
    assistantMessage: turn.reply,
    actions: toActions(turn.toolCalls),
    portfolio: toUiPortfolio(portfolio),
    buckets: toBuckets(portfolio),
    events: toWalletEvents(events),
    automations: autos.map(toUiAutomation),
    riskScore,
    approvalThreshold: policy?.approvalThreshold,
    why: extractWhy(turn.toolCalls) ?? turn.reply,
  };
}
