-- Organizations (companies) and branches. Every inventory record now belongs
-- to exactly one organization; warehouses and trucks also to a branch.
--
-- An existing single-company database is carried over intact: if it has any
-- data, one "Default organization" with a "Main branch" is created and every
-- existing row is assigned to it before the new columns become required.

-- 1. New tables ---------------------------------------------------------------
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "externalId" TEXT,
    "defaultMarkupPct" DECIMAL(5,2) NOT NULL DEFAULT 25,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "externalId" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- 2. Adopt existing data -------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "User") OR EXISTS (SELECT 1 FROM "Part")
     OR EXISTS (SELECT 1 FROM "Warehouse") OR EXISTS (SELECT 1 FROM "Truck") THEN
    INSERT INTO "Organization" ("id", "name") VALUES ('org_default', 'Default organization');
    INSERT INTO "Branch" ("id", "organizationId", "name") VALUES ('branch_default', 'org_default', 'Main branch');
  END IF;
END $$;

-- 3. Columns: add nullable, backfill, then require ----------------------------
ALTER TABLE "User"                 ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Part"                 ADD COLUMN "organizationId" TEXT, ADD COLUMN "listPrice" DECIMAL(10,2);
ALTER TABLE "Warehouse"            ADD COLUMN "organizationId" TEXT, ADD COLUMN "branchId" TEXT;
ALTER TABLE "Truck"                ADD COLUMN "organizationId" TEXT, ADD COLUMN "branchId" TEXT;
ALTER TABLE "TruckCount"           ADD COLUMN "organizationId" TEXT;
ALTER TABLE "StockLevel"           ADD COLUMN "organizationId" TEXT;
ALTER TABLE "TruckStockLimit"      ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Job"                  ADD COLUMN "organizationId" TEXT, ADD COLUMN "externalId" TEXT;
ALTER TABLE "InventoryTransaction" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "OverageJustification" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "ReportSchedule"       ADD COLUMN "organizationId" TEXT;
ALTER TABLE "ReportSnapshot"       ADD COLUMN "organizationId" TEXT;

UPDATE "User"                 SET "organizationId" = 'org_default';
UPDATE "Part"                 SET "organizationId" = 'org_default';
UPDATE "Warehouse"            SET "organizationId" = 'org_default', "branchId" = 'branch_default';
UPDATE "Truck"                SET "organizationId" = 'org_default', "branchId" = 'branch_default';
UPDATE "TruckCount"           SET "organizationId" = 'org_default';
UPDATE "StockLevel"           SET "organizationId" = 'org_default';
UPDATE "TruckStockLimit"      SET "organizationId" = 'org_default';
UPDATE "Job"                  SET "organizationId" = 'org_default';
UPDATE "InventoryTransaction" SET "organizationId" = 'org_default';
UPDATE "OverageJustification" SET "organizationId" = 'org_default';
UPDATE "ReportSnapshot"       SET "organizationId" = 'org_default';
-- One schedule per organization: keep the most recently updated if there were several.
DELETE FROM "ReportSchedule" r
WHERE EXISTS (SELECT 1 FROM "ReportSchedule" n WHERE n."updatedAt" > r."updatedAt");
UPDATE "ReportSchedule"       SET "organizationId" = 'org_default';

ALTER TABLE "User"                 ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Part"                 ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Warehouse"            ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "Truck"                ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "TruckCount"           ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "StockLevel"           ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "TruckStockLimit"      ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Job"                  ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "InventoryTransaction" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "OverageJustification" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "ReportSchedule"       ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "ReportSnapshot"       ALTER COLUMN "organizationId" SET NOT NULL;

-- 4. Uniqueness is per organization now ----------------------------------------
DROP INDEX "Job_jobNumber_key";
DROP INDEX "Part_barcodeValue_key";
DROP INDEX "Part_sku_key";

