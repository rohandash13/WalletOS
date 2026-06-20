/**
 * lib/marketplace.ts — the Fetch AI uAgent marketplace, from the backend's side.
 *
 * A risk-tiered registry of specialized investing agents plus risk/amount gating
 * (which agent a given risk score + balance routes to), and the HTTP call into a
 * uAgent's /route endpoint. If the Python service is down, we fall back to identical
 * local strategy math so the backend is always functional.
 *
 * All investing agents settle into the logical `stable_invest` ("Invested") bucket;
 * the reserve agent settles into `rent`. Agents differ by strategy + risk tier, not
 * by bucket — so the marketplace can grow (incl. user-created agents) without adding
 * buckets.
 */

import type { BucketId } from "./wallet-types";
import { listDynamicAgents, type StoredAgent } from "./redis";

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
    description: "Liquid, capital-preserving savings with no lockup. Capital first.",
    endpoint: process.env.SAVINGS_AGENT_URL ?? "http://127.0.0.1:8002",
    riskBand: [1, 2],
    minAmount: 0,
    kind: "invest",
    bucket: "stable_invest",
  },
  {
    id: "stable_invest",
    title: "Stable-Invest",
    description: "Stablecoin yield + tokenized T-bills with a small growth sleeve.",
    endpoint: process.env.STABLE_INVEST_AGENT_URL ?? "http://127.0.0.1:8001",
    riskBand: [3, 4],
    minAmount: 0,
    kind: "invest",
    bucket: "stable_invest",
  },
  {
    id: "balanced_growth",
    title: "Balanced-Growth",
    description: "A balanced mix of stable yield and blue-chip staking for steady growth.",
    endpoint: process.env.BALANCED_GROWTH_AGENT_URL ?? "http://127.0.0.1:8004",
    riskBand: [5, 6],
    minAmount: 0,
    kind: "invest",
    bucket: "stable_invest",
  },
  {
    id: "growth",
    title: "Growth",
    description: "Blue-chip crypto + DeFi liquidity for higher returns and volatility.",
    endpoint: process.env.GROWTH_AGENT_URL ?? "http://127.0.0.1:8005",
    riskBand: [7, 8],
    minAmount: 500,
    kind: "invest",
    bucket: "stable_invest",
  },
  {
    id: "high_yield",
    title: "High-Yield",
    description: "Aggressive DeFi yield farming + momentum. High risk, high potential.",
    endpoint: process.env.HIGH_YIELD_AGENT_URL ?? "http://127.0.0.1:8006",
    riskBand: [9, 10],
    minAmount: 1000,
    kind: "invest",
    bucket: "stable_invest",
  },
  {
    id: "bill_pay",
    title: "Bill-Pay",
    description: "A liquid reserve that guarantees your scheduled bills never bounce.",
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

/** Representative APY for display (built-ins compute at route time). */
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

/** Local mirror of agent-service/strategies.py — keeps the backend self-sufficient. */
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
      explanation: `Placed ${amount} USDC with ${agent.title} (~${agent.plan.projectedApy}% projected APY).`,
      live: false,
    };
  }

  let allocation: Record<string, number>;
  let apy: number;
  let strategy: string;

  switch (agent.id) {
    case "savings":
      allocation = { stablecoin_yield: 0.85, tokenized_tbills: 0.15 };
      apy = round2(3 + r * 0.15);
      strategy = "Liquid preservation — instant-access stablecoin savings";
      break;
    case "balanced_growth": {
      const stable = Math.max(0.35, 0.7 - r * 0.04);
      allocation = {
        stablecoin_yield: round2(stable),
        blue_chip_staking: round2((1 - stable) * 0.6),
        defi_liquidity: round2((1 - stable) * 0.4),
      };
      apy = round2(6 + r * 0.8);
      strategy = "Balanced stable yield + blue-chip staking for steady growth";
      break;
    }
    case "growth": {
      const blue = Math.min(0.6, 0.3 + r * 0.04);
      allocation = {
        blue_chip_staking: round2(blue),
        defi_liquidity: round2((1 - blue) * 0.6),
        stablecoin_yield: round2((1 - blue) * 0.4),
      };
      apy = round2(9 + r * 1.2);
      strategy = "Blue-chip crypto + DeFi liquidity for higher growth";
      break;
    }
    case "high_yield":
      allocation = {
        defi_yield_farming: 0.55,
        momentum_basket: 0.3,
        blue_chip_staking: 0.15,
      };
      apy = round2(12 + r * 1.6);
      strategy = "Aggressive DeFi yield farming + momentum basket";
      break;
    case "bill_pay":
      allocation = { liquid_reserve: 1 };
      apy = 0;
      strategy = "Liquid reserve earmarked for scheduled bills";
      break;
    case "stable_invest":
    default: {
      const stable = Math.max(0.4, 1 - r * 0.06);
      const rest = (1 - stable) / 2;
      allocation = {
        stablecoin_yield: round2(stable),
        tokenized_tbills: round2(rest),
        blue_chip_staking: round2(rest),
      };
      apy = round2(3.5 + r * 0.55);
      strategy = "Capital-preservation core with a small risk-scaled growth sleeve";
      break;
    }
  }

  return {
    accepted: true,
    agent: agent.id,
    strategy,
    allocation,
    projectedApy: apy,
    explanation: `Placed ${amount} USDC with ${agent.title} at ${r}/10 risk — ${strategy.toLowerCase()}. ~${apy}% APY.`,
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
