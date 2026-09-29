"use client";

import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/Button";

type Key = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};

function status(k: Key) {
  if (k.revokedAt) return "Revoked";
  if (k.expiresAt && new Date(k.expiresAt) <= new Date()) return "Expired";
  if (k.expiresAt) return `Expires ${new Date(k.expiresAt).toLocaleString()}`;
  return "Active";
}

/** API keys the Field App (or another system) uses to reach this company's inventory. */
export function ApiKeysPanel() {
  const [keys, setKeys] = useState<Key[]>([]);
  const [name, setName] = useState("Field App");
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/api-keys").catch(() => null);
    if (!res) return setError("Couldn't reach the server — check your connection.");
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return setError(typeof d.error === "string" ? d.error : `Couldn't load keys (${res.status}).`);
    setKeys(d.keys ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setError(typeof d.error === "string" ? d.error : "Couldn't create the key.");
      setFresh(d.key);
      load();
    } catch {
      setError("Couldn't reach the server — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(k: Key) {
    if (!confirm(`Revoke "${k.name}" (${k.prefix}…)? Anything using it stops working immediately.`)) return;
    const res = await fetch(`/api/api-keys/${k.id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) setError("Couldn't revoke the key.");
    load();
  }

  return (
    <section className="mt-8">
      <h2 className="text-sm font-medium text-nexus-steel">API keys</h2>
      <p className="mt-1 text-xs text-nexus-steel">
        The Field App uses a key to record parts used on jobs and read truck stock for this company. Keys created
        when the Field App connects appear here too.
      </p>

      {fresh && (
        <div role="alert" className="mt-3 rounded-lg border-2 border-nexus-warn/50 bg-white p-3 text-sm">
          <p className="font-medium text-nexus-navy">Copy this key now — it won&apos;t be shown again.</p>
          <code className="mt-2 block break-all rounded bg-nexus-paper p-2 font-data text-xs">{fresh}</code>
          <div className="mt-2 flex gap-2">
            <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(fresh).catch(() => {})}>
              Copy
            </Button>
            <Button variant="ghost" onClick={() => setFresh(null)}>
              Done
            </Button>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="flex-1">
          <label htmlFor="key-name" className="block text-xs text-nexus-steel">
            New key name
          </label>
          <input
            id="key-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            className="tap-target w-full rounded-lg border-2 border-nexus-line bg-white px-4"
          />
        </div>
        <Button onClick={create} disabled={busy || !name.trim()} icon={<KeyRound size={16} />}>
          Create key
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-nexus-danger">
          {error}
        </p>
      )}

      {keys.length > 0 && (
        <ul className="mt-3 divide-y divide-nexus-line rounded-xl border-2 border-nexus-line bg-white">
          {keys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <div>
                <p className="font-medium text-nexus-navy">
                  {k.name} <span className="font-data text-xs text-nexus-steel">{k.prefix}…</span>
                </p>
                <p className="text-xs text-nexus-steel">
                  {status(k)} · created {new Date(k.createdAt).toLocaleDateString()} ·{" "}
                  {k.lastUsedAt ? `last used ${new Date(k.lastUsedAt).toLocaleString()}` : "never used"}
                </p>
              </div>
              {!k.revokedAt && (
                <Button variant="danger" onClick={() => revoke(k)}>
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
