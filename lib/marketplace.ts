/**
 * lib/marketplace.ts — the Fetch AI uAgent marketplace, from the backend's side.
 *
 * A risk-tiered registry of investing agents plus risk/amount gating (which agent a
 * given risk score + balance routes to), and the HTTP call into a uAgent's /route
 * endpoint. If the Python service is down, we fall back to identical local strategy
 * math so the backend is always functional.
 *
 * Everything is described in plain, everyday language (no crypto jargon) — the goal
 * is financial literacy for everyone. Allocations use four simple buckets:
 *   safe_savings · steady_growth · higher_growth · cash_reserve
 *
 * All investing agents settle into the logical `stable_invest` ("Invested") bucket;
 * the reserve agent settles into `rent`. Agents differ by strategy + risk tier, not
 * by bucket — so the marketplace can grow (incl. user-created agents) without adding
 * buckets.
 */

import { createHash } from "node:crypto";
import type { BucketId } from "./wallet-types";
import { listDynamicAgents, type StoredAgent } from "./redis";

/**
 * Deterministic CDP account name for an agent's wallet.
 *
 * CDP account names must be alphanumeric + hyphens, 2–36 chars. Built-in agent
 * ids stay readable (e.g. `walletos-agent-stable-invest`); user-created ids can be
 * long, so anything over the limit falls back to a stable hash of the id. The
 * mapping is deterministic so routing AND balance tracking resolve the same wallet.
 */
export function agentAccountName(agentId: string): string {
  const base = "walletos-agent-";
  const sanitized = agentId.replace(/_/g, "-").replace(/[^a-zA-Z0-9-]/g, "");
  const name = `${base}${sanitized}`;
  if (name.length >= 2 && name.length <= 36) return name;
  const hash = createHash("sha1").update(agentId).digest("hex").slice(0, 12);
  return `${base}${hash}`; // 15 + 12 = 27 chars, within limit
}

export interface MarketplaceAgent {
  id: string;
  title: string;
  description: string;
  /** Base URL of the uAgent's REST server (built-ins only). */
  endpoint?: string;
  /** Inclusive risk band this agent serves (1=conservative .. 10=aggressive). */
  riskBand: [number, number];
  /** Minimum amount (USDC) required to unlock this agent. */
  minAmount: number;
  /** "invest" agents are auto-selected by risk; "reserve" agents only on request. */
  kind: "invest" | "reserve";
  /** Portfolio bucket funds land in. */
  bucket: BucketId;
  /** True for runtime/user-created agents (served by the local strategy engine). */
  dynamic?: boolean;
  /** Stored strategy for dynamic agents (no live uAgent process). */
  plan?: { strategy: string; allocation: Record<string, number>; projectedApy: number };
}

export const AGENTS: MarketplaceAgent[] = [
  {
    id: "savings",
    title: "Savings",
    description: "Keeps your money safe and easy to reach, with a little growth.",
    endpoint: process.env.SAVINGS_AGENT_URL ?? "http://127.0.0.1:8002",
    riskBand: [1, 2],
    minAmount: 0,
    kind: "invest",
    bucket: "stable_invest",
  },
  {
    id: "stable_invest",
    title: "Stable-Invest",
    description: "Steady, low-risk growth that aims to beat a regular savings account.",
    endpoint: process.env.STABLE_INVEST_AGENT_URL ?? "http://127.0.0.1:8001",
    riskBand: [3, 4],
    minAmount: 0,
    kind: "invest",
    bucket: "stable_invest",
  },
  {
    id: "balanced_growth",
    title: "Balanced-Growth",
    description: "A balanced mix of safe and growing money for steady progress.",
    endpoint: process.env.BALANCED_GROWTH_AGENT_URL ?? "http://127.0.0.1:8004",
    riskBand: [5, 6],
    minAmount: 0,
    kind: "invest",
    bucket: "stable_invest",
  },
  {
    id: "growth",
    title: "Growth",
    description: "Aims for higher growth over time, with more ups and downs.",
    endpoint: process.env.GROWTH_AGENT_URL ?? "http://127.0.0.1:8005",
    riskBand: [7, 8],
    minAmount: 500,
    kind: "invest",
    bucket: "stable_invest",
  },
  {
    id: "high_yield",
    title: "High-Yield",
    description: "The highest growth potential — higher risk and bigger swings.",
    endpoint: process.env.HIGH_YIELD_AGENT_URL ?? "http://127.0.0.1:8006",
    riskBand: [9, 10],
    minAmount: 1000,
    kind: "invest",
    bucket: "stable_invest",
  },
  {
    id: "bill_pay",
    title: "Bill-Pay",
    description: "Sets aside money so your bills are always covered.",
    endpoint: process.env.BILL_PAY_AGENT_URL ?? "http://127.0.0.1:8003",
    riskBand: [1, 10],
    minAmount: 0,
    kind: "reserve",
    bucket: "rent",
  },
];

