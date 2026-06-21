/**
 * POST /api/payday
 *
 * Simulates time advancing to payday while keeping the money rail real:
 * a CDP payroll wallet sends scaled Base Sepolia test USDC into the user's CDP
 * wallet, then saved automations execute against that new income.
 */
import { NextRequest, NextResponse } from "next/server";
import { processPayday } from "@/lib/payday";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth();
    if (session.response) return session.response;

    const body = await req.json().catch(() => ({}));
    const amount = Number(body?.amount ?? 2000) || 2000;
    const autoFundPayroll = body?.autoFundPayroll !== false;
    return NextResponse.json(
      await processPayday({ amount, autoFundPayroll, userId: session.userId }),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
