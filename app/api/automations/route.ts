/**
 * GET  /api/automations — list active automations (frontend contract).
 *   Returns: { automations: Automation[] }
 * POST /api/automations — create one (passthrough to the real tool).
 *   Body: { type, amount?, to?, schedule?, bucket?, note? }
 */
import { NextRequest, NextResponse } from "next/server";
import { listAutomations } from "@/lib/redis";
import { executeTool } from "@/lib/tools";
import { toUiAutomation } from "@/lib/adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const autos = await listAutomations();
    return NextResponse.json({ automations: autos.map(toUiAutomation) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const outcome = await executeTool("create_automation", body ?? {});
    if (!outcome.ok) {
      return NextResponse.json(outcome.result, { status: 400 });
    }
    return NextResponse.json(outcome.result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
