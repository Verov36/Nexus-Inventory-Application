import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const path = req.nextUrl.pathname;
  const isLoginPage = path.startsWith("/login");
  const isAuthApi = path.startsWith("/api/auth");

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
