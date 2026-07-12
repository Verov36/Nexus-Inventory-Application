-- Run this once after `prisma migrate dev --name init`, or fold it into that
-- migration's generated SQL before applying. Postgres treats NULL as distinct
-- in a normal unique index, so StockLevel(partId, warehouseId, truckId) and
-- TruckStockLimit(truckId, partId, category) don't actually stop duplicate
-- warehouse/category rows under concurrent writes. Partial indexes fix that.

CREATE UNIQUE INDEX IF NOT EXISTS stock_level_warehouse_unique
  ON "StockLevel" ("partId", "warehouseId") WHERE "truckId" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS stock_level_truck_unique
  ON "StockLevel" ("partId", "truckId") WHERE "warehouseId" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS truck_limit_part_unique
  ON "TruckStockLimit" ("truckId", "partId") WHERE "category" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS truck_limit_category_unique
  ON "TruckStockLimit" ("truckId", "category") WHERE "partId" IS NULL;
