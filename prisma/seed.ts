import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const warehouse = await prisma.warehouse.upsert({
    where: { id: "main-warehouse" },
    update: {},
    create: { id: "main-warehouse", name: "Main warehouse" },
  });

  const passwordHash = await bcrypt.hash("changeme123", 10);
  const superAdmin = await prisma.user.upsert({
    where: { email: "chris@example.com" },
    update: {},
    create: {
      name: "Chris",
      email: "chris@example.com",
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
  console.log("Seeded super admin login: chris@example.com / changeme123 (user id " + superAdmin.id + ")");
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
