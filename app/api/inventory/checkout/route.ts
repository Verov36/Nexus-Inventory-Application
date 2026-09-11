import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  InsufficientStockError,
  adjustTruckStock,
  adjustWarehouseStock,
  findOrCreateJob,
  getApplicableLimit,
  getTruckStock,
  getWarehouseStock,
  resolveWarehouseId,
} from "@/lib/inventory";
import { canCheckoutToTruck, canManageTrucksAndLimits } from "@/lib/roles";

const checkoutSchema = z
  .object({
    partId: z.string().min(1),
    truckId: z.string().min(1),
    warehouseId: z.string().optional().nullable(),
    quantity: z.number().int().positive(),
    checkoutType: z.enum(["JOB_USE", "RESTOCK"]),
    jobNumber: z.string().trim().optional(),
    // Only present when the tech is resolving a limit block on this same request
    justification: z
      .object({
        explanation: z.string().trim().min(1),
        relatedJobNumbers: z.array(z.string().trim().min(1)).min(1),
      })
      .optional(),
  })
  .refine((d) => d.checkoutType === "RESTOCK" || !!d.jobNumber, {
    message: "jobNumber is required for JOB_USE checkouts",
    path: ["jobNumber"],
  });

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const role = (session.user as { role?: string }).role;
  if (!canCheckoutToTruck(role)) {
    return NextResponse.json(
      { error: "Only a truck tech (or admin) can check parts out to a truck." },
      { status: 403 }
    );
  }
  const userId = session.user.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { partId, truckId, quantity, checkoutType, jobNumber, justification } = parsed.data;

  const warehouseId = await resolveWarehouseId(parsed.data.warehouseId);
  if (!warehouseId) {
    return NextResponse.json(
      { error: "No warehouse is configured yet — run the seed or set NEXT_PUBLIC_DEFAULT_WAREHOUSE_ID." },
      { status: 404 }
    );
  }

  const part = await prisma.part.findUnique({ where: { id: partId } });
  if (!part) return NextResponse.json({ error: "Part not found" }, { status: 404 });

  const truck = await prisma.truck.findUnique({ where: { id: truckId } });
  if (!truck) return NextResponse.json({ error: "Truck not found" }, { status: 404 });
  if (!truck.active) {
    return NextResponse.json({ error: `${truck.label} is deactivated — pick an active truck.` }, { status: 409 });
  }
  // A tech can only load their own truck. Managers/admins can load any truck
  // (covering a tech's truck while they're out, or a spare).
  if (!canManageTrucksAndLimits(role) && truck.techId !== userId) {
    return NextResponse.json(
      { error: "You can only check parts out to the truck assigned to you. Ask a manager to assign it." },
      { status: 403 }
    );
  }

  const warehouseStock = await getWarehouseStock(partId, warehouseId);
  if (!warehouseStock || warehouseStock.quantity < quantity) {
    return NextResponse.json(
      { error: `Only ${warehouseStock?.quantity ?? 0} of ${part.name} available in the warehouse` },
      { status: 409 }
    );
  }

  const truckStock = await getTruckStock(partId, truckId);
  const currentTruckQty = truckStock?.quantity ?? 0;
  const projectedQty = currentTruckQty + quantity;

  const limit = await getApplicableLimit(truckId, partId, part.category);
  const overLimit = !!limit && projectedQty > limit.maxQty;

  if (overLimit && checkoutType === "RESTOCK") {
    // Restocking is exactly what fills the truck up to its cap — no
    // justification path, the cap is the cap.
    return NextResponse.json(
      {
        error: `That would put ${part.name} at ${projectedQty} on this truck, over the manager-set cap of ${limit!.maxQty}.`,
      },
      { status: 409 }
    );
  }

  if (overLimit && checkoutType === "JOB_USE" && !justification) {
    // Block the checkout and tell the UI it needs an explanation + related
    // job numbers before this can proceed.
    return NextResponse.json(
      {
        requiresJustification: true,
        currentTruckQty,
        limit: limit!.maxQty,
        message: `This truck is already at ${currentTruckQty} of ${part.name} against a cap of ${limit!.maxQty}. Explain what jobs the current stock is accounted for on before checking out more.`,
      },
      { status: 409 }
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      await adjustWarehouseStock(tx, partId, warehouseId, -quantity);
      await adjustTruckStock(tx, partId, truckId, quantity);

      const transaction = await tx.inventoryTransaction.create({
        data: {
          type: "CHECKOUT",
          checkoutType,
          partId,
          quantity,
          fromLocationType: "WAREHOUSE",
          fromWarehouseId: warehouseId,
          toLocationType: "TRUCK",
          toTruckId: truckId,
          performedById: userId,
        },
      });

      if (checkoutType === "JOB_USE" && jobNumber) {
        const job = await findOrCreateJob(tx, jobNumber);
        await tx.partUsage.create({ data: { transactionId: transaction.id, jobId: job.id } });
      }

      if (overLimit && justification) {
        await tx.overageJustification.create({
          data: {
            transactionId: transaction.id,
            truckId,
            submittedById: userId,
            explanation: justification.explanation,
            relatedJobNumbers: justification.relatedJobNumbers,
            status: "PENDING",
          },
        });
      }

      return transaction;
    });

    return NextResponse.json({ transaction: result }, { status: 201 });
  } catch (err) {
    if (err instanceof InsufficientStockError) {
      return NextResponse.json(
        { error: `Only ${err.available} of ${part.name} available in the warehouse — someone else may have just taken some.` },
        { status: 409 }
      );
    }
    console.error("Checkout failed:", err);
    return NextResponse.json(
      { error: "Something went wrong recording this checkout. Nothing was moved — try again." },
      { status: 500 }
    );
  }
}
