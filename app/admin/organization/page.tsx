"use client";

import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";

type Organization = {
  id: string;
  name: string;
  defaultMarkupPct: string | number;
  currency: string;
  timezone: string;
  externalId: string | null;
  branches: { id: string; name: string; timezone: string; active: boolean; externalId: string | null }[];
};

export default function OrganizationSettingsPage() {
  const [org, setOrg] = useState<Organization | null>(null);
  const [form, setForm] = useState({ name: "", defaultMarkupPct: "", timezone: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function apply(o: Organization) {
    setOrg(o);
    setForm({ name: o.name, defaultMarkupPct: String(Number(o.defaultMarkupPct)), timezone: o.timezone });
  }

  useEffect(() => {
    fetch("/api/organization")
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) setError(typeof d.error === "string" ? d.error : `Couldn't load settings (${r.status}).`);
        else apply(d.organization);
      })
      .catch(() => setError("Couldn't reach the server — check your connection."))
      .finally(() => setLoading(false));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const markup = Number(form.defaultMarkupPct);
    if (!Number.isFinite(markup) || markup < 0 || markup > 1000) {
      setError("Markup must be a percentage between 0 and 1000.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name.trim(), defaultMarkupPct: markup, timezone: form.timezone.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof d.error === "string" ? d.error : "Couldn't save — check the values and try again.");
        return;
      }
      apply(d.organization);
      setNotice("Saved.");
    } catch {
      setError("Couldn't reach the server — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  const input = "tap-target w-full rounded-lg border-2 border-nexus-line bg-white px-4";

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-6 md:pt-10">
      <PageHeader title="Company settings" subtitle="Your company's name, pricing and branches." />
      {loading ? (
        <p className="mt-6 text-nexus-steel">Loading…</p>
      ) : org ? (
        <>
          <Card className="mt-5 p-4">
            <form onSubmit={save} className="flex flex-col gap-4">
              <div>
                <label htmlFor="org-name" className="block text-sm font-medium text-nexus-navy">
                  Company name
                </label>
                <input
                  id="org-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className={input}
                  required
                  maxLength={120}
                />
              </div>
              <div>
                <label htmlFor="org-markup" className="block text-sm font-medium text-nexus-navy">
                  Default parts markup (%)
                </label>
                <input
                  id="org-markup"
                  type="number"
                  min={0}
                  max={1000}
                  step="0.01"
                  inputMode="decimal"
                  value={form.defaultMarkupPct}
                  onChange={(e) => setForm({ ...form, defaultMarkupPct: e.target.value })}
                  className={`${input} font-data sm:w-40`}
                  required
                />
                <p className="mt-1 text-xs text-nexus-steel">
                  Parts without their own list price are charged at unit cost plus this. It&apos;s the price the Field
                  App uses on quotes and invoices.
                </p>
              </div>
              <div>
                <label htmlFor="org-tz" className="block text-sm font-medium text-nexus-navy">
                  Time zone
                </label>
                <input
                  id="org-tz"
                  value={form.timezone}
                  onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                  className={input}
                  placeholder="America/New_York"
                  required
                />
              </div>
              <div role="status" aria-live="polite" className="min-h-[1.25rem] text-sm">
                {error && <p className="text-nexus-danger">{error}</p>}
                {notice && <p className="text-nexus-ok">{notice}</p>}
              </div>
              <Button type="submit" disabled={busy} className="sm:w-40">
                {busy ? "Saving…" : "Save"}
              </Button>
            </form>
          </Card>

          <h2 className="mt-8 text-sm font-medium text-nexus-steel">Branches</h2>
          <ul className="mt-2 divide-y divide-nexus-line rounded-xl border-2 border-nexus-line bg-white">
            {org.branches.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="flex items-center gap-2 font-medium text-nexus-navy">
                  <Building2 size={16} aria-hidden /> {b.name}
                  {!b.active && <span className="text-xs font-normal text-nexus-steel">(inactive)</span>}
                </span>
                <span className="text-xs text-nexus-steel">
                  {b.timezone}
                  {b.externalId && " · linked to Field App"}
                </span>
              </li>
            ))}
          </ul>
          {org.externalId && (
            <p className="mt-2 text-xs text-nexus-steel">
              This company is connected to the Field App; branches are managed there.
            </p>
          )}
        </>
      ) : (
        <p role="alert" className="mt-6 text-nexus-danger">
          {error}
        </p>
      )}
    </div>
  );
}
