import type { Tx } from "@/lib/prisma";
import { runAsOrg } from "@/lib/tenant";

export type NewOrganization = {
  name: string;
  externalId?: string;
  branch: { name: string; externalId?: string; timezone?: string };
  warehouseName?: string;
};

/**
 * Creates an organization with its first branch, a warehouse for that branch
 * and its report schedule. Used by first-run setup and (next) by the Field
 * App provisioning API, so every organization starts out the same shape.
 * Must run inside a transaction.
 */
export async function createOrganization(tx: Tx, input: NewOrganization) {
  const organization = await tx.organization.create({
    data: { name: input.name, externalId: input.externalId },
  });
  return runAsOrg(organization.id, async () => {
    const branch = await tx.branch.create({
      data: {
        name: input.branch.name,
        externalId: input.branch.externalId,
        ...(input.branch.timezone ? { timezone: input.branch.timezone } : {}),
      },
    });
    const warehouse = await tx.warehouse.create({
      data: { name: input.warehouseName ?? `${input.branch.name} warehouse`, branchId: branch.id },
    });
    await tx.reportSchedule.create({ data: { frequencyDays: 7 } });
    return { organization, branch, warehouse };
  });
}
