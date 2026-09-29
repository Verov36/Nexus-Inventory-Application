-- AlterTable
ALTER TABLE "Truck" ADD COLUMN     "externalId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Truck_organizationId_externalId_key" ON "Truck"("organizationId", "externalId");

