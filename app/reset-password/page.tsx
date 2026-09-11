"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetForm />
    </Suspense>
  );
}

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof d.error === "string" ? d.error : `Couldn't reset the password (${res.status}).`);
        return;
      }
      const login = await signIn("credentials", { email: d.email, password, redirect: false });
      router.push(login?.error ? "/login" : "/");
      router.refresh();
    } catch {
      setError("Couldn't reach the server — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 bg-nexus-paper px-4">
        <p className="text-sm text-nexus-steel">This link is missing its token. Open the link from the email again.</p>
        <Link href="/forgot-password" className="text-sm text-nexus-steel underline">
          Request a new link
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 bg-nexus-paper px-4">
      <h1 className="text-2xl font-medium text-nexus-navy">Choose a new password</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          type="password"
          placeholder="New password (8+ characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="tap-target rounded-lg border-2 border-nexus-steel/30 bg-white px-4"
          autoComplete="new-password"
          minLength={8}
          required
        />
        <input
          type="password"
          placeholder="Confirm new password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="tap-target rounded-lg border-2 border-nexus-steel/30 bg-white px-4"
          autoComplete="new-password"
          required
        />
        {error && <p className="text-sm text-nexus-danger">{error}</p>}
        <button type="submit" disabled={busy} className="tap-target rounded-lg bg-nexus-navy font-medium text-white disabled:opacity-40">
          {busy ? "Saving…" : "Set password and sign in"}
        </button>
      </form>
    </main>
  );
}
