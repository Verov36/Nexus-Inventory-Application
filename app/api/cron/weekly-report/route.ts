import { createHash, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runAsOrg, runUnscoped } from "@/lib/tenant";
import { generateUsageSummary } from "@/lib/reports";

/**
 * Called on a schedule by an external cron trigger (Railway's built-in Cron
 * Jobs, or any hourly/daily scheduler hitting this URL). Checks whether the
 * configured report cadence (ReportSchedule.frequencyDays, adjustable by
 * managers in /manager/reports) is due, and if so generates a snapshot
 * covering the period since the last run.
 *
 * Protect this route by setting CRON_SECRET in the environment and having
 * the scheduler send it as `Authorization: Bearer <CRON_SECRET>` — otherwise
 * this is a public URL that anyone could trigger.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Fail closed, not open — an unset secret should never mean "anyone can
    // trigger this," it should mean "this feature isn't configured yet."
    console.error("CRON_SECRET is not set — refusing to run the scheduled report.");
    return NextResponse.json(
      { error: "CRON_SECRET is not configured on this deployment." },
      { status: 500 }
    );
  }
  const authHeader = req.headers.get("authorization") ?? "";
  const given = createHash("sha256").update(authHeader).digest();
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  if (!timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  // Every organization whose report is due, each run inside its own
  // organization so it only ever sees its own transactions.
  const now = new Date();
  const due = await runUnscoped("find due report schedules", () =>
    prisma.reportSchedule.findMany({ where: { nextRunAt: { lte: now } } })
  );

  const ran: { organizationId: string; snapshotId: string }[] = [];
  for (const schedule of due) {
    const result = await runAsOrg(schedule.organizationId, async () => {
      const nextRunAt = new Date(now.getTime() + schedule.frequencyDays * 24 * 60 * 60 * 1000);
      // Claim this run first (conditional on it still being due) so a cron
      // retry or two overlapping invocations produce one snapshot, not two.
      const claimed = await prisma.reportSchedule.updateMany({
        where: { id: schedule.id, nextRunAt: { lte: now } },
        data: { lastRunAt: now, nextRunAt },
      });
      if (claimed.count === 0) return null;
      const from = schedule.lastRunAt ?? new Date(now.getTime() - schedule.frequencyDays * 24 * 60 * 60 * 1000);
      const summary = await generateUsageSummary(from, now);
      return prisma.reportSnapshot.create({
        data: { rangeFrom: from, rangeTo: now, summaryJson: JSON.stringify(summary) },
      });
    });
    if (result) ran.push({ organizationId: schedule.organizationId, snapshotId: result.id });
  }

  return NextResponse.json({ ran: ran.length, snapshots: ran });
}
