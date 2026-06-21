/**
 * GET  /api/approvals — list money moves waiting for the user's approval (deferred
 *   on payday because they exceeded the approval threshold). Returns: { approvals }
 * POST /api/approvals — approve or decline one.
 *   Body: { id: string, action: "approve" | "decline" }
 */
import { NextRequest, NextResponse } from "next/server";
import {
  listPendingApprovals,
  removePendingApproval,
  publishEvent,
} from "@/lib/redis";
import { executeTool, hydratePolicy } from "@/lib/tools";
import { requireAuth } from "@/lib/auth";

function errText(result: unknown): string {
  if (result && typeof result === "object" && "error" in result) {
    return String((result as { error: unknown }).error);
  }
  return "could not complete the request";
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireAuth();
    if (session.response) return session.response;
    return NextResponse.json({ approvals: await listPendingApprovals(session.userId) });
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
    const id = String(body?.id ?? "");
    const action = body?.action === "decline" ? "decline" : "approve";
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    // Read (don't remove yet) so a failed execution keeps the item for retry.
    const pending = (await listPendingApprovals(session.userId)).find((p) => p.id === id);
    if (!pending) {
      return NextResponse.json({ error: "Approval not found (already handled?)" }, { status: 404 });
    }

    if (action === "decline") {
      await removePendingApproval(id, session.userId);
      await publishEvent(
        "message",
        `Declined: ${pending.note ?? pending.kind} ($${pending.amount}) was not sent.`,
        undefined,
        session.userId,
      );
      return NextResponse.json({ ok: true, declined: pending });
    }

    // Approved → execute first (apply any stored policy), remove ONLY on success.
    await hydratePolicy(session.userId);
    const outcome =
      pending.kind === "transfer"
        ? await executeTool(
            "send_payment",
            { to: pending.to, amount: pending.amount, note: pending.note },
            { userId: session.userId },
          )
        : await executeTool(
            "route_to_agent",
            { amount: pending.amount, riskScore: pending.riskScore ?? 3, agent: pending.agentId },
            { userId: session.userId },
          );

    if (!outcome.ok) {
      // Keep the pending item so the user can retry; surface why it failed.
      const why = errText(outcome.result);
      await publishEvent(
        "message",
        `Couldn't ${pending.kind === "transfer" ? "send" : "invest"} $${pending.amount}: ${why}`,
        undefined,
        session.userId,
      );
      return NextResponse.json({ error: why, pending }, { status: 400 });
    }

    await removePendingApproval(id, session.userId);
    return NextResponse.json({ ok: true, approved: pending, result: outcome.result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
