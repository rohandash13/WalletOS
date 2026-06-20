import { NextResponse } from "next/server";
import { handleChat } from "@/lib/demo-data";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    userId?: string;
    message?: string;
    mode?: "text" | "voice";
  };

  if (!body.message) {
    return NextResponse.json(
      { error: "A message is required." },
      { status: 400 },
    );
  }

  return NextResponse.json(handleChat(body.message));
}
