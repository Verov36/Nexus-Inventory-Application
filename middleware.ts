import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const path = req.nextUrl.pathname;
  const isLoginPage = path.startsWith("/login");
  const isAuthApi = path.startsWith("/api/auth");
  const isCronApi = path.startsWith("/api/cron");

  // The cron endpoint is called by an external scheduler (Railway Cron),
  // which has no browser session — it authenticates itself via CRON_SECRET
  // inside the route instead. Without this exclusion, every cron trigger
  // would get redirected to /login before ever reaching the handler.
  if (isCronApi) return;

  if (!isLoggedIn && !isLoginPage && !isAuthApi) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  if (isLoggedIn && path.startsWith("/admin")) {
    const role = (req.auth?.user as { role?: string } | undefined)?.role;
    if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
      return NextResponse.redirect(new URL("/", req.url));
    }
  }

  if (isLoggedIn && path.startsWith("/admin/import")) {
    const role = (req.auth?.user as { role?: string } | undefined)?.role;
    if (role !== "SUPER_ADMIN") {
      return NextResponse.redirect(new URL("/", req.url));
    }
  }
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|browserprint|manifest.json|sw.js|icons).*)"],
};
