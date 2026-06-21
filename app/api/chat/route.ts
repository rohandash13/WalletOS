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
import { getStoredPolicy } from "@/lib/redis";
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

    // Onboarding gate: no chatting (and no assumed spending limit) until the user
    // has set an approval threshold. The frontend also disables the composer until
    // onboarding is done; this enforces it on the server too.
    const policy = await getStoredPolicy(session.userId);
    if (policy?.approvalThreshold == null) {
      return NextResponse.json(
        { error: "Complete onboarding (risk score and approval limit) before chatting." },
        { status: 400 },
      );
    }

    const fast = body?.fast === true;
    const turn = await runAgent(message, session.userId, { fast });
    return NextResponse.json(await toChatResponse(turn, session.userId));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
