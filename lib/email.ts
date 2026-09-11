// Outbound email through Resend's HTTP API (https://resend.com) — no SDK,
// just fetch, so there's nothing extra to install. Configure with:
//   RESEND_API_KEY   — from the Resend dashboard
//   EMAIL_FROM       — a sender on a domain verified in Resend,
//                      e.g. "Nexus Inventory <inventory@yourdomain.com>"
// When either is missing, isEmailConfigured() is false and features that
// need email (password reset links) explain that instead of failing.

export function isEmailConfigured() {
  return !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;
}

export async function sendEmail(opts: { to: string; subject: string; text: string; html?: string }) {
  if (!isEmailConfigured()) throw new Error("Email isn't configured (RESEND_API_KEY / EMAIL_FROM).");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [opts.to],
      subject: opts.subject,
      text: opts.text,
      ...(opts.html ? { html: opts.html } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Email send failed (${res.status}): ${body.slice(0, 200)}`);
  }
}

/** Public base URL of this deployment, for links inside emails. */
export function appBaseUrl(req?: { headers: Headers; nextUrl?: { origin?: string } }) {
  const configured = process.env.APP_URL ?? process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  if (req) {
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (host) return `${proto}://${host}`;
  }
  return "http://localhost:3000";
}
