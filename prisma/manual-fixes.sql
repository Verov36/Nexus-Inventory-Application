-- Superseded: these partial unique indexes now live in
-- prisma/migrations/20260911120000_partial_unique_indexes and are applied by
-- `prisma migrate deploy` (which runs automatically on `npm start`). This file
-- is kept only so older setup notes still point at something; running it
-- again is harmless (every statement is IF NOT EXISTS).

CREATE UNIQUE INDEX IF NOT EXISTS stock_level_warehouse_unique
  ON "StockLevel" ("partId", "warehouseId") WHERE "truckId" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS stock_level_truck_unique
  ON "StockLevel" ("partId", "truckId") WHERE "warehouseId" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS truck_limit_part_unique
  ON "TruckStockLimit" ("truckId", "partId") WHERE "category" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS truck_limit_category_unique
  ON "TruckStockLimit" ("truckId", "category") WHERE "partId" IS NULL;
