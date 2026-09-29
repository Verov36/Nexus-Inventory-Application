import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, withPlatformKey } from "@/lib/api";
import { issueApiKey } from "@/lib/api-keys";
import { createOrganization } from "@/lib/organizations";
import { runAsOrg, runUnscoped } from "@/lib/tenant";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { canSendLinks, sendEmail } from "@/lib/email";
import { createPasswordLink, escapeHtml } from "@/lib/password-reset";

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  branches: z
    .array(
      z.object({
        externalId: z.string().trim().min(1).max(100),
        name: z.string().trim().min(1).max(120),
        timezone: z.string().trim().max(64).optional(),
      })
    )
    .min(1)
    .max(500),
  // Issue a new key; the previous ones keep working for 24 hours.
  rotateKey: z.boolean().optional(),
  // The company's first Inventory login (Super Admin). Created once; they set
  // their password from an emailed link, or via "Forgot password".
  owner: z.object({ name: z.string().trim().min(1).max(120), email: z.string().trim().toLowerCase().email() }).optional(),
});

// PUT /api/v1/provision/orgs/{externalOrgId}  (platform key)
// Creates or updates the Inventory organization for a Field App organization
// and its branches. The organization's API key is returned only when it's
// first created or when rotateKey is true — store it then.
async function handlePUT(req: NextRequest, ctx: { params: Promise<{ externalOrgId: string }> }) {
  const { externalOrgId } = await ctx.params;
  if (!externalOrgId || externalOrgId.length > 100) return apiError(400, "validation_failed", "Bad organization id.");
  const read = await readJson(req, schema);
  if ("response" in read) return read.response;
  const body = read.data;

  const existing = await runUnscoped("provisioning looks up an organization by its Field App id", () =>
    prisma.organization.findUnique({ where: { externalId: externalOrgId }, select: { id: true } })
  );

  let organizationId: string;
  let created = false;
  let apiKey: string | undefined;
  let ownerStatus: OwnerStatus | undefined;
  if (existing) {
    organizationId = existing.id;
  } else {
    try {
      const [first] = body.branches;
      const result = await runUnscoped("provisioning creates an organization", () =>
        prisma.$transaction(async (tx) => {
          const made = await createOrganization(tx, {
            name: body.name,
            externalId: externalOrgId,
            branch: { name: first.name, externalId: first.externalId, timezone: first.timezone },
          });
          const issued = await runAsOrg(made.organization.id, () => issueApiKey(tx, "Field App"));
          return { organizationId: made.organization.id, key: issued.key };
        })
      );
      organizationId = result.organizationId;
      apiKey = result.key;
      created = true;
    } catch (err) {
      // Provisioned by a concurrent request a moment ago: carry on as an update.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
      const now = await runUnscoped("provisioning re-reads after a race", () =>
        prisma.organization.findUniqueOrThrow({ where: { externalId: externalOrgId }, select: { id: true } })
      );
      organizationId = now.id;
    }
  }

  const branches = await runAsOrg(organizationId, async () => {
    await prisma.organization.update({ where: { id: organizationId }, data: { name: body.name } });
    for (const b of body.branches) {
      const found = await prisma.branch.findFirst({ where: { externalId: b.externalId }, select: { id: true } });
      if (found) {
        await prisma.branch.update({
          where: { id: found.id },
          data: { name: b.name, active: true, ...(b.timezone ? { timezone: b.timezone } : {}) },
        });
      } else {
        const branch = await prisma.branch.create({
          data: { name: b.name, externalId: b.externalId, ...(b.timezone ? { timezone: b.timezone } : {}) },
        });
        // Every branch gets a warehouse to receive into.
        await prisma.warehouse.create({ data: { name: `${b.name} warehouse`, branchId: branch.id } });
      }
    }
    if (body.owner) ownerStatus = await ensureOwner(body.owner, body.name);
    if (body.rotateKey && !created) {
      apiKey = (await prisma.$transaction((tx) => issueApiKey(tx, "Field App", { rotate: true }))).key;
    }
    return prisma.branch.findMany({
      select: { id: true, externalId: true, name: true, active: true },
      orderBy: { createdAt: "asc" },
    });
  });

  return NextResponse.json(
    { organizationId, externalId: externalOrgId, created, ...(apiKey ? { apiKey } : {}), ...(ownerStatus ? { owner: ownerStatus } : {}), branches },
    { status: created ? 201 : 200 }
  );
}

type OwnerStatus = { status: "created" | "exists" | "email_in_use"; passwordLinkSent: boolean };

/** Runs inside the organization. */
async function ensureOwner(owner: { name: string; email: string }, companyName: string): Promise<OwnerStatus> {
  const email = owner.email;
  const anywhere = await runUnscoped("emails are unique system-wide", () =>
    prisma.user.findUnique({ where: { email }, select: { id: true, organizationId: true } })
  );
  const here = await prisma.user.findFirst({ where: { email }, select: { id: true } });
  if (here) return { status: "exists", passwordLinkSent: false };
  if (anywhere) return { status: "email_in_use", passwordLinkSent: false };

  const user = await prisma.user.create({
    data: {
      name: owner.name,
      email,
      role: "SUPER_ADMIN",
      // Unusable until they set their own through the link.
      passwordHash: await bcrypt.hash(randomBytes(32).toString("hex"), 10),
    },
    select: { id: true },
  });
  if (!canSendLinks()) return { status: "created", passwordLinkSent: false };
  const link = await createPasswordLink(user.id, 72 * 60);
  const sent = await sendEmail({
    to: email,
    subject: `Your ${companyName} inventory account`,
    text: `Hi ${owner.name},\n\nYour company's parts inventory is ready. Set your password within 72 hours:\n\n${link}\n\nAfter that, use "Forgot password" on the sign-in page.`,
    html: `<p>Hi ${escapeHtml(owner.name)},</p><p>Your company's parts inventory is ready. Set your password within 72 hours:</p><p><a href="${link}">${link}</a></p><p>After that, use "Forgot password" on the sign-in page.</p>`,
  })
    .then(() => true)
    .catch((err) => {
      console.error("Owner welcome email failed:", err);
      return false;
    });
  return { status: "created", passwordLinkSent: sent };
}

export const PUT = withPlatformKey(handlePUT);
