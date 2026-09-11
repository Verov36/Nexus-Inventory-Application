import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

// GET /api/jobs?number=1234   -> exact lookup by job number (validation)
// GET /api/jobs?q=12          -> up to 10 open jobs whose number contains q,
//                                newest first (the job picker on checkout)
// GET /api/jobs               -> the 10 most recent open jobs
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const number = req.nextUrl.searchParams.get("number")?.trim();
  if (number) {
    const job = await prisma.job.findUnique({ where: { jobNumber: number } });
    return NextResponse.json({ job });
  }

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const jobs = await prisma.job.findMany({
    where: {
      status: "open",
      ...(q ? { jobNumber: { contains: q, mode: "insensitive" } } : {}),
    },
    select: { id: true, jobNumber: true, customer: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  return NextResponse.json({ jobs });
}
