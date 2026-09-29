# Field App ↔ Inventory integration contract

**Status: v1.0 (2026-09-27). Built, tested and verified over HTTP. The Field
App can build against this.** Changes after this point are additive only.
Breaking changes would go to `/api/v2`.

The Inventory app is the only source of truth for parts, stock, truck loads,
parts used on jobs, part costs and prices (and later purchasing). The Field
App keeps jobs, customers, scheduling, quotes and invoices. It reads and
writes inventory only through this API. Its own `Part`, `TruckInventory`,
`JobPart`, `PurchaseOrder` and `POLineItem` tables are frozen and get retired
at cutover (section 7).

## 1. Tenancy

| Field App         | Inventory app                                                |
|-------------------|--------------------------------------------------------------|
| `Organization.id` | the organization's `externalId`: one Inventory org each      |
| `Branch.id`       | the branch's `externalId`; warehouses and trucks belong to one |
| `Truck.id`        | the truck's `externalId` (set by the import endpoint)        |
| `Job.id`          | the job's `externalId`; `jobNumber` is kept for display      |
| `User.id`         | `externalUserId` on crews and on every parts-used line       |

Every Inventory record belongs to one organization. An API key is bound to
exactly one organization and can't read or change another's data. Isolation
is enforced centrally and fails closed. It is covered by tests, including
cross-organization attempts on every endpoint.

## 2. Authentication

**Provisioning key.** `INVENTORY_PLATFORM_KEY` is set in the Inventory
deployment's environment and held only by the Field App backend. It is
accepted by exactly one endpoint, provisioning (section 3.1). Without it
configured, provisioning answers 503.

**Organization API key.** It is sent as `Authorization: Bearer inv_live_…`.
- It is returned once: when the organization is first provisioned, or when
  `rotateKey: true`.
- Store it encrypted in `IntegrationConnection` (`provider =
  NEXUS_INVENTORY`, `accessTokenEnc`).
- Inventory keeps only a hash.
- When a key is rotated, the old one keeps working for 24 hours.
- Admins can also create or revoke keys in Inventory → Company settings →
  API keys.

**Server-to-server only.** Browsers never see these keys.

**Rate limit.** 1,200 requests per minute per key. Over that you get a 429
with `Retry-After`.

**Idempotency.** Every stock-moving call requires an `Idempotency-Key`
header, for example a UUID stored on your outbox row. Repeating a call with
the same key returns the original response with `"replayed": true` and moves
nothing.

## 3. Endpoints

All endpoints are under `/api/v1` and use JSON. The organization comes from
the key.

### 3.1 Provisioning (provisioning key)

`PUT /provision/orgs/{externalOrgId}`
```json
{ "name": "Acme Heating & Air",
  "branches": [{ "externalId": "br_1", "name": "North", "timezone": "America/Chicago" }],
  "owner": { "name": "Pat Owner", "email": "pat@acme.com" },
  "rotateKey": false }
```
→ `201` when created, `200` when updated.
```json
{ "organizationId": "…", "externalId": "…", "created": true,
  "apiKey": "inv_live_…",
  "owner": { "status": "created" | "exists" | "email_in_use", "passwordLinkSent": true },
  "branches": [{ "id": "…", "externalId": "br_1", "name": "North", "active": true }] }
```
- The call is idempotent. Call it at signup and whenever the org name or
  branches change.
- Every new branch gets a warehouse.
- `owner` is optional. It creates the company's first Inventory login (Super
  Admin) once, and emails a set-password link if email is configured.
  Otherwise the owner uses "Forgot password".
- An email that already belongs to another company is never reused; you get
  `email_in_use`.

### 3.2 Catalog (need d)

`GET /parts?q=&category=&limit=&cursor=`
- `q` matches name, SKU or an exact barcode.
- `limit` defaults to 50, maximum 100.
- Pass `nextCursor` back as `cursor` until it's `null`.

→ `{ parts: [Part], nextCursor }`

