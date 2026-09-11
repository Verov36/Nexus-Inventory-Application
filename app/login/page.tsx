"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Only ever bounce back to a same-site path, never an absolute URL from
  // the query string.
  const rawCallback = searchParams.get("callbackUrl") ?? "/";
  const callbackUrl = rawCallback.startsWith("/") && !rawCallback.startsWith("//") ? rawCallback : "/";

  // A brand-new database has no accounts to sign in with — send the first
  // visitor to the setup screen instead of a login form that can't work.
  useEffect(() => {
    fetch("/api/setup")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.needsSetup) router.replace("/setup");
      })
      .catch(() => {});
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await signIn("credentials", { email: email.trim(), password, redirect: false });
      if (res?.error) {
        setError("Email or password didn't match.");
        return;
      }
      router.push(callbackUrl);
      router.refresh();
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 bg-nexus-paper px-4">
      <h1 className="text-2xl font-medium text-nexus-navy">Nexus parts inventory</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="tap-target rounded-lg border-2 border-nexus-steel/30 bg-white px-4"
          autoComplete="username"
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="tap-target rounded-lg border-2 border-nexus-steel/30 bg-white px-4"
          autoComplete="current-password"
          required
        />
        {error && <p className="text-sm text-nexus-danger">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="tap-target rounded-lg bg-nexus-navy font-medium text-white disabled:opacity-40"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <Link href="/forgot-password" className="text-sm text-nexus-steel underline">
        Forgot your password?
      </Link>
    </main>
  );
}
