"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { KeyRound } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { ROLE_LABELS } from "@/lib/roles";

export default function AccountPage() {
  const { data: session } = useSession();
  const user = session?.user as { name?: string; email?: string; role?: string } | undefined;
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (form.next !== form.confirm) {
      setError("New passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: form.current, newPassword: form.next }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof d.error === "string" ? d.error : `Couldn't change the password (${res.status}).`);
        return;
      }
      setNotice("Password changed.");
      setForm({ current: "", next: "", confirm: "" });
    } catch {
      setError("Couldn't reach the server — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  const input = "tap-target w-full rounded-lg border-2 border-nexus-line bg-white px-4";

  return (
    <div className="mx-auto max-w-lg px-4 pb-24 pt-6 md:pt-10">
      <PageHeader title="Your account" />

      <Card className="mt-5 p-4">
        <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-nexus-steel">Name</dt>
          <dd className="font-medium text-nexus-navy">{user?.name ?? "—"}</dd>
          <dt className="text-nexus-steel">Email</dt>
          <dd className="font-medium text-nexus-navy">{user?.email ?? "—"}</dd>
          <dt className="text-nexus-steel">Role</dt>
          <dd className="font-medium text-nexus-navy">
            {user?.role ? ROLE_LABELS[user.role as keyof typeof ROLE_LABELS] ?? user.role : "—"}
          </dd>
        </dl>
        <p className="mt-3 text-xs text-nexus-steel">Name and email changes go through an admin under Users &amp; permissions.</p>
      </Card>

      <Card className="mt-4 p-4">
        <p className="flex items-center gap-2 font-medium text-nexus-navy">
          <KeyRound size={16} /> Change password
        </p>
        <form onSubmit={changePassword} className="mt-3 flex flex-col gap-3">
          <input
            type="password"
            placeholder="Current password"
            value={form.current}
            onChange={(e) => setForm({ ...form, current: e.target.value })}
            className={input}
            required
            autoComplete="current-password"
          />
          <input
            type="password"
            placeholder="New password (8+ characters)"
            value={form.next}
            onChange={(e) => setForm({ ...form, next: e.target.value })}
            className={input}
            required
            minLength={8}
            autoComplete="new-password"
          />
          <input
            type="password"
            placeholder="Confirm new password"
            value={form.confirm}
            onChange={(e) => setForm({ ...form, confirm: e.target.value })}
            className={input}
            required
            autoComplete="new-password"
          />
          {error && <p className="text-sm text-nexus-danger">{error}</p>}
          {notice && <p className="text-sm text-nexus-ok">{notice}</p>}
          <Button type="submit" disabled={busy || !form.current || form.next.length < 8}>
            {busy ? "Saving…" : "Change password"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
