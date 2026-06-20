import { NextResponse } from "next/server";
import { getAutomations } from "@/lib/demo-data";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ automations: getAutomations() });
}
