"use client";

import { SignInButton, SignUpButton, useAuth } from "@clerk/nextjs";

export function AuthActions() {
  const { isLoaded, userId } = useAuth();

  if (!isLoaded) {
    return <div className="public-actions" />;
  }

  if (userId) {
    return (
      <div className="public-actions">
        <a className="btn btn-primary" href="/chat">
          Open app
        </a>
      </div>
    );
  }

  return (
    <div className="public-actions">
      <SignInButton mode="modal" fallbackRedirectUrl="/chat">
        <button className="btn btn-primary" type="button">
          Sign in
        </button>
      </SignInButton>
      <SignUpButton mode="modal" fallbackRedirectUrl="/chat">
        <button className="btn btn-ghost" type="button">
          Create account
        </button>
      </SignUpButton>
    </div>
  );
}
