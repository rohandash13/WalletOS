/**
 * GET /api/balance — real wallet balance + bucket ledger (frontend contract).
 * Returns: BalanceResponse { walletAddress, network, asset, walletBalance, buckets, updatedAt }
 */
import { NextResponse } from "next/server";
import { getBalanceSnapshot } from "@/lib/tools";
import { toBalanceResponse } from "@/lib/adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await getBalanceSnapshot();
    return NextResponse.json(toBalanceResponse(snapshot));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
