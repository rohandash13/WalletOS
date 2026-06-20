import { NextResponse } from "next/server";
import { getBalance } from "@/lib/demo-data";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getBalance());
}
