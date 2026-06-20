/**
 * GET /api/events — realtime event feed (frontend contract).
 * Returns: { events: WalletEvent[] }  (newest-first)
 */
import { NextResponse } from "next/server";
import { getEventsSince } from "@/lib/redis";
import { toWalletEvents } from "@/lib/adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const events = await getEventsSince(0);
    return NextResponse.json({ events: toWalletEvents(events) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
