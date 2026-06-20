/**
 * POST /api/demo/seed — seed the demo "paycheck" into the Available bucket.
 * Body: { amount?: number (default 2000), reset?: boolean (zero all buckets first) }
 * Returns: { portfolio }
 *
 * Lets the demo start from a believable balance ("I get paid $2k on the 1st")
 * without needing real on-chain USDC.
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
    const reset = Boolean(body?.reset);
    // A reset is a full demo restart: clear the chat history too.
    if (reset) resetConversation();
    const portfolio = await seedDemoPaycheck(amount, reset);
    return NextResponse.json({ portfolio });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
