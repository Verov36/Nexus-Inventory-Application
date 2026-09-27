import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

const prisma = new PrismaClient();

async function main() {
  // Demo data only. A production database is set up through /setup, which
  // requires SETUP_TOKEN — never with a well-known seeded login.
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PRODUCTION_SEED !== "1") {
    throw new Error("Refusing to seed a production database. Use /setup instead.");
  }

  const warehouse = await prisma.warehouse.upsert({
    where: { id: "main-warehouse" },
    update: {},
    create: { id: "main-warehouse", name: "Main warehouse" },
  });

  // A fresh random password each time the account is created, printed once.
  const password = process.env.SEED_ADMIN_PASSWORD || randomBytes(9).toString("base64url");
  const passwordHash = await bcrypt.hash(password, 10);
  const email = process.env.SEED_ADMIN_EMAIL || "admin@example.com";
  const existing = await prisma.user.findUnique({ where: { email } });
  const superAdmin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      name: "Admin",
      email,
      passwordHash,
      role: "SUPER_ADMIN",
    },
  });

  await prisma.reportSchedule.upsert({
    where: { id: "default-schedule" },
    update: {},
    create: { id: "default-schedule", frequencyDays: 7 },
  });

  console.log("Seeded warehouse:", warehouse.id);
  if (existing) console.log(`Super admin ${email} already exists (password unchanged).`);
  else console.log(`Seeded super admin login: ${email} / ${password}  (user id ${superAdmin.id}) — change it after signing in.`);
  console.log("Set NEXT_PUBLIC_DEFAULT_WAREHOUSE_ID=" + warehouse.id + " in .env.local");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
