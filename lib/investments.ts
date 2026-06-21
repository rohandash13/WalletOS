/**
 * lib/investments.ts — track funds AFTER they've been invested by an agent.
 *
 * Once route_to_agent settles money into an agent's own CDP wallet, this is how the
 * user follows it: per-agent invested principal (summed from the route_to_agent tx
 * ledger), the REAL on-chain balance sitting in each agent's wallet (scaled to demo
 * dollars), and the projected yearly growth at the agent's APY. Read-only — it never
 * moves money.
 */

import { listTxs } from "./redis";
import { getWallet } from "./wallet";
import { toDemoUsd, scaleLabel } from "./money";
import { allAgents, agentAccountName, previewApy } from "./marketplace";
import { USER_ID } from "./wallet-types";

export interface AgentInvestment {
  agentId: string;
  title: string;
  /** Total demo-dollar principal routed to this agent. */
  invested: number;
  /** Number of route_to_agent transactions. */
  txCount: number;
  /** Timestamp (ms) of the most recent route. */
  lastRoutedAt: number;
  /** Real USDC currently held in the agent's on-chain wallet. */
  onChainUsdc: number;
  /** That on-chain balance expressed in demo dollars. */
  onChainValue: number;
  /** Agent's projected annual yield (%). */
  projectedApy: number;
  /** Estimated growth over a year on the invested principal. */
  projectedAnnualGrowth: number;
  /**
   * Simulated current value: each deposit compounded at the agent's APY over the
   * time it's been held. Testnet has no real yield, so this is an illustrative
   * projection, not realized earnings.
   */
  currentValue: number;
  /** currentValue - invested (simulated gain so far). */
  gain: number;
  /** Simulated gain as a percent of principal. */
  gainPct: number;
  agentAddress: string;
  explorerUrl: string;
}

export interface InvestmentsSnapshot {
  totalInvested: number;
  totalOnChainValue: number;
  totalCurrentValue: number;
  totalGain: number;
  scale: string;
  agents: AgentInvestment[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export async function getInvestments(userId: string = USER_ID): Promise<InvestmentsSnapshot> {
  const txs = await listTxs(500, userId);
  const routes = txs.filter((t) => t.type === "route_to_agent");

  // Aggregate per agent (fall back to the destination address for older txs
  // recorded before agentId was tracked). Keep each deposit's timestamp so growth
  // can be compounded from when that money was actually put to work.
  type Agg = {
    principal: number;
    count: number;
    last: number;
    title: string;
    deposits: { amount: number; ts: number }[];
  };
  const byAgent = new Map<string, Agg>();
  for (const t of routes) {
    const key = t.agentId ?? t.to;
    const title = (t.note?.split(" · ")[0] ?? key).trim();
    const cur = byAgent.get(key) ?? { principal: 0, count: 0, last: 0, title, deposits: [] };
    cur.principal = round2(cur.principal + t.amount);
    cur.count += 1;
    cur.last = Math.max(cur.last, t.ts);
    cur.deposits.push({ amount: t.amount, ts: t.ts });
    byAgent.set(key, cur);
  }

  const roster = await allAgents();
  const wallet = getWallet();
  const now = Date.now();

  const agents: AgentInvestment[] = await Promise.all(
    [...byAgent.entries()].map(async ([agentId, agg]) => {
      const meta = roster.find((a) => a.id === agentId);
      const apy = meta ? previewApy(meta) : 0;
      const name = agentAccountName(agentId);

      let onChainUsdc = 0;
      let agentAddress = "";
      try {
        agentAddress = await wallet.resolveAddress(name);
        onChainUsdc = await wallet.getUsdcBalanceForAccount(name);
      } catch {
        /* wallet not reachable — report principal only */
      }

      // Simulated growth: compound each deposit at the agent's APY over its hold time.
      const currentValue = round2(
        agg.deposits.reduce((s, d) => {
          const years = Math.max(0, (now - d.ts) / YEAR_MS);
          return s + d.amount * Math.pow(1 + apy / 100, years);
        }, 0),
      );
      const gain = round2(currentValue - agg.principal);

      return {
        agentId,
        title: meta?.title ?? agg.title,
        invested: agg.principal,
        txCount: agg.count,
        lastRoutedAt: agg.last,
        onChainUsdc,
        onChainValue: toDemoUsd(onChainUsdc),
        projectedApy: apy,
        projectedAnnualGrowth: round2((agg.principal * apy) / 100),
        currentValue,
        gain,
        gainPct: agg.principal > 0 ? Math.round((gain / agg.principal) * 10000) / 100 : 0,
        agentAddress,
        explorerUrl: agentAddress ? wallet.addressUrl(agentAddress) : "",
      };
    }),
  );

  agents.sort((a, b) => b.invested - a.invested);

  return {
    totalInvested: round2(agents.reduce((s, a) => s + a.invested, 0)),
    totalOnChainValue: round2(agents.reduce((s, a) => s + a.onChainValue, 0)),
    totalCurrentValue: round2(agents.reduce((s, a) => s + a.currentValue, 0)),
    totalGain: round2(agents.reduce((s, a) => s + a.gain, 0)),
    scale: scaleLabel(),
    agents,
  };
}
