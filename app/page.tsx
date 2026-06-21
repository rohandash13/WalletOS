import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AuthActions } from "./components/AuthActions";

export default async function Home() {
  const { userId } = await auth();

  if (userId) {
    redirect("/chat");
  }

  return (
    <main className="public-page">
      <section className="public-card">
        <p className="eyebrow">WalletOS</p>
        <h1>Private Banker for the 99%</h1>
        <p>
          Sign in with Google to access your WalletOS profile, rules,
          automations, and demo app session.
        </p>
        <AuthActions />
        <p className="public-note">
          Demo only · Testnet USDC · Shared funded demo wallet
        </p>
      </section>
    </main>
  );
}
