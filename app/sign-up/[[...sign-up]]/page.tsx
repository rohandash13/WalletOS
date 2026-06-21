import { AuthActions } from "@/app/components/AuthActions";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function SignUpPage() {
  const { userId } = await auth();

  if (userId) {
    redirect("/chat");
  }

  return (
    <main className="auth-page">
      <section className="public-card">
        <p className="eyebrow">WalletOS</p>
        <h1>Create account</h1>
        <p>Create your WalletOS profile with Google, then continue to the app.</p>
        <AuthActions />
      </section>
    </main>
  );
}
