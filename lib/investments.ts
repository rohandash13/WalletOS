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
  agentAddress: string;
  explorerUrl: string;
}

export interface InvestmentsSnapshot {
  totalInvested: number;
  totalOnChainValue: number;
  scale: string;
  agents: AgentInvestment[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function getInvestments(): Promise<InvestmentsSnapshot> {
  const txs = await listTxs(500);
  const routes = txs.filter((t) => t.type === "route_to_agent");

  // Aggregate principal per agent (fall back to the destination address for
  // older txs recorded before agentId was tracked).
  type Agg = { principal: number; count: number; last: number; title: string };
  const byAgent = new Map<string, Agg>();
  for (const t of routes) {
    const key = t.agentId ?? t.to;
    const title = (t.note?.split(" · ")[0] ?? key).trim();
    const cur = byAgent.get(key) ?? { principal: 0, count: 0, last: 0, title };
    cur.principal = round2(cur.principal + t.amount);
    cur.count += 1;
    cur.last = Math.max(cur.last, t.ts);
    byAgent.set(key, cur);
  }

  const roster = await allAgents();
  const wallet = getWallet();

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
        agentAddress,
        explorerUrl: agentAddress ? wallet.addressUrl(agentAddress) : "",
      };
    }),
  );

  agents.sort((a, b) => b.invested - a.invested);

  return {
    totalInvested: round2(agents.reduce((s, a) => s + a.invested, 0)),
    totalOnChainValue: round2(agents.reduce((s, a) => s + a.onChainValue, 0)),
    scale: scaleLabel(),
    agents,
  };
}
