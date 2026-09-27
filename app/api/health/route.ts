import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/health — for the load balancer / uptime monitor. Public, reveals
// nothing but whether the app can reach its database.
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, db: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, db: "unreachable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
