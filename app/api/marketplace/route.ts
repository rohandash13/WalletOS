/**
 * GET /api/marketplace — list the Fetch AI marketplace agents + live status.
 * Returns: { agents: [{ id, title, description, riskBand, kind, bucket, online, address }] }
 */
import { NextResponse } from "next/server";
import { AGENTS } from "@/lib/marketplace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ping(endpoint: string): Promise<{ online: boolean; address?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${endpoint}/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return { online: false };
    const data = await res.json();
    return { online: true, address: data.address };
  } catch {
    return { online: false };
  }
}

export async function GET() {
  const agents = await Promise.all(
    AGENTS.map(async (a) => {
      const { online, address } = await ping(a.endpoint);
      return {
        id: a.id,
        title: a.title,
        description: a.description,
        riskBand: a.riskBand,
        kind: a.kind,
        bucket: a.bucket,
        endpoint: a.endpoint,
        online,
        agentverseAddress: address,
      };
    }),
  );
  return NextResponse.json({ agents });
}
