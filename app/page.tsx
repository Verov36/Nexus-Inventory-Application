import Link from "next/link";

const links = [
  { href: "/warehouse/receiving", label: "Warehouse receiving", note: "Scan parts in, print labels" },
  { href: "/truck/checkout", label: "Truck checkout", note: "Tech: job use or restock" },
  { href: "/truck/inventory", label: "Truck inventory", note: "Current stock vs. caps" },
  { href: "/manager/trucks", label: "Manage trucks", note: "Assign techs, set caps" },
  { href: "/manager/justifications", label: "Overage justifications", note: "Review flagged checkouts" },
  { href: "/manager/reports", label: "Usage reports", note: "Weekly summary, CSV export" },
];

export default function Home() {
  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-nexus-paper px-4 pb-24 pt-10">
      <h1 className="text-2xl font-medium text-nexus-navy">Nexus parts inventory</h1>
      <p className="mt-1 text-nexus-steel">Warehouse receiving through truck checkout and reporting.</p>

      <div className="mt-6 flex flex-col gap-3">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="tap-target flex flex-col justify-center rounded-xl border-2 border-nexus-steel/15 bg-white px-4"
          >
            <span className="font-medium text-nexus-navy">{l.label}</span>
            <span className="text-sm text-nexus-steel">{l.note}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
