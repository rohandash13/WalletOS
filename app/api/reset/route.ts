/**
 * POST /api/reset — full demo restart (REAL backend).
 * Zeros the bucket ledger, clears the Claude conversation, then syncs Available
 * to the real CDP wallet's on-chain USDC balance. Returns: { ok: true }
 */
import { NextResponse } from "next/server";
import { syncLedgerToOnChainBalance } from "@/lib/redis";
import { resetConversation } from "@/lib/agent";
import { getWallet } from "@/lib/wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    resetConversation();
    const onChainUsdc = await getWallet().getUsdcBalance();
    await syncLedgerToOnChainBalance(onChainUsdc);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
