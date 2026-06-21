/**
 * POST /api/payment/send — direct rail test (bypasses the agent).
 * Body: { to: string, amount: number, note?: string, fromBucket?: BucketId }
 * Returns the send_payment tool result, or 400 on policy violation / bad input.
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
    const outcome = await executeTool("send_payment", body ?? {}, {
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
