/**
 * POST /api/reset — full demo restart (REAL backend).
 * Zeros the bucket ledger, clears the Claude conversation, reseeds a $2,000
 * paycheck into Available. Returns: { ok: true }
 */
import { NextResponse } from "next/server";
import { seedDemoPaycheck } from "@/lib/redis";
import { resetConversation } from "@/lib/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    resetConversation();
    await seedDemoPaycheck(2000, true);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
