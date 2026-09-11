import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const path = req.nextUrl.pathname;
  const isLoginPage = path.startsWith("/login");
  const isAuthApi = path.startsWith("/api/auth");
  const isCronApi = path.startsWith("/api/cron");
  const isApi = path.startsWith("/api/");

  // The cron endpoint is called by an external scheduler (Railway Cron),
  // which has no browser session — it authenticates itself via CRON_SECRET
  // inside the route instead. Without this exclusion, every cron trigger
  // would get redirected to /login before ever reaching the handler.
  if (isCronApi) return;

  if (!isLoggedIn && !isLoginPage && !isAuthApi) {
    // A fetch() from a page whose session expired should get a 401 it can
    // act on, not a 200 HTML login page that blows up in `res.json()`.
    if (isApi) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    if (path !== "/") loginUrl.searchParams.set("callbackUrl", path);
    return NextResponse.redirect(loginUrl);
  }

  // Already signed in — no reason to show the login form again.
  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  const role = (req.auth?.user as { role?: string } | undefined)?.role;

  if (isLoggedIn && path.startsWith("/admin/import") && role !== "SUPER_ADMIN") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  if (isLoggedIn && path.startsWith("/admin") && role !== "ADMIN" && role !== "SUPER_ADMIN") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  if (isLoggedIn && path.startsWith("/manager")) {
    const managerOk = role === "SUPER_ADMIN" || role === "ADMIN" || role === "MANAGER";
    const reportsOk = managerOk || role === "WAREHOUSE_MANAGER";
    const isReportsPage = path.startsWith("/manager/reports") || path.startsWith("/manager/audit");
    if (!(isReportsPage ? reportsOk : managerOk)) {
      return NextResponse.redirect(new URL("/", req.url));
    }
  }
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|browserprint|manifest.json|sw.js|icons).*)"],
};
