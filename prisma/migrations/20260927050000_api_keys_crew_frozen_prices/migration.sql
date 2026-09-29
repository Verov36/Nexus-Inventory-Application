-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'CONSUME_REVERSAL';

-- AlterTable
ALTER TABLE "InventoryTransaction" ADD COLUMN     "performedByExternalId" TEXT,
ADD COLUMN     "performedByName" TEXT,
ADD COLUMN     "reversesId" TEXT,
ADD COLUMN     "unitCost" DECIMAL(10,2),
ADD COLUMN     "unitPrice" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isServiceAccount" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TruckCrew" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT current_setting('app.organization_id'::text),
    "truckId" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TruckCrew_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT current_setting('app.organization_id'::text),
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TruckCrew_organizationId_externalUserId_idx" ON "TruckCrew"("organizationId", "externalUserId");

-- CreateIndex
CREATE UNIQUE INDEX "TruckCrew_truckId_externalUserId_key" ON "TruckCrew"("truckId", "externalUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_hash_key" ON "ApiKey"("hash");

-- CreateIndex
CREATE INDEX "ApiKey_organizationId_idx" ON "ApiKey"("organizationId");

-- CreateIndex
CREATE INDEX "InventoryTransaction_reversesId_idx" ON "InventoryTransaction"("reversesId");

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "InventoryTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TruckCrew" ADD CONSTRAINT "TruckCrew_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TruckCrew" ADD CONSTRAINT "TruckCrew_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Parts already used on jobs before prices were frozen per use: stamp them
-- with the part's current cost and price, the best record available.
UPDATE "InventoryTransaction" t
SET "unitCost" = p."unitCost",
    "unitPrice" = COALESCE(p."listPrice", ROUND(p."unitCost" * (1 + o."defaultMarkupPct" / 100), 2))
FROM "Part" p, "Organization" o
WHERE t."partId" = p."id" AND o."id" = t."organizationId"
  AND t."type" = 'CONSUME' AND t."unitCost" IS NULL;
