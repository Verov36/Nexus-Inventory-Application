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

## Phase 5 — Roles, navigation, scheduled reports, mass import

**Roles** (`prisma/schema.prisma` → `Role` enum, `lib/roles.ts` for permission checks):
- `SUPER_ADMIN` — full access, and the only role that can run a mass import
- `ADMIN` — manages users and permissions (can't touch mass import)
- `MANAGER` — sets truck caps, reviews overage justifications, runs/schedules reports
- `WAREHOUSE_MANAGER` — oversees warehouse receiving, can view/run reports
- `WAREHOUSE_EMPLOYEE` — receives and checks in parts
- `TRUCK_TECH` — checks parts out to a truck, submits overage justifications

**User management** — `/admin/users` (Admin/Super Admin only). Add users, change
roles, remove users. An Admin can't create or edit another Admin/Super Admin —
only a Super Admin can touch that tier. The last remaining Super Admin can't
be demoted or deleted, so you can't lock yourself out. `app/api/users/`.

**Navigation** — `components/AppShell.tsx` wraps every page (except
`/login`): a persistent sidebar on desktop, a slide-out drawer behind a
hamburger button on mobile/tablet. Links are filtered by the signed-in
user's role automatically, so a tech never sees manager/admin screens in the
nav. `middleware.ts` backs this up server-side — it redirects signed-out
users to `/login` and blocks non-admins from `/admin/*` routes even if they
navigate there directly.

**Scheduled reports** — `/manager/reports` now has a schedule panel: set the
audit cadence in days (defaults to 7), and past automated runs are listed
below with a "View" link. The actual generation happens in
`app/api/cron/weekly-report/route.ts`, which needs an external trigger since
Next.js has no built-in cron:

1. In Railway, add a **Cron Job** (Project → New → Cron Job, or the "Add a
   Cron Job" option under your service) pointed at
   `https://your-app.up.railway.app/api/cron/weekly-report`, method `POST`,
   running e.g. daily (`0 6 * * *`) — the endpoint itself checks whether the
   configured schedule is actually due and no-ops if not, so running the
   trigger daily while the schedule is set to weekly is fine and expected.
2. Set `CRON_SECRET` in your Railway environment variables (same value the
   cron job's request header uses: `Authorization: Bearer <CRON_SECRET>`).
   Without this, the endpoint is a public URL anyone could hit.

**Mass import** — `/admin/import`, Super Admin only (enforced in both the UI
and the API — `app/api/admin/import-parts/route.ts`). Paste or upload a CSV
with a header row: `sku,name,barcodeValue,category,unitCost,reorderThreshold`
(only sku/name/barcodeValue are required). Existing SKUs are updated, new
ones created; the response lists any skipped rows with a reason.

### Migration for this phase

The `Role` enum values changed (`WAREHOUSE_STAFF`/`TECH` → the six roles
above) and two new models were added (`ReportSchedule`, `ReportSnapshot`).
Run:

```bash
railway run npx prisma migrate dev --name roles-nav-reports-import
```

If you already have real users seeded with the old role names, you'll need
to reassign their roles manually (in `/admin/users` once it's deployed, or
directly in the database) since Postgres won't auto-map old enum values to
new ones.
