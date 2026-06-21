import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getOrCreateProfile } from "./profiles";

function stringClaim(
  claims: Record<string, unknown> | null,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = claims?.[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
}

export async function requireAuth() {
  const { userId } = await auth();

  if (userId) {
    return {
      response: null,
      userId,
    } as const;
  }

  const devUserId = (await headers()).get("x-walletos-user-id");

  if (process.env.NODE_ENV !== "production" && devUserId) {
    return {
      response: null,
      userId: devUserId,
    } as const;
  }

  if (!userId) {
    return {
      response: NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      ),
      userId: null,
    } as const;
  }

  return {
    response: null,
    userId,
  } as const;
}

export async function getSessionAuthUser() {
  const { sessionClaims, userId } = await auth();

  if (!userId) {
    return null;
  }

  const claims = sessionClaims as Record<string, unknown> | null;
  const email =
    stringClaim(claims, ["email", "primary_email_address"]) ??
    `${userId}@walletos.local`;
  const name =
    stringClaim(claims, ["name", "full_name"]) ??
    [stringClaim(claims, ["first_name", "given_name"]), stringClaim(claims, ["last_name", "family_name"])]
      .filter(Boolean)
      .join(" ") ??
    undefined;
  const imageUrl = stringClaim(claims, ["image_url", "picture"]);

  return {
    userId,
    email,
    name: name || undefined,
    imageUrl,
  };
}

export async function requireAuthUser() {
  const authUser = await getSessionAuthUser();

  if (!authUser) {
    return {
      response: NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      ),
      authUser: null,
      profile: null,
    } as const;
  }

  return {
    response: null,
    authUser,
    profile: getOrCreateProfile(authUser),
  } as const;
}
