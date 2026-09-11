-- Purchasing fields for the reorder list.
ALTER TABLE "Part" ADD COLUMN "supplier" TEXT;
ALTER TABLE "Part" ADD COLUMN "supplierPartNumber" TEXT;
ALTER TABLE "Part" ADD COLUMN "reorderQty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Part" ADD COLUMN "orderedAt" TIMESTAMP(3);
ALTER TABLE "Part" ADD COLUMN "orderedQty" INTEGER;
ALTER TABLE "Part" ADD COLUMN "orderedById" TEXT;
