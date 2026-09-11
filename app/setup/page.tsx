"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

export default function SetupPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "", warehouseName: "Main warehouse" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/setup")
      .then((r) => r.json())
      .then((d) => {
        if (!d.needsSetup) router.replace("/login");
        else setChecking(false);
      })
      .catch(() => {
        setError("Couldn't reach the server. Check DATABASE_URL and that migrations have run.");
        setChecking(false);
      });
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.password !== form.confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          password: form.password,
          warehouseName: form.warehouseName,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof d.error === "string" ? d.error : `Setup failed (${res.status}).`);
        return;
      }
      const login = await signIn("credentials", { email: form.email.trim(), password: form.password, redirect: false });
      if (login?.error) {
        router.push("/login");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (checking) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
        <p className="text-nexus-steel">Checking…</p>
      </main>
    );
  }

  const input = "tap-target rounded-lg border-2 border-nexus-steel/30 bg-white px-4";

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 bg-nexus-paper px-4 py-10">
      <div>
        <h1 className="font-display text-2xl font-bold text-nexus-navy">Set up Nexus Inventory</h1>
        <p className="mt-1 text-sm text-nexus-steel">
          Create the first account. It becomes the Super Admin, who adds everyone else from Users &amp; permissions.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          placeholder="Your name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className={input}
          required
          autoComplete="name"
        />
        <input
          type="email"
          placeholder="Email (this is your login)"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          className={input}
          required
          autoComplete="username"
        />
        <input
          type="password"
          placeholder="Password (8+ characters)"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          className={input}
          required
          minLength={8}
          autoComplete="new-password"
        />
        <input
          type="password"
          placeholder="Confirm password"
          value={form.confirm}
          onChange={(e) => setForm({ ...form, confirm: e.target.value })}
          className={input}
          required
          autoComplete="new-password"
        />
        <input
          placeholder="Warehouse name"
          value={form.warehouseName}
          onChange={(e) => setForm({ ...form, warehouseName: e.target.value })}
          className={input}
          required
        />
        {error && <p className="text-sm text-nexus-danger">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="tap-target rounded-lg bg-nexus-navy font-medium text-white disabled:opacity-40"
        >
          {busy ? "Setting up…" : "Create account and warehouse"}
        </button>
      </form>
    </main>
  );
}
