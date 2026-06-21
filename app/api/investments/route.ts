/**
 * GET /api/investments — track funds after they've been invested by agents.
 * Returns per-agent invested principal, the real on-chain balance held in each
 * agent's wallet (scaled to demo dollars), and projected yearly growth.
 * Returns: InvestmentsSnapshot { totalInvested, totalOnChainValue, scale, agents[] }
 */
import { NextResponse } from "next/server";
import { getInvestments } from "@/lib/investments";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireAuth();
    if (session.response) return session.response;

    return NextResponse.json(await getInvestments(session.userId));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
