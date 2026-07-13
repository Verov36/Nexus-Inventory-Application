import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
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
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Not authorized" }, { status: 401 });
    }
  }

  const schedule = await prisma.reportSchedule.findFirst();
  if (!schedule) {
    return NextResponse.json({ skipped: true, reason: "No report schedule configured yet" });
  }

  const now = new Date();
  if (schedule.nextRunAt > now) {
    return NextResponse.json({ skipped: true, nextRunAt: schedule.nextRunAt });
  }

  const from = schedule.lastRunAt ?? new Date(now.getTime() - schedule.frequencyDays * 24 * 60 * 60 * 1000);
  const summary = await generateUsageSummary(from, now);

  const snapshot = await prisma.reportSnapshot.create({
    data: {
      rangeFrom: from,
      rangeTo: now,
      summaryJson: JSON.stringify(summary),
    },
  });

  const nextRunAt = new Date(now.getTime() + schedule.frequencyDays * 24 * 60 * 60 * 1000);
  await prisma.reportSchedule.update({
    where: { id: schedule.id },
    data: { lastRunAt: now, nextRunAt },
  });

  return NextResponse.json({ ran: true, snapshotId: snapshot.id, nextRunAt });
}
