import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { runUnscoped } from "@/lib/tenant";
import { canSendLinks, sendEmail } from "@/lib/email";
import { createPasswordLink, escapeHtml } from "@/lib/password-reset";
import { clientIp, rateLimitAll, tooManyRequests } from "@/lib/rate-limit";

const schema = z.object({ email: z.string().trim().toLowerCase().email() });
const TOKEN_TTL_MINUTES = 30;

// POST /api/auth/forgot { email }
// Always answers 200 with the same shape whether or not the address exists,
// so the form can't be used to discover which emails have accounts. When
// email isn't configured it says so, and the page tells the person to ask
// an admin to set a temporary password instead.
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  // Per address so nobody can flood someone's inbox; per source so the form
  // can't be scripted across many addresses.
  const limit = await rateLimitAll([
    [`forgot:email:${parsed.data.email}`, 3, 15 * 60],
    [`forgot:ip:${clientIp(req.headers)}`, 10, 15 * 60],
  ]);
  if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds);

  if (!canSendLinks()) {
    return NextResponse.json({ ok: true, emailConfigured: false });
  }

  // Signed-out, by email: looks across every organization (emails are unique system-wide).
  const user = await runUnscoped("password reset by email", () =>
    prisma.user.findFirst({ where: { email: { equals: parsed.data.email, mode: "insensitive" } } })
  );
  if (user && !user.disabledAt) {
    const link = await createPasswordLink(user.id, TOKEN_TTL_MINUTES);
    // Sent after the response: waiting on the mail provider only for real
    // accounts would let response time (or a send failure) reveal which
    // emails exist.
    const { email: to, name } = user;
    after(() =>
      sendEmail({
        to,
        subject: "Reset your Nexus Inventory password",
        text: `Hi ${name},\n\nSomeone asked to reset the password for this account. If that was you, open this link within ${TOKEN_TTL_MINUTES} minutes:\n\n${link}\n\nIf it wasn't you, ignore this email — nothing changes until the link is used.`,
        html: `<p>Hi ${escapeHtml(name)},</p><p>Someone asked to reset the password for this account. If that was you, open this link within ${TOKEN_TTL_MINUTES} minutes:</p><p><a href="${link}">${link}</a></p><p>If it wasn't you, ignore this email — nothing changes until the link is used.</p>`,
      }).catch((err) => console.error("Password reset email failed:", err))
    );
  }

  return NextResponse.json({ ok: true, emailConfigured: true });
}


