// Shared helpers for tests that hit a real Postgres. They run only when
// TEST_DATABASE_URL is set (CI provides one; locally point it at a scratch
// database — every table is truncated between tests).
//
// DATABASE_URL is overridden before lib/prisma is imported so the app's own
// client talks to the test database.

import { vi } from "vitest";
import bcrypt from "bcryptjs";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const hasDatabase = !!TEST_DATABASE_URL;
if (hasDatabase) process.env.DATABASE_URL = TEST_DATABASE_URL;

export async function getPrisma() {
  const { prisma } = await import("@/lib/prisma");
  return prisma;
}

export async function resetDatabase() {
  const prisma = await getPrisma();
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "TruckCountLine", "TruckCount", "PasswordResetToken", "OverageJustification", "PartUsage",
      "InventoryTransaction", "TruckStockLimit", "StockLevel", "Job", "Truck", "Part", "Warehouse",
      "ReportSnapshot", "ReportSchedule", "User"
    RESTART IDENTITY CASCADE
  `);
}

export type Seeded = Awaited<ReturnType<typeof seedBasics>>;

/** A warehouse, a manager, a tech on a truck, and two parts with stock. */
export async function seedBasics() {
  const prisma = await getPrisma();
  const passwordHash = await bcrypt.hash("password123", 4);
  const warehouse = await prisma.warehouse.create({ data: { id: "wh-test", name: "Test warehouse" } });
  const manager = await prisma.user.create({
    data: { name: "Mia Manager", email: "manager@test.local", passwordHash, role: "MANAGER" },
  });
  const tech = await prisma.user.create({
    data: { name: "Tom Tech", email: "tech@test.local", passwordHash, role: "TRUCK_TECH" },
  });
  const otherTech = await prisma.user.create({
    data: { name: "Olive Other", email: "other@test.local", passwordHash, role: "TRUCK_TECH" },
  });
  const truck = await prisma.truck.create({ data: { label: "Truck 1", techId: tech.id } });
  const otherTruck = await prisma.truck.create({ data: { label: "Truck 2", techId: otherTech.id } });
  const capacitor = await prisma.part.create({
    data: { sku: "CAP-45", name: "Capacitor 45/5", barcodeValue: "CAP45", category: "Electrical", unitCost: "12.50" },
  });
  const filter = await prisma.part.create({
    data: { sku: "FLT-16", name: "Filter 16x25", barcodeValue: "FLT16", category: "Filters", unitCost: "4.00" },
  });
  await prisma.stockLevel.createMany({
    data: [
      { partId: capacitor.id, warehouseId: warehouse.id, locationType: "WAREHOUSE", quantity: 10 },
      { partId: filter.id, warehouseId: warehouse.id, locationType: "WAREHOUSE", quantity: 20 },
    ],
  });
  return { prisma, warehouse, manager, tech, otherTech, truck, otherTruck, capacitor, filter };
}

export async function warehouseQty(partId: string, warehouseId: string) {
  const prisma = await getPrisma();
  const sl = await prisma.stockLevel.findFirst({ where: { partId, warehouseId, truckId: null } });
  return sl?.quantity ?? 0;
}

export async function truckQty(partId: string, truckId: string) {
  const prisma = await getPrisma();
  const sl = await prisma.stockLevel.findFirst({ where: { partId, truckId, warehouseId: null } });
  return sl?.quantity ?? 0;
}

/**
 * Route handlers call auth() from lib/auth; swap it for a stub so tests can
 * act as any user without a browser session. Call before importing a route.
 */
export function mockAuthAs(user: { id: string; role: string; name?: string } | null) {
  vi.doMock("@/lib/auth", () => ({
    auth: vi.fn(async () => (user ? { user: { id: user.id, role: user.role, name: user.name ?? "Test" } } : null)),
  }));
}

export function jsonRequest(url: string, method: string, body?: unknown) {
  // NextRequest is a Request subclass; a plain Request works for handlers
  // that only read json()/headers, but routes use req.nextUrl, so build one.
  return import("next/server").then(
    ({ NextRequest }) =>
      new NextRequest(`http://localhost${url}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
  );
}
