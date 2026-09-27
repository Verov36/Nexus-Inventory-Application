# Field App ↔ Inventory integration contract

**Status: DRAFT v0.2 (2026-09-27). Organizations, branches and pricing are built on the Inventory side; the /api/v1 endpoints and API keys are not yet. Don't code against it until it says v1.0.**

The Inventory app is the only source of truth for parts, stock, truck loads,
parts used on jobs, part costs and (later) purchasing. The Field App keeps
jobs, customers, scheduling, quotes and invoices. It reads and writes
inventory only through the API below. Its own `Part`, `TruckInventory`,
`JobPart`, `PurchaseOrder` and `POLineItem` tables are frozen and get retired
at cutover (see the end).

## 1. Tenancy: how a Field App company maps to the Inventory app

| Field App          | Inventory app                                                    |
|--------------------|------------------------------------------------------------------|
| `Organization.id`  | `Organization.externalId` (one Inventory org per Field App org)  |
| `Branch.id`        | `Branch.externalId` (warehouses and trucks belong to a branch)   |
| `Job.id`           | `Job.externalId`; `jobNumber` is kept for display                |
| `User.id` (tech)   | `externalUserId` on usage records and truck assignments          |

Every Inventory row is scoped to one organization. An API key is bound to
exactly one organization and can never read or write another's data.

## 2. Authentication

- **Provisioning key** (`INVENTORY_PLATFORM_KEY`, one per environment): held
  only by the Field App backend. It can do one thing, which is create or update
  an organization and its branches (`/api/v1/provision`). It gets back that
  organization's API key.
- **Organization API key**: sent as `Authorization: Bearer inv_live_…`. The
  Field App stores it encrypted in its existing `IntegrationConnection`
  table (`provider = NEXUS_INVENTORY`, `accessTokenEnc`). Keys are shown
  once, stored hashed on the Inventory side, can be rotated (old and new keys
  both work for 24h) and revoked.
- Server-to-server only. Browsers never see these keys; Field App pages call
  the Field App backend, which calls Inventory.
- Every write takes an `Idempotency-Key` header. A retry with the same key
  returns the original response and moves no stock (already built:
  `lib/idempotency.ts`).

## 3. Endpoints (v1)

All under `/api/v1`, JSON, org taken from the API key.

### Provisioning (provisioning key)
- `PUT /provision/orgs/{externalOrgId}`: `{ name, branches: [{ externalId, name, timezone }] }`
  creates or updates the org. It returns `{ orgId, apiKey }` (the key only on
  first creation or on an explicit `rotateKey: true`).

### Catalog (need d)
- `GET /parts?q=&category=&cursor=&limit=`: search by name, SKU or barcode;
  cursor-paginated. Each part: `{ id, sku, name, category, unit, unitCost, unitPrice, barcode }`.
- `GET /parts/{id}`

### Trucks and stock (need c)
- `GET /trucks?externalUserId=&branchExternalId=` returns the trucks assigned
  to a tech (or all trucks in a branch).
- `GET /trucks/{truckId}/stock` returns `[{ part, quantity }]`, live on-hand.
- `PUT /trucks/{truckId}/assignment` `{ externalUserIds: [] }`: the Field App
  says who rides which truck. It replaces the Field App's `TruckTech`.

### Parts used on a job (needs a, b)
- `POST /jobs/{externalJobId}/parts-used` (Idempotency-Key required)
  ```json
  { "jobNumber": "WO-5521", "branchExternalId": "…", "truckId": "…",
    "usedBy": { "externalUserId": "…", "name": "Tina Tech" },
    "items": [{ "partId": "…", "quantity": 2 }], "notes": "optional" }
  ```
  → `201 { usageId, lines: [{ lineId, partId, quantity, unitCost, unitPrice, remainingOnTruck }] }`
  All-or-nothing. It returns `409 { error, partId, available, requested }` if
  the truck is short. It is built on the existing `consumeFromTruck`.

  **Who may record parts, checked on both sides:**
  - **Field App (before calling):** the acting user must pass
    `canWorkJob` (`src/lib/scope.ts`). A tech works only their assigned jobs;
    dispatchers and managers use their existing scope. The legacy
    `/api/jobs/[id]/parts` endpoint lacks this check today and must get it
    when it's switched over.
  - **Inventory (on receipt):** `usedBy.externalUserId` must be assigned to
    `truckId` (via `/trucks/{truckId}/assignment`). Otherwise the request
    needs `"onBehalf": true`, which is allowed only when the Field App marks
    the actor as a manager or dispatcher. The Field App is trusted for job
    scope, but a bug or a leaked key still can't drain a random truck.
    Violations return `403 { code: "not_assigned_to_truck" }`.
- `POST /jobs/{externalJobId}/parts-used/{lineId}/reverse` (Idempotency-Key)
  `{ quantity, reason }` puts parts back on the truck they came from. It is a
  reversing entry, never a delete, so the ledger stays auditable.
- `GET /jobs/{externalJobId}/parts-used` returns every line with `quantity`,
  `unitCost` (the cost **frozen at the time of use**), `unitPrice` and
  `lineCost`/`linePrice`. Quotes, the completion sheet and invoices read this
  instead of `JobPart` + `Part.cost`.

### Errors
`{ error: string, code: string, ...details }` with 400 (validation), 401 (bad
or revoked key), 403 (wrong org), 404, 409 (stock or state conflict), 429 (rate
limit, with `Retry-After`) and 5xx (safe to retry with the same Idempotency-Key).

## 4. Pricing (decided 2026-09-27: Inventory owns the price)

Each part has an optional list price. Without one, the price is unit cost plus
the organization's default markup (default 25%, set in Inventory → Company
settings). With neither, there's no price (`unitPrice: null`), never a guessed
$0. The API returns `unitPrice` and `priceSource: "list" | "markup"`, so quotes,
the completion sheet and invoices all agree. The Field App's hard-coded
`PARTS_MARKUP` in `src/lib/billing.ts` goes away at switchover. The rule
lives in `lib/pricing.ts`.

## 5. Offline and failure behaviour (Field App side)

A tech must never be blocked by the Inventory app being unreachable. The
Field App writes "parts used" to a local outbox row with its Idempotency-Key.
It sends the row immediately, retries with backoff until accepted, and shows
"pending sync" on the job. A 409 (the truck was short) is surfaced to the tech
or dispatcher to resolve. It is never silently dropped.

## 6. Cutover plan

1. The Inventory app ships organizations, branches, API keys and `/api/v1`
   (this document → v1.0).
2. One-time import per Field App org: parts (`Part`), trucks (`Truck`),
   truck stock (`TruckInventory`) and tech assignments (`TruckTech`) go into
   Inventory. The Field App records `ExternalRef(entityType = PART)` → Inventory
   part id.
3. Field App screens switch over. The job Parts tab, completion sheet, quotes,
   invoices, `/dashboard/trucks` and `/dashboard/parts` read and write through
   the API. Signup stops seeding sample parts locally and provisions the org
   instead.
4. Field App inventory tables go read-only, then are dropped after a
   verification period.
5. Purchase orders move to Inventory with the purchasing module. Until then
   the Field App's PO screens stay frozen.

## 7. Not in v1
Webhooks (low stock, part changed), SSO between the apps, warehouse-to-truck
transfers from the Field App, serialized parts. These are planned. v1 is the
minimum for jobs to consume real inventory.
