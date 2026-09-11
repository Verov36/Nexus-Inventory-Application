"use client";

import { useState } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sent" | "not-configured">("idle");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof d.error === "string" ? d.error : `Something went wrong (${res.status}).`);
        return;
      }
      setState(d.emailConfigured === false ? "not-configured" : "sent");
    } catch {
      setError("Couldn't reach the server — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 bg-nexus-paper px-4">
      <h1 className="text-2xl font-medium text-nexus-navy">Forgot your password?</h1>

      {state === "sent" && (
        <p className="text-sm text-nexus-steel">
          If there&apos;s an account for <span className="font-medium text-nexus-navy">{email}</span>, a reset link is on
          its way. It works for 30 minutes.
        </p>
      )}
      {state === "not-configured" && (
        <p className="text-sm text-nexus-steel">
          Email isn&apos;t set up on this installation, so a link can&apos;t be sent. Ask an admin to set a temporary password
          for you from Users &amp; permissions, then change it under Your account.
        </p>
      )}
      {state === "idle" && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <p className="text-sm text-nexus-steel">Enter your sign-in email and we&apos;ll send a link to choose a new one.</p>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="tap-target rounded-lg border-2 border-nexus-steel/30 bg-white px-4"
            autoComplete="username"
            required
          />
          {error && <p className="text-sm text-nexus-danger">{error}</p>}
          <button type="submit" disabled={busy} className="tap-target rounded-lg bg-nexus-navy font-medium text-white disabled:opacity-40">
            {busy ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}

      <Link href="/login" className="text-sm text-nexus-steel underline">
        Back to sign in
      </Link>
    </main>
  );
}
