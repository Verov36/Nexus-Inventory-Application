-- CreateEnum
CREATE TYPE "TruckCountStatus" AS ENUM ('OPEN', 'SUBMITTED', 'APPLIED', 'DISCARDED');

-- CreateTable
CREATE TABLE "TruckCount" (
    "id" TEXT NOT NULL,
    "truckId" TEXT NOT NULL,
    "startedById" TEXT NOT NULL,
    "status" "TruckCountStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "TruckCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TruckCountLine" (
    "id" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "expectedQty" INTEGER NOT NULL,
    "countedQty" INTEGER,

    CONSTRAINT "TruckCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TruckCountLine_countId_partId_key" ON "TruckCountLine"("countId", "partId");

-- AddForeignKey
ALTER TABLE "TruckCount" ADD CONSTRAINT "TruckCount_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TruckCount" ADD CONSTRAINT "TruckCount_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TruckCount" ADD CONSTRAINT "TruckCount_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TruckCountLine" ADD CONSTRAINT "TruckCountLine_countId_fkey" FOREIGN KEY ("countId") REFERENCES "TruckCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TruckCountLine" ADD CONSTRAINT "TruckCountLine_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
