import { AuthActions } from "@/app/components/AuthActions";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function SignInPage() {
  const { userId } = await auth();

  if (userId) {
    redirect("/chat");
  }

  return (
    <main className="auth-page">
      <section className="public-card">
        <p className="eyebrow">WalletOS</p>
        <h1>Sign in</h1>
        <p>Use your Google account to open your protected WalletOS demo app.</p>
        <AuthActions />
      </section>
    </main>
  );
}
