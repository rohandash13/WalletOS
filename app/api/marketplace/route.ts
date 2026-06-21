/**
 * GET  /api/marketplace — list marketplace agents (built-in roster + user-created)
 *   with live status. Returns: { agents: [...] }
 * POST /api/marketplace — create an agent on the fly from a plain-English goal.
 *   Body: { goal: string }   Returns: the created agent.
 */
import { NextRequest, NextResponse } from "next/server";
import { allAgents, previewApy } from "@/lib/marketplace";
import { createAgentFromGoal } from "@/lib/agent-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function pingOnline(endpoint?: string): Promise<boolean> {
  if (!endpoint) return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${endpoint}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

export async function GET() {
  const agents = await allAgents();
  const withStatus = await Promise.all(
    agents.map(async (a) => ({
      id: a.id,
      title: a.title,
      description: a.description,
      riskBand: a.riskBand,
      minAmount: a.minAmount,
      kind: a.kind,
      dynamic: !!a.dynamic,
      strategy: a.plan?.strategy,
      projectedApy: a.kind === "invest" ? previewApy(a) : undefined,
      // Dynamic agents run on the shared engine (always available); built-ins ping.
      online: a.dynamic ? true : await pingOnline(a.endpoint),
    })),
  );
  return NextResponse.json({ agents: withStatus });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const goal = typeof body?.goal === "string" ? body.goal.trim() : "";
    if (!goal) {
      return NextResponse.json({ error: "A goal is required." }, { status: 400 });
    }
    const agent = await createAgentFromGoal(goal);
    return NextResponse.json({ agent });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
