"use client";

import { useEffect, useState } from "react";
import { ROLES, ROLE_LABELS, MAX_DESIGNATED_RECEIVERS } from "@/lib/roles";

type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  canReceiveParts: boolean;
  createdAt: string;
};

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "TRUCK_TECH" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", email: "", password: "" });

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

  const receiverCount = users.filter((u) => u.canReceiveParts && u.role !== "SUPER_ADMIN").length;

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

  async function patchUser(id: string, body: Record<string, unknown>) {
    setError(null);
    const res = await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(typeof data.error === "string" ? data.error : "Couldn't update user.");
      return false;
    }
    load();
    return true;
  }

  function startEdit(u: User) {
    setEditingId(u.id);
    setEditForm({ name: u.name, email: u.email, password: "" });
    setError(null);
  }

  async function saveEdit(id: string) {
    const body: Record<string, unknown> = { name: editForm.name, email: editForm.email };
    if (editForm.password) {
      if (editForm.password.length < 8) {
        setError("New password must be at least 8 characters.");
        return;
      }
      body.password = editForm.password;
    }
    const ok = await patchUser(id, body);
    if (ok) setEditingId(null);
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

      <p className="mt-2 text-sm text-nexus-steel">
        Designated warehouse receivers: <span className="font-medium text-nexus-navy">{receiverCount}</span> /{" "}
        {MAX_DESIGNATED_RECEIVERS} (the super admin always has receiving access on top of this).
      </p>

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
            <li key={u.id} className="px-4 py-3">
              {editingId === u.id ? (
                <div className="flex flex-col gap-2">
                  <label className="text-xs text-nexus-steel">Name</label>
                  <input
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="tap-target rounded-lg border-2 border-nexus-steel/30 px-3 text-sm"
                  />
                  <label className="text-xs text-nexus-steel">Email</label>
                  <input
                    type="email"
                    value={editForm.email}
                    onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                    className="tap-target rounded-lg border-2 border-nexus-steel/30 px-3 text-sm"
                  />
                  <label className="text-xs text-nexus-steel">New password (leave blank to keep current)</label>
                  <input
                    type="password"
                    value={editForm.password}
                    onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                    className="tap-target rounded-lg border-2 border-nexus-steel/30 px-3 text-sm"
                  />
                  <div className="mt-1 flex gap-2">
                    <button
                      onClick={() => saveEdit(u.id)}
                      className="tap-target flex-1 rounded-lg bg-nexus-ok font-medium text-white"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="tap-target rounded-lg border-2 border-nexus-steel/30 px-4 text-nexus-steel"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium text-nexus-navy">{u.name}</p>
                    <p className="text-sm text-nexus-steel">{u.email}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => startEdit(u)}
                      className="tap-target rounded-lg border-2 border-nexus-steel/30 px-3 text-sm text-nexus-navy"
                    >
                      Edit
                    </button>
                    {u.role !== "SUPER_ADMIN" && (
                      <label className="tap-target flex items-center gap-2 rounded-lg border-2 border-nexus-steel/30 px-3 text-sm">
                        <input
                          type="checkbox"
                          checked={u.canReceiveParts}
                          disabled={!u.canReceiveParts && receiverCount >= MAX_DESIGNATED_RECEIVERS}
                          onChange={(e) => patchUser(u.id, { canReceiveParts: e.target.checked })}
                        />
                        Can receive parts
                      </label>
                    )}
                    <select
                      value={u.role}
                      onChange={(e) => patchUser(u.id, { role: e.target.value })}
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
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
