/**
 * POST /api/demo/reset — full demo restart.
 * Zeros all buckets, clears chat history, then seeds a fresh 2000 USDC paycheck.
 * Body: { amount?: number } — override the seed amount (default 2000).
 * Returns: { portfolio }
 */
import { NextRequest, NextResponse } from "next/server";
import { seedDemoPaycheck } from "@/lib/redis";
import { resetConversation } from "@/lib/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const amount = Number(body?.amount ?? 2000) || 2000;
    resetConversation();
    const portfolio = await seedDemoPaycheck(amount, true);
    return NextResponse.json({ portfolio });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