`GET /parts/{id}` → `{ part: Part }`

```
Part = { id, sku, name, description, category, barcode, unit: "each",
         unitCost: number|null, unitPrice: number|null, priceSource: "list"|"markup"|null }
```

`PUT /parts` `{ parts: [{ sku, name, description?, category?, barcode?, unitCost?, listPrice? }] }`
- Creates or updates up to 500 parts by SKU.
- `barcode` defaults to the SKU.
- Each row reports its own result:
  `{ results: [{ sku, id, status: "created"|"updated"|"error", error? }] }`.
- Store `id` in `ExternalRef(entityType = PART)`.

### 3.3 Trucks and stock (need c)

`GET /trucks?externalUserId=&branchExternalId=`
→ `{ trucks: [{ id, label, branch: { id, externalId, name }, crew: [{ externalUserId, name }] }] }`

`GET /trucks/{truckId}/stock`
→ `{ truck: { id, label, active }, stock: [{ quantity, part: Part }] }`, the live on-hand quantities.

`PUT /trucks/{truckId}/assignment` `{ crew: [{ externalUserId, name? }] }`
- Replaces who rides the truck. This replaces the Field App's `TruckTech`.
- Send it whenever assignments change.

`PUT /trucks/external/{externalTruckId}` `{ label, branchExternalId, active? }`
- Creates or updates the Inventory truck for a Field App truck.
- Returns `{ truck: { id, … }, created }`. Use `truck.id` everywhere else.

`POST /trucks/{truckId}/opening-stock` (Idempotency-Key) `{ items: [{ partId, quantity }] }`
- **Sets** each quantity rather than adding to it. This is for cutover.
- Each change is recorded as "Opening balance imported from the Field App".

### 3.4 Parts used on a job (needs a, b)

`POST /jobs/{externalJobId}/parts-used` (Idempotency-Key **required**)
```json
{ "jobNumber": "WO-5521", "truckId": "…",
  "usedBy": { "externalUserId": "usr_9", "name": "Tina Tech" },
  "onBehalf": false,
  "items": [{ "partId": "…", "quantity": 2 }], "notes": "optional" }
```
→ `201`
```json
{ "externalJobId": "…", "jobNumber": "WO-5521", "replayed": false,
  "lines": [{ "lineId": "…", "partId": "…", "sku": "CAP-45", "name": "…", "quantity": 2,
              "unitCost": 12.5, "unitPrice": 15.63, "remainingOnTruck": 2 }] }
```
- **All-or-nothing.** If any line is short, nothing is recorded.
- **Cost and price are frozen** on each line at this moment. Later price
  changes never alter what the job cost or bills.

`POST /jobs/{externalJobId}/parts-used/{lineId}/reverse` (Idempotency-Key required)
`{ quantity, reason, usedBy? }` → `201 { reversalId, lineId, quantity, remainingOnLine }`
- Puts parts back on the truck they came from.
- It is a reversing entry. Nothing is deleted.
- It can never return more than was used, even with concurrent calls.

`GET /jobs/{externalJobId}/parts-used` →
```json
{ "job": { "externalId": "…", "jobNumber": "WO-5521" },
  "lines": [{ "lineId", "part": { "id", "sku", "name" }, "truckId",
              "quantityUsed", "quantityReversed", "quantity",
              "unitCost", "unitPrice", "lineCost", "linePrice",
              "usedBy": { "externalUserId", "name" }, "usedAt", "notes" }],
  "totals": { "cost": 31.25, "price": 54.63, "unpricedLines": 0 } }
```
- `quantity` is net of reversals.
- An unknown job returns `lines: []`.
- Quotes, the completion sheet and invoices read **this**, replacing `JobPart`
  plus `Part.cost` and `PARTS_MARKUP`.

**Who may record parts. Both sides check:**
- **The Field App** checks `canWorkJob` (`src/lib/scope.ts`) for the acting
  user before calling. The legacy `/api/jobs/[id]/parts` gets this check at
  switchover.
