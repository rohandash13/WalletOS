/**
 * POST /api/agent/route — route funds to an investing agent by risk score.
 * Body: { agent?: string, amount: number, riskScore: number }
 * Returns the route_to_agent tool result.
 */
import { NextRequest, NextResponse } from "next/server";
import { executeTool } from "@/lib/tools";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth();
    if (session.response) return session.response;

    const body = await req.json();
    const outcome = await executeTool("route_to_agent", body ?? {}, {
      userId: session.userId,
    });
    if (!outcome.ok) {
      return NextResponse.json(outcome.result, { status: 400 });
    }
    return NextResponse.json(outcome.result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
