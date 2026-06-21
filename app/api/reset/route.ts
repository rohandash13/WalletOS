/**
 * POST /api/reset — full demo restart (REAL backend).
 * Zeros the bucket ledger, clears the Claude conversation, then reseeds a fresh
 * $5,000 opening balance into Available for the authed user. Returns: { ok: true }
 */
import { NextResponse } from "next/server";
import { seedDemoPaycheck } from "@/lib/redis";
import { resetConversation } from "@/lib/agent";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const session = await requireAuth();
    if (session.response) return session.response;

    resetConversation(session.userId);
    await seedDemoPaycheck(5000, true, session.userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
