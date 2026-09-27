-- AlterTable
ALTER TABLE "TruckCountLine" ADD COLUMN     "appliedDelta" INTEGER,
ADD COLUMN     "countedAt" TIMESTAMP(3);

-- Lines counted before this migration: treat them as counted when the count
-- was submitted (or started), the best available approximation.
UPDATE "TruckCountLine" l SET "countedAt" = COALESCE(c."submittedAt", c."createdAt")
FROM "TruckCount" c
WHERE l."countId" = c."id" AND l."countedQty" IS NOT NULL AND l."countedAt" IS NULL;

-- At most one in-progress (OPEN or SUBMITTED) count per truck, enforced by
-- the database so two simultaneous "start count" taps can't both succeed.
-- If duplicates already exist, keep the newest and discard the rest first.
UPDATE "TruckCount" t SET "status" = 'DISCARDED'
WHERE t."status" IN ('OPEN', 'SUBMITTED')
  AND EXISTS (
    SELECT 1 FROM "TruckCount" n
    WHERE n."truckId" = t."truckId" AND n."status" IN ('OPEN', 'SUBMITTED') AND n."createdAt" > t."createdAt"
  );
CREATE UNIQUE INDEX "truck_count_one_in_progress"
  ON "TruckCount" ("truckId") WHERE "status" IN ('OPEN', 'SUBMITTED');
