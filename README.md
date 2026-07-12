# Nexus parts inventory

Standalone parts inventory app: warehouse receiving, truck assignment and
stock caps, tech checkout (job use vs. restock), overage justification, and
manager reporting.

Stack: Next.js 14 (App Router), PostgreSQL + Prisma, NextAuth v5, Tailwind.
Built mobile/tablet-first.

## What's built

**Phase 1 — Warehouse receiving**
- `/warehouse/receiving` — scan a part (camera or HID scanner), create it in
  the catalog if it's new, record the check-in, print a Zebra label.
- Full data model for every later phase, so migrations don't fight each other.

**Phase 2 — Trucks and checkout**
- `/manager/trucks` — create trucks, assign a tech to each, set a max
  quantity cap per part (or per category) on a truck.
- `/truck/checkout` — tech scans a part and picks **for a job** (requires a
  job/work order number) or **truck restock** (no job number, just filling
  the truck toward its cap). Restock is blocked outright if it would exceed
  the cap — there's no justification path for restock, the cap is the cap.
- `/truck/inventory` — current stock on each truck against its caps.
- Core logic lives in `app/api/inventory/checkout/route.ts` and
  `lib/inventory.ts`.

**Phase 3 — Overage justification**
- When a **job-use** checkout would push a truck over its cap, the API
  responds with `requiresJustification: true` instead of failing outright.
  The checkout screen then asks the tech to explain what's on the truck and
  list the related work order numbers — submitting that unblocks the
  checkout immediately (so a tech isn't stuck waiting mid-job) and files it
  for manager review.
- `/manager/justifications` — managers review flagged checkouts, approve or
  reject. `app/api/justifications/`.

**Phase 4 — Reporting**
- `/manager/reports` — pick a date range, see checkouts broken out by tech,
  part, and job, with job-use vs. restock split out. Download as CSV.
  `app/api/reports/weekly/route.ts`.

## Setting up Zebra printing

1. On the PC/machine physically connected to the printer, install
   [Zebra Browser Print](https://www.zebra.com/us/en/support-downloads/software/printer-software/browser-print.html)
   (free). It runs a small local service on `http://localhost:9100` and
   handles USB, network, and Bluetooth Zebra printers.
2. From the same download, grab `BrowserPrint-3.1.x.min.js` and place it at
   `public/browserprint/BrowserPrint-3.1.min.js` (loaded in `app/layout.tsx`
   — not committed here since it's Zebra's SDK file).
3. Recommended printer: **Zebra ZD421** (203dpi thermal transfer, USB/
   Ethernet/Bluetooth). 2"x1" label stock works well for parts bins.
4. Labels are generated as ZPL in `lib/zebra-print.ts` — a QR code (the value
   scanned back in at checkout) plus SKU, name, and category as text.
5. Printing goes straight from the browser tab to the local Browser Print
   service — no server-side print route.

## Local setup

```bash
npm install
cp .env.example .env.local        # fill in DATABASE_URL and AUTH_SECRET
npx prisma migrate dev --name init
psql "$DATABASE_URL" -f prisma/manual-fixes.sql   # partial unique indexes, see below
npm run seed                       # creates a warehouse + demo manager login
npm run dev
```

The seed script prints a warehouse id — put it in `.env.local` as
`NEXT_PUBLIC_DEFAULT_WAREHOUSE_ID`.

Demo login: `manager@example.com` / `changeme123`

## Known limitations / before production

- **Run `prisma/manual-fixes.sql`** — Postgres treats `NULL` as distinct in
  unique indexes, so a few composite uniques in the schema
  (`StockLevel`, `TruckStockLimit`) don't fully protect against duplicate
  rows under concurrent writes without these partial indexes.
- Truck context on `/truck/checkout` is a manually-typed truck id for now —
  once tech accounts are tied to their assigned truck via session, that
  field should be replaced with a read from the signed-in user.
- No route-level auth guards yet (pages don't redirect unauthenticated users)
  — `middleware.ts` should be added before this goes further than local
  testing.
- Manager screens (`/manager/*`) don't check `role === MANAGER` in the UI,
  only in the API routes that matter (limits, justification review) — add
  UI-level guards too so techs don't see manager screens in the first place.
- Job-use overage justifications unblock the checkout immediately on
  submission and get reviewed after the fact — if you'd rather block until a
  manager actively approves, that's a small change to
  `app/api/inventory/checkout/route.ts`.
- Warehouse selection is a single hardcoded warehouse via env var;
  multi-warehouse orgs need a picker.
- CSV export exists; PDF export for the weekly report doesn't yet.
