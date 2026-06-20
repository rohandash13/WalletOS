import { NextResponse } from "next/server";
import { resetDemoState } from "@/lib/demo-data";

export async function POST() {
  resetDemoState();
  return NextResponse.json({ ok: true });
}
