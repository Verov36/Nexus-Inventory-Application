-- Postgres treats NULL as distinct in a normal unique index, so
-- StockLevel(partId, warehouseId, truckId) and TruckStockLimit(truckId,
-- partId, category) never actually stop duplicate warehouse/category rows
-- under concurrent writes. These partial indexes close that gap. They were
-- previously in prisma/manual-fixes.sql and had to be applied by hand; now
-- they ship with the migrations. IF NOT EXISTS keeps this safe on databases
-- where the manual script already ran.

CREATE UNIQUE INDEX IF NOT EXISTS "stock_level_warehouse_unique"
  ON "StockLevel" ("partId", "warehouseId") WHERE "truckId" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "stock_level_truck_unique"
  ON "StockLevel" ("partId", "truckId") WHERE "warehouseId" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "truck_limit_part_unique"
  ON "TruckStockLimit" ("truckId", "partId") WHERE "category" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "truck_limit_category_unique"
  ON "TruckStockLimit" ("truckId", "category") WHERE "partId" IS NULL;
