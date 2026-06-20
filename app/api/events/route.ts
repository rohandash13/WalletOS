import { NextResponse } from "next/server";
import { getEvents } from "@/lib/demo-data";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ events: getEvents() });
}
