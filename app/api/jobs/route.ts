import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/jobs?number=1234 -> look up a job by its job number (for autocomplete/validation)
export async function GET(req: NextRequest) {
  const number = req.nextUrl.searchParams.get("number");
  if (!number) return NextResponse.json({ error: "number query param is required" }, { status: 400 });
  const job = await prisma.job.findUnique({ where: { jobNumber: number } });
  return NextResponse.json({ job });
}
