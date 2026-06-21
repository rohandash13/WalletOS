/**
 * GET /api/events — realtime event feed (frontend contract).
 * Returns: { events: WalletEvent[] }  (newest-first)
 */
import { NextResponse } from "next/server";
import { getEventsSince } from "@/lib/redis";
import { toWalletEvents } from "@/lib/adapter";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireAuth();
    if (session.response) return session.response;

    const events = await getEventsSince(0, 100, session.userId);
    return NextResponse.json({ events: toWalletEvents(events) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
