/**
 * POST /api/demo/reset — full demo restart.
 * Zeros all buckets, clears chat history, then seeds a fresh $5,000 opening balance.
 * Body: { amount?: number } — override the seed amount (default 5000).
 * Returns: { portfolio }
 */
import { NextRequest, NextResponse } from "next/server";
import { seedDemoPaycheck } from "@/lib/redis";
import { resetConversation } from "@/lib/agent";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth();
    if (session.response) return session.response;

    const body = await req.json().catch(() => ({}));
    const amount = Number(body?.amount ?? 5000) || 5000;
    resetConversation(session.userId);
    const portfolio = await seedDemoPaycheck(amount, true, session.userId);
    return NextResponse.json({ portfolio });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
