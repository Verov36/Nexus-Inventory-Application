import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true, // required behind Railway's reverse proxy, or NextAuth throws a generic "server configuration" error
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = (credentials?.email as string | undefined)?.trim().toLowerCase();
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
        if (!user) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          canReceiveParts: user.canReceiveParts,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.role = (user as { role: string }).role;
        token.canReceiveParts = (user as { canReceiveParts: boolean }).canReceiveParts;
        token.name = user.name;
      }

      // The role and receiving flag live in the JWT, so an admin's change in
      // /admin/users wouldn't show up for the affected person until they
      // signed out and back in — the nav would keep hiding (or showing)
      // Receiving, manager screens, etc. The AppShell calls `update()` on
      // load, which lands here with trigger === "update"; re-read the
      // database then. This path only runs in the Node runtime (the
      // /api/auth/session handler) — middleware runs on the edge runtime
      // where Prisma isn't available, and never sends an "update" trigger.
      if (trigger === "update" && token.sub && process.env.NEXT_RUNTIME !== "edge") {
        const fresh = await prisma.user.findUnique({
          where: { id: token.sub },
          select: { name: true, role: true, canReceiveParts: true },
        });
        if (!fresh) {
          // Account was deleted — drop the claims so the session stops
          // granting anything; the next page load bounces to /login.
          return null;
        }
        token.name = fresh.name;
        token.role = fresh.role;
        token.canReceiveParts = fresh.canReceiveParts;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub as string;
        session.user.name = (token.name as string | undefined) ?? session.user.name;
        (session.user as { role?: string }).role = token.role as string;
        (session.user as { canReceiveParts?: boolean }).canReceiveParts = token.canReceiveParts as boolean;
      }
      return session;
    },
  },
  pages: { signIn: "/login" },
});