- **Inventory** requires `usedBy.externalUserId` to be on the truck's crew →
  otherwise `403 not_assigned_to_truck`. Set `"onBehalf": true` only when a
  manager or dispatcher is recording for a tech.

### 3.5 Errors

Every error has the shape `{ error: string, code: string, ...details }`.

| Status | `code` | Meaning / what to do |
|---|---|---|
| 400 | `validation_failed` (with `details`), `invalid_json`, `idempotency_key_required` | Fix the request |
| 401 | `unauthorized` | Key missing, invalid, revoked or expired |
| 403 | `not_assigned_to_truck` | Assign the crew, or use `onBehalf` |
| 404 | `not_found`, `branch_not_found`, `part_not_found` | Includes another organization's records |
| 409 | `insufficient_stock` (with `partName`, `available`, `requested`) | Show it to the tech or dispatcher; don't drop it |
| 409 | `job_number_conflict` | That job number belongs to a different Field App job |
| 409 | `exceeds_used_quantity` (with `remaining`) | The reversal is larger than what's left on the line |
| 429 | `rate_limited` | Honour `Retry-After` |
| 5xx | `internal_error` | Safe to retry with the **same** Idempotency-Key |

## 4. Pricing (decided 2026-09-27: Inventory owns the price)

Each part has an optional list price. Without one, the price is unit cost
plus the organization's default markup (25% to start, set in Inventory →
Company settings). With neither, `unitPrice` is `null`, never a guessed $0.
The Field App's hard-coded `PARTS_MARKUP` in `src/lib/billing.ts` goes away
at switchover. The rule lives in `lib/pricing.ts`.

## 5. Offline and failure behaviour (Field App side)

A tech must never be blocked by the Inventory app being unreachable:
- Write "parts used" to a local outbox row with its Idempotency-Key.
- Send it immediately, then retry with backoff until the call is accepted.
- Show "pending sync" on the job until then.
- `409 insufficient_stock` goes to the tech or dispatcher to resolve. It is
  never silently dropped.

## 6. Reference run (verified over HTTP, 2026-09-27)

These steps were run end to end, in order, against a production build:
1. Provision the company, a branch and an owner.
2. Import 3 parts.
3. Import a truck.
4. Set opening stock.
5. Assign the crew.
6. Look up the tech's trucks.
7. Search the catalog.
8. A call without an Idempotency-Key → 400.
9. Record parts used.
10. The same call retried → replayed.
11. A user not on the crew → 403.
12. More than the truck holds → 409 insufficient_stock.
13. Reverse one unit.
14. A price change leaves the job's frozen totals unchanged.
15. The truck stock matches.
16. A bad key or no key → 401 JSON, not a redirect.
17. Another company's key → 404, or empty results.

The script is kept with the Inventory team's test tools.

## 7. Cutover plan

1. ✅ **Inventory side is live:** organizations, branches, API keys,
   `/api/v1`, frozen prices and reversals.
2. **Provision every existing Field App org** with `PUT /provision/orgs/…`.
   Store each key.
3. **One-time import per org.** Parts go in via `PUT /parts`, recording the
   `ExternalRef` ids. Then trucks via `PUT /trucks/external/…`, crews via
   `PUT /trucks/{id}/assignment`, and stock via
   `POST /trucks/{id}/opening-stock` from `TruckInventory`.
4. **Switch Field App screens over.** This covers the job Parts tab, the
   completion sheet, quotes, invoices, `/dashboard/trucks` and
   `/dashboard/parts`. Signup provisions the org instead of seeding sample
   parts locally.
5. **Retire the old tables.** Field App inventory tables go read-only, then
   are dropped after a verification period.
6. **Purchase orders move later.** They go to Inventory with the purchasing
   module; until then the Field App's PO screens stay frozen.

## 8. Not in v1

These are planned: webhooks (low stock, part changed), SSO between the apps,
warehouse-to-truck transfers from the Field App, and serialized parts.
