/**
 * POST /api/chat — talk to your money (REAL backend).
 * Body: { message: string, userId?, mode? }   (frontend contract)
 * Returns: ChatResponse { assistantMessage, actions, portfolio, events, automations?, riskScore?, why? }
 *
 * Runs the live Claude tool-use loop (lib/agent), which acts on the real CDP
 * wallet + Fetch agents, then maps the turn onto the frontend contract.
 */
import { NextRequest, NextResponse } from "next/server";
import { runAgent } from "@/lib/agent";
import { toChatResponse } from "@/lib/adapter";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth();
    if (session.response) return session.response;

    const body = await req.json();
    const message = typeof body?.message === "string" ? body.message : "";
    if (!message.trim()) {
      return NextResponse.json({ error: "A message is required." }, { status: 400 });
    }
    const turn = await runAgent(message, session.userId);
    return NextResponse.json(await toChatResponse(turn, session.userId));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
