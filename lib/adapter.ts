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
import { getPortfolio, getEventsSince, listAutomations } from "./redis";
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
  return [...events].sort((a, b) => b.id - a.id).map(toWalletEvent);
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
  for (const c of toolCalls) {
    if (c.name === "route_to_agent") {
      const r = Number(asRecord(c.input).riskScore);
      if (Number.isFinite(r)) return r;
    }
  }
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
): Promise<ChatResponse> {
  const [portfolio, events, autos] = await Promise.all([
    getPortfolio(userId),
    getEventsSince(0, 100, userId),
    listAutomations(50, userId),
  ]);
  return {
    assistantMessage: turn.reply,
    actions: toActions(turn.toolCalls),
    portfolio: toUiPortfolio(portfolio),
    buckets: toBuckets(portfolio),
    events: toWalletEvents(events),
    automations: autos.map(toUiAutomation),
    riskScore: extractRisk(turn.toolCalls),
    why: extractWhy(turn.toolCalls) ?? turn.reply,
  };
}
