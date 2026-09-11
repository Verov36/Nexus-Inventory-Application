import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Pages and endpoints reachable without a session.
const PUBLIC_PAGES = ["/login", "/setup", "/forgot-password", "/reset-password"];
const PUBLIC_API_PREFIXES = ["/api/auth", "/api/setup", "/api/cron"];

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const path = req.nextUrl.pathname;
  const isApi = path.startsWith("/api/");
  const isPublicPage = PUBLIC_PAGES.some((p) => path === p || path.startsWith(`${p}/`));
  const isPublicApi = PUBLIC_API_PREFIXES.some((p) => path.startsWith(p));

  // /api/cron authenticates itself with CRON_SECRET (no browser session);
  // /api/setup is inert once the first user exists; /api/auth is NextAuth
  // plus the forgot/reset endpoints.
  if (isPublicApi) return;

  if (!isLoggedIn && !isPublicPage) {
    // A fetch() from a page whose session expired should get a 401 it can
    // act on, not a 200 HTML login page that blows up in `res.json()`.
    if (isApi) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    if (path !== "/") loginUrl.searchParams.set("callbackUrl", path);
    return NextResponse.redirect(loginUrl);
  }

  // Already signed in — no reason to show the login/setup/reset forms.
  if (isLoggedIn && (path === "/login" || path === "/setup" || path === "/forgot-password")) {
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
