"use client";

import { SignInButton, useAuth, useUser } from "@clerk/nextjs";
import { useMemo } from "react";
import { WalletDemo } from "@/app/components/WalletDemo";
import type { AuthUser, WalletOSProfile } from "@/lib/profiles";

function LoadingAuth() {
  return (
    <main className="auth-page">
      <section className="public-card">
        <p className="eyebrow">WalletOS</p>
        <h1>Opening app</h1>
        <p>Checking your WalletOS session...</p>
      </section>
    </main>
  );
}

function SignedOutFallback() {
  return (
    <main className="auth-page">
      <section className="public-card">
        <p className="eyebrow">WalletOS</p>
        <h1>Sign in</h1>
        <p>Use your Google account to open your protected WalletOS demo app.</p>
        <div className="public-actions">
          <SignInButton mode="modal" fallbackRedirectUrl="/chat">
            <button className="btn btn-primary" type="button">
              Sign in
            </button>
          </SignInButton>
        </div>
      </section>
    </main>
  );
}

export function ChatApp() {
  const { isLoaded, userId } = useAuth();
  const { user } = useUser();

  const authUser = useMemo<AuthUser | null>(() => {
    if (!userId) return null;
    return {
      userId,
      email: user?.primaryEmailAddress?.emailAddress ?? `${userId}@walletos.local`,
      name: user?.fullName ?? user?.firstName ?? undefined,
      imageUrl: user?.imageUrl,
    };
  }, [user, userId]);

  const profile = useMemo<WalletOSProfile | null>(() => {
    if (!authUser) return null;
    return {
      ...authUser,
      riskScore: 3,
      connectedAgents: ["Stable-Invest"],
      automations: [],
    };
  }, [authUser]);

  if (!isLoaded) {
    return <LoadingAuth />;
  }

  if (!authUser || !profile) {
    return <SignedOutFallback />;
  }

  return <WalletDemo authUser={authUser} profile={profile} />;
}
