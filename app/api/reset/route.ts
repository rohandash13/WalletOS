/**
 * POST /api/reset — full demo restart (REAL backend).
 * Zeros the bucket ledger, clears the Claude conversation, then syncs Available to
 * the authed user's real on-chain CDP wallet balance (USDC × $1,000 scale).
 * Returns: { ok: true }
 */
import { NextResponse } from "next/server";
import { syncLedgerToOnChainBalance } from "@/lib/redis";
import { resetConversation } from "@/lib/agent";
import { getWallet } from "@/lib/wallet";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const session = await requireAuth();
    if (session.response) return session.response;

    resetConversation(session.userId);
    const onChainUsdc = await getWallet().getUsdcBalance();
    await syncLedgerToOnChainBalance(onChainUsdc, session.userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
