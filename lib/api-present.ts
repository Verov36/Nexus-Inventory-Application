import { priceFor } from "@/lib/pricing";

// Shapes returned by /api/v1. Kept in one place so every endpoint describes a
// part, truck or branch the same way.

type PartRow = {
  id: string;
  sku: string;
  name: string;
  description?: string | null;
  category: string | null;
  barcodeValue: string;
  unitCost: unknown;
  listPrice: unknown;
};

export function partDto(part: PartRow, markupPct: number) {
  const price = priceFor(part, markupPct);
  return {
    id: part.id,
    sku: part.sku,
    name: part.name,
    description: part.description ?? null,
    category: part.category,
    barcode: part.barcodeValue,
    unit: "each",
    unitCost: part.unitCost === null || part.unitCost === undefined ? null : Number(part.unitCost),
    unitPrice: price.unitPrice,
    priceSource: price.source,
  };
}

export const partSelect = {
  id: true,
  sku: true,
  name: true,
  description: true,
  category: true,
  barcodeValue: true,
  unitCost: true,
  listPrice: true,
} as const;
