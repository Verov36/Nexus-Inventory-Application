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
  const manager = await prisma.user.upsert({
    where: { email: "manager@example.com" },
    update: {},
    create: {
      name: "Demo Manager",
      email: "manager@example.com",
      passwordHash,
      role: "MANAGER",
    },
  });

  console.log("Seeded warehouse:", warehouse.id);
  console.log("Seeded manager login: manager@example.com / changeme123 (user id " + manager.id + ")");
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
