/**
 * GET  /api/settings  — read the user's spending settings (approval threshold).
 * POST /api/settings  — set the "approve before moving money" threshold.
 *   Body: { approvalThreshold: number }  (demo dollars; <= auto-executes, > asks)
 * Returns: { approvalThreshold, maxUsdcPerTx }
 *
 * Setting an approval threshold raises the hard per-tx cap out of the way, so the
 * conversational approval (the agent asking before large moves) becomes the gate.
 */
import { NextRequest, NextResponse } from "next/server";
import { getStoredPolicy, setStoredPolicy } from "@/lib/redis";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HARD_CAP_WHEN_APPROVAL_SET = 1_000_000;

export async function GET() {
  try {
    const session = await requireAuth();
    if (session.response) return session.response;
    const policy = (await getStoredPolicy(session.userId)) ?? {};
    return NextResponse.json({
      approvalThreshold: policy.approvalThreshold ?? null,
      maxUsdcPerTx: policy.maxUsdcPerTx ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth();
    if (session.response) return session.response;

    const body = await req.json().catch(() => ({}));
    const raw = Number(body?.approvalThreshold);
    if (!Number.isFinite(raw) || raw < 0) {
      return NextResponse.json({ error: "approvalThreshold must be >= 0" }, { status: 400 });
    }
    const approvalThreshold = Math.round(raw);

    const current = (await getStoredPolicy(session.userId)) ?? {};
    const next = {
      ...current,
      approvalThreshold,
      // Approval is now the operative gate; lift the hard reject out of the way.
      maxUsdcPerTx: HARD_CAP_WHEN_APPROVAL_SET,
    };
    await setStoredPolicy(next, session.userId);
    return NextResponse.json({
      approvalThreshold: next.approvalThreshold,
      maxUsdcPerTx: next.maxUsdcPerTx,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
