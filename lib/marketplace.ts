/**
 * lib/marketplace.ts — the Fetch AI uAgent marketplace, from the backend's side.
 *
 * Registry of the specialized sub-agents (Stable-Invest, Savings, Bill-Pay), risk
 * gating (which agent a risk score routes to), and the HTTP call into a uAgent's
 * /route endpoint. If the Python service is down, we fall back to identical local
 * strategy math so the backend is always functional.
 */

import type { BucketId } from "./wallet-types";

export interface MarketplaceAgent {
  id: string;
  title: string;
  description: string;
  /** Base URL of the uAgent's REST server. */
  endpoint: string;
  /** Inclusive risk band this agent serves (1=conservative .. 10=aggressive). */
  riskBand: [number, number];
  /** "invest" agents are auto-selected by risk; "reserve" agents only on request. */
  kind: "invest" | "reserve";
  /** Portfolio bucket funds land in. */
  bucket: BucketId;
}

export const AGENTS: MarketplaceAgent[] = [
  {
    id: "stable_invest",
    title: "Stable-Invest",
    description: "Low-volatility stablecoin yield + tokenized T-bills with a small growth sleeve.",
    endpoint: process.env.STABLE_INVEST_AGENT_URL ?? "http://127.0.0.1:8001",
    riskBand: [1, 5],
    kind: "invest",
    bucket: "stable_invest",
  },
  {
    id: "savings",
    title: "Savings",
    description: "Liquid, capital-preserving savings with no lockup.",
    endpoint: process.env.SAVINGS_AGENT_URL ?? "http://127.0.0.1:8002",
    riskBand: [1, 2],
    kind: "invest",
    bucket: "savings",
  },
  {
    id: "bill_pay",
    title: "Bill-Pay",
    description: "A liquid reserve that guarantees your scheduled bills never bounce.",
    endpoint: process.env.BILL_PAY_AGENT_URL ?? "http://127.0.0.1:8003",
    riskBand: [1, 10],
    kind: "reserve",
    bucket: "rent",
  },
];

export function getAgent(id: string): MarketplaceAgent | undefined {
  return AGENTS.find((a) => a.id === id);
}

/**
 * Risk gating: pick the investing agent for a given risk score, honoring an
 * explicit preference when valid. Lower risk → Savings; moderate → Stable-Invest.
 */
export function selectAgent(riskScore: number, preferredId?: string): MarketplaceAgent {
  if (preferredId) {
    const pref = getAgent(preferredId);
    if (pref) return pref;
  }
  const r = Math.max(1, Math.min(10, Math.round(riskScore)));
  const invest = AGENTS.filter((a) => a.kind === "invest");
  // Most conservative agent whose band covers the score; default Stable-Invest.
  const match = invest
    .filter((a) => r >= a.riskBand[0] && r <= a.riskBand[1])
    .sort((a, b) => a.riskBand[1] - b.riskBand[1])[0];
  return match ?? getAgent("stable_invest")!;
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

/** Local mirror of agent-service/strategies.py — keeps the backend self-sufficient. */
function localPlan(agent: MarketplaceAgent, amount: number, riskScore: number): RoutePlan {
  const r = Math.max(1, Math.min(10, Math.round(riskScore)));
  const round2 = (n: number) => Math.round(n * 100) / 100;
  let allocation: Record<string, number>;
  let apy: number;
  let strategy: string;
  let explanation: string;

  if (agent.id === "stable_invest") {
    const stable = Math.max(0.4, 1 - r * 0.06);
    const rest = (1 - stable) / 2;
    allocation = {
      stablecoin_yield: round2(stable),
      tokenized_tbills: round2(rest),
      blue_chip_staking: round2(rest),
    };
    apy = round2(3.5 + r * 0.55);
    strategy = "Capital-preservation core with a small risk-scaled growth sleeve";
    explanation = `Placed ${amount} USDC with Stable-Invest at ${r}/10 risk — mostly stablecoin yield and tokenized T-bills, small growth sleeve. ~${apy}% APY.`;
  } else if (agent.id === "savings") {
    allocation = { stablecoin_yield: 0.85, tokenized_tbills: 0.15 };
    apy = round2(3 + r * 0.15);
    strategy = "Liquid preservation — instant-access stablecoin savings";
    explanation = `Moved ${amount} USDC into Savings — liquid, capital-preserving, ~${apy}% with no lockup.`;
  } else {
    allocation = { liquid_reserve: 1 };
    apy = 0;
    strategy = "Liquid reserve earmarked for scheduled bills";
    explanation = `Reserved ${amount} USDC with Bill-Pay to cover scheduled obligations, held fully liquid.`;
  }
  return { accepted: true, agent: agent.id, strategy, allocation, projectedApy: apy, explanation, live: false };
}

/**
 * Ask a uAgent to route funds. Calls its REST /route with a short timeout; on any
 * failure, returns the local plan so the demo never breaks.
 */
export async function routeViaAgent(
  agent: MarketplaceAgent,
  amount: number,
  riskScore: number,
  userId = "demo",
): Promise<RoutePlan> {
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