/** Turn a persisted dynamic agent into a MarketplaceAgent. */
function fromStored(a: StoredAgent): MarketplaceAgent {
  return {
    id: a.id,
    title: a.title,
    description: a.description,
    riskBand: a.riskBand,
    minAmount: a.minAmount,
    kind: a.kind,
    bucket: a.kind === "reserve" ? "rent" : "stable_invest",
    dynamic: true,
    plan: { strategy: a.strategy, allocation: a.allocation, projectedApy: a.projectedApy },
  };
}

/** All agents: built-in roster + any user-created agents from the registry. */
export async function allAgents(): Promise<MarketplaceAgent[]> {
  const dynamic = (await listDynamicAgents()).map(fromStored);
  return [...AGENTS, ...dynamic];
}

export function getAgent(id: string): MarketplaceAgent | undefined {
  return AGENTS.find((a) => a.id === id);
}

export async function resolveAgent(id: string): Promise<MarketplaceAgent | undefined> {
  return (await allAgents()).find((a) => a.id === id);
}

/**
 * Risk + amount gating: pick the investing agent for a risk score, honoring an
 * explicit (unlocked) preference. Higher risk routes to a more aggressive tier, but
 * only if the balance clears that tier's minimum — otherwise it steps down to the
 * best tier the amount can access.
 */
export function selectAgent(
  riskScore: number,
  amount: number,
  preferredId?: string,
): MarketplaceAgent {
  const r = Math.max(1, Math.min(10, Math.round(riskScore)));
  if (preferredId) {
    const pref = getAgent(preferredId);
    if (pref && amount >= pref.minAmount) return pref;
  }
  const invest = AGENTS.filter((a) => a.kind === "invest");

  // Primary: the tier whose band contains the risk score and the amount unlocks.
  const tier = invest.find(
    (a) => r >= a.riskBand[0] && r <= a.riskBand[1] && amount >= a.minAmount,
  );
  if (tier) return tier;

  // Locked by amount (or no exact tier): best eligible lower tier the amount allows.
  const eligible = invest
    .filter((a) => amount >= a.minAmount && a.riskBand[0] <= r)
    .sort((a, b) => b.riskBand[1] - a.riskBand[1]);
  return eligible[0] ?? getAgent("stable_invest")!;
}

/** Representative est. yearly growth for display (built-ins compute at route time). */
export function previewApy(agent: MarketplaceAgent): number {
  if (agent.plan) return agent.plan.projectedApy;
  const mid = Math.round((agent.riskBand[0] + agent.riskBand[1]) / 2);
  return localPlan(agent, Math.max(agent.minAmount, 100), mid).projectedApy;
}

