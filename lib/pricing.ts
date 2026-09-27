import { money, toNumber } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { currentOrgId } from "@/lib/tenant";

export type PriceSource = "list" | "markup";
export type PartPrice = { unitPrice: number | null; source: PriceSource | null };

/**
 * What a customer is charged for one unit. The part's own list price wins;
 * without one it's unit cost plus the organization's default markup. With
 * neither there's no price, which is reported as such, never guessed as $0.
 *
 * This is the single pricing rule for the suite: the Field App's quotes and
 * invoices read it through the API instead of applying their own markup.
 */
export function priceFor(
  part: { unitCost: unknown; listPrice: unknown },
  defaultMarkupPct: unknown
): PartPrice {
  if (part.listPrice !== null && part.listPrice !== undefined) {
    return { unitPrice: money(toNumber(part.listPrice)), source: "list" };
  }
  if (part.unitCost !== null && part.unitCost !== undefined) {
    return {
      unitPrice: money(toNumber(part.unitCost) * (1 + toNumber(defaultMarkupPct) / 100)),
      source: "markup",
    };
  }
  return { unitPrice: null, source: null };
}

/** The acting organization's default markup, in percent. */
export async function defaultMarkupPct(): Promise<number> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: currentOrgId() },
    select: { defaultMarkupPct: true },
  });
  return toNumber(org.defaultMarkupPct);
}
