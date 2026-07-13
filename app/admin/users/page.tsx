"use client";

import { useEffect, useState } from "react";
import { ROLES, ROLE_LABELS } from "@/lib/roles";

type User = { id: string; name: string; email: string; role: string; createdAt: string };

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "TRUCK_TECH" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/users");
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users ?? []);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createUser() {
    setError(null);
    setBusy(true);
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json();
      setError(typeof data.error === "string" ? data.error : "Couldn't create user.");
      return;
    }
    setForm({ name: "", email: "", password: "", role: "TRUCK_TECH" });
    load();
  }

  async function changeRole(id: string, role: string) {
    setError(null);
    const res = await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(typeof data.error === "string" ? data.error : "Couldn't update role.");
      return;
    }
    load();
  }

  async function deleteUser(id: string) {
    if (!confirm("Remove this user? This can't be undone.")) return;
    setError(null);
    const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      setError(typeof data.error === "string" ? data.error : "Couldn't delete user.");
      return;
    }
    load();
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-nexus-paper px-4 pb-24 pt-8">
      <h1 className="text-2xl font-medium text-nexus-navy">Users & permissions</h1>
      <p className="mt-1 text-nexus-steel">Add techs and staff, and control what each role can access.</p>

      {error && (
        <p className="mt-4 rounded-lg border-2 border-nexus-danger/40 bg-white p-3 text-sm text-nexus-danger">
          {error}
        </p>
      )}

      <section className="mt-6 rounded-xl border-2 border-nexus-steel/15 bg-white p-4">
        <p className="font-medium text-nexus-navy">Add a user</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <input
            placeholder="Full name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="tap-target rounded-lg border-2 border-nexus-steel/30 px-4"
          />
          <input
            placeholder="Email"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="tap-target rounded-lg border-2 border-nexus-steel/30 px-4"
          />
          <input
            placeholder="Temporary password"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="tap-target rounded-lg border-2 border-nexus-steel/30 px-4"
          />
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
            className="tap-target rounded-lg border-2 border-nexus-steel/30 px-4"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={createUser}
          disabled={busy || !form.name || !form.email || form.password.length < 8}
          className="tap-target mt-4 w-full rounded-lg bg-nexus-navy font-medium text-white disabled:opacity-40 sm:w-auto sm:px-6"
        >
          Add user
        </button>
        <p className="mt-1 text-xs text-nexus-steel">Password must be at least 8 characters.</p>
      </section>

      <section className="mt-6">
        <ul className="divide-y divide-nexus-steel/10 rounded-xl border-2 border-nexus-steel/15 bg-white">
          {users.map((u) => (
            <li key={u.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium text-nexus-navy">{u.name}</p>
                <p className="text-sm text-nexus-steel">{u.email}</p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={u.role}
                  onChange={(e) => changeRole(u.id, e.target.value)}
                  className="tap-target rounded-lg border-2 border-nexus-steel/30 px-3 text-sm"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => deleteUser(u.id)}
                  className="tap-target rounded-lg border-2 border-nexus-danger/40 px-3 text-sm text-nexus-danger"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
