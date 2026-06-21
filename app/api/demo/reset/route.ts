/**
 * POST /api/demo/reset — full demo restart.
 * Zeros all buckets, clears chat history, then syncs Available to the real CDP
 * wallet's on-chain USDC balance.
 * Returns: { portfolio }
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
    const portfolio = await syncLedgerToOnChainBalance(onChainUsdc);
    return NextResponse.json({ portfolio });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