CREATE UNIQUE INDEX "Organization_externalId_key" ON "Organization"("externalId");
CREATE INDEX "Branch_organizationId_idx" ON "Branch"("organizationId");
CREATE UNIQUE INDEX "Branch_organizationId_externalId_key" ON "Branch"("organizationId", "externalId");
CREATE UNIQUE INDEX "Job_organizationId_jobNumber_key" ON "Job"("organizationId", "jobNumber");
CREATE UNIQUE INDEX "Job_organizationId_externalId_key" ON "Job"("organizationId", "externalId");
CREATE UNIQUE INDEX "Part_organizationId_sku_key" ON "Part"("organizationId", "sku");
CREATE UNIQUE INDEX "Part_organizationId_barcodeValue_key" ON "Part"("organizationId", "barcodeValue");
CREATE UNIQUE INDEX "ReportSchedule_organizationId_key" ON "ReportSchedule"("organizationId");

-- 5. Indexes the ledger and lists were missing ---------------------------------
CREATE INDEX "InventoryTransaction_organizationId_createdAt_idx" ON "InventoryTransaction"("organizationId", "createdAt");
CREATE INDEX "InventoryTransaction_organizationId_type_createdAt_idx" ON "InventoryTransaction"("organizationId", "type", "createdAt");
CREATE INDEX "InventoryTransaction_partId_createdAt_idx" ON "InventoryTransaction"("partId", "createdAt");
CREATE INDEX "InventoryTransaction_toTruckId_partId_idx" ON "InventoryTransaction"("toTruckId", "partId");
CREATE INDEX "InventoryTransaction_fromTruckId_partId_idx" ON "InventoryTransaction"("fromTruckId", "partId");
CREATE INDEX "OverageJustification_organizationId_status_createdAt_idx" ON "OverageJustification"("organizationId", "status", "createdAt");
CREATE INDEX "ReportSnapshot_organizationId_generatedAt_idx" ON "ReportSnapshot"("organizationId", "generatedAt");
CREATE INDEX "StockLevel_organizationId_idx" ON "StockLevel"("organizationId");
CREATE INDEX "StockLevel_truckId_idx" ON "StockLevel"("truckId");
CREATE INDEX "Truck_organizationId_idx" ON "Truck"("organizationId");
CREATE INDEX "TruckCount_organizationId_status_idx" ON "TruckCount"("organizationId", "status");
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");
CREATE INDEX "Warehouse_organizationId_idx" ON "Warehouse"("organizationId");

-- 6. Foreign keys --------------------------------------------------------------
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Part" ADD CONSTRAINT "Part_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Truck" ADD CONSTRAINT "Truck_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Truck" ADD CONSTRAINT "Truck_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TruckCount" ADD CONSTRAINT "TruckCount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TruckStockLimit" ADD CONSTRAINT "TruckStockLimit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "Job_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OverageJustification" ADD CONSTRAINT "OverageJustification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReportSchedule" ADD CONSTRAINT "ReportSchedule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReportSnapshot" ADD CONSTRAINT "ReportSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 7. organizationId defaults to the organization the database session is
--    acting for. The app always sets it explicitly (lib/prisma.ts); with no
--    organization set, current_setting() raises, so an unscoped insert fails
--    instead of creating an orphan row.
ALTER TABLE "Branch" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.organization_id');
ALTER TABLE "User" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.organization_id');
ALTER TABLE "Part" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.organization_id');
ALTER TABLE "Warehouse" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.organization_id');
ALTER TABLE "Truck" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.organization_id');
ALTER TABLE "TruckCount" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.organization_id');
ALTER TABLE "StockLevel" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.organization_id');
ALTER TABLE "TruckStockLimit" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.organization_id');
ALTER TABLE "Job" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.organization_id');
ALTER TABLE "InventoryTransaction" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.organization_id');
ALTER TABLE "OverageJustification" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.organization_id');
ALTER TABLE "ReportSchedule" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.organization_id');
ALTER TABLE "ReportSnapshot" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.organization_id');