export interface RoutePlan {
  accepted: boolean;
  agent: string;
  strategy: string;
  allocation: Record<string, number>;
  projectedApy: number;
  explanation: string;
  /** true if the live uAgent answered; false if we used the local fallback. */
  live: boolean;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Local mirror of agent-service/strategies.py — plain-language, no jargon. */
function localPlan(agent: MarketplaceAgent, amount: number, riskScore: number): RoutePlan {
  const r = Math.max(1, Math.min(10, Math.round(riskScore)));

  // Dynamic agents carry their own stored strategy.
  if (agent.dynamic && agent.plan) {
    return {
      accepted: true,
      agent: agent.id,
      strategy: agent.plan.strategy,
      allocation: agent.plan.allocation,
      projectedApy: agent.plan.projectedApy,
      explanation: `I put ${amount} USDC into ${agent.title} (aiming for about ${agent.plan.projectedApy}% a year).`,
      live: false,
    };
  }

  let allocation: Record<string, number>;
  let apy: number;
  let strategy: string;
  let explanation: string;

  switch (agent.id) {
    case "savings":
      allocation = { safe_savings: 0.9, steady_growth: 0.1 };
      apy = round2(3 + r * 0.15);
      strategy = "Keeps your money safe and easy to reach, earning a little extra.";
      explanation = `I put ${amount} USDC into Savings — safe, easy to access, earning about ${apy}% a year with no lock-up.`;
      break;
    case "balanced_growth": {
      const safe = round2(Math.max(0.3, 0.55 - r * 0.03));
      allocation = {
        safe_savings: safe,
        steady_growth: round2((1 - safe) * 0.7),
        higher_growth: round2((1 - safe) * 0.3),
      };
      apy = round2(6 + r * 0.8);
      strategy = "A balanced mix of safe and growing money for steady progress.";
      explanation = `I put ${amount} USDC into Balanced-Growth — a mix of safe and growing money for steady progress. About ${apy}% a year, with some ups and downs.`;
      break;
    }
    case "growth": {
      const higher = round2(Math.min(0.6, 0.3 + r * 0.04));
      allocation = {
        higher_growth: higher,
        steady_growth: round2((1 - higher) * 0.7),
        safe_savings: round2((1 - higher) * 0.3),
      };
      apy = round2(9 + r * 1.2);
      strategy = "Aims for higher growth over time, with more ups and downs.";
      explanation = `I put ${amount} USDC into Growth — aiming for higher returns over time. Expect more ups and downs. About ${apy}% a year.`;
      break;
    }
    case "high_yield":
      allocation = { higher_growth: 0.8, steady_growth: 0.2 };
      apy = round2(12 + r * 1.6);
      strategy = "The highest growth potential — higher risk and bigger swings.";
      explanation = `I put ${amount} USDC into High-Yield — the most aggressive option, aiming for the highest growth. Big swings, so keep only money you won't need soon here. About ${apy}% a year.`;
      break;
    case "bill_pay":
      allocation = { cash_reserve: 1 };
      apy = 0;
      strategy = "Sets aside money so your bills are always covered.";
      explanation = `I set aside ${amount} USDC with Bill-Pay so your scheduled bills are always covered and never bounce.`;
      break;
    case "stable_invest":
    default: {
      const safe = round2(Math.max(0.5, 1 - r * 0.08));
      allocation = { safe_savings: safe, steady_growth: round2(1 - safe) };
      apy = round2(3.5 + r * 0.55);
      strategy = "Steady, low-risk growth that beats a regular savings account.";
      explanation = `I put ${amount} USDC into Stable-Invest — mostly safe holdings with a little steady growth. Low ups and downs, about ${apy}% a year.`;
      break;
    }
  }

  return {
    accepted: true,
    agent: agent.id,
    strategy,
    allocation,
    projectedApy: apy,
    explanation,
    live: false,
  };
}

/**
 * Ask a uAgent to route funds. Calls its REST /route with a short timeout; on any
 * failure (or for dynamic agents with no process), returns the local plan so the
 * demo never breaks.
 */
export async function routeViaAgent(
  agent: MarketplaceAgent,
  amount: number,
  riskScore: number,
  userId = "demo",
): Promise<RoutePlan> {
  if (!agent.endpoint || agent.dynamic) return localPlan(agent, amount, riskScore);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${agent.endpoint}/route`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount, risk_score: riskScore, user_id: userId }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`agent ${agent.id} returned ${res.status}`);
    const data = await res.json();
    return {
      accepted: !!data.accepted,
      agent: data.agent ?? agent.id,
      strategy: data.strategy,
      allocation: data.allocation ?? {},
      projectedApy: Number(data.projected_apy ?? 0),
      explanation: data.explanation ?? "",
      live: true,
    };
  } catch {
    return localPlan(agent, amount, riskScore);
  }
}
