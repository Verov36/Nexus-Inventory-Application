import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { revalidateSession } from "@/lib/session";
import { clientIp, rateLimitAll } from "@/lib/rate-limit";

// Surfaced to the login form as `code`, so it can say "wait" rather than
// "wrong password".
class RateLimited extends CredentialsSignin {
  code = "rate_limited";
}

// Idle timeout: a session unused for a full shift plus overtime ends. (The
// cookie is re-issued while it's in use; lib/session.ts also caps the total
// lifetime, so a lost phone or a leaked cookie can't stay signed in forever.)
const SESSION_MAX_AGE_SECONDS = Number(process.env.SESSION_MAX_AGE_HOURS || 12) * 60 * 60;

// Compared against when the email doesn't match an account, so a miss takes
// as long as a wrong password and response timing can't reveal who has an
// account. (Hash of a random string; nothing can match it.)
const DUMMY_HASH = "$2a$10$34qhaftCBSp.bLUjf7yC1u0yEkeHah/tNrr1iVkxVlXWvDtTOqyX6";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true, // required behind Railway's reverse proxy, or NextAuth throws a generic "server configuration" error
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials, request) => {
        const email = (credentials?.email as string | undefined)?.trim().toLowerCase();
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        // Per account (stops guessing one person's password) and per source
        // address (stops spraying one password across many accounts).
        const limit = await rateLimitAll([
          [`login:email:${email}`, 10, 15 * 60],
          [`login:ip:${clientIp(request.headers)}`, 50, 15 * 60],
        ]);
        if (!limit.ok) throw new RateLimited();

        const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
        const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
        if (!user || !valid || user.disabledAt) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          canReceiveParts: user.canReceiveParts,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role: string }).role;
        token.canReceiveParts = (user as { canReceiveParts: boolean }).canReceiveParts;
        token.sv = (user as { sessionVersion: number }).sessionVersion;
        token.authAt = Math.floor(Date.now() / 1000);
        token.name = user.name;
        return token;
      }

      // Every later request re-reads the account, so a role change, a
      // deactivation, or a password reset takes effect on the very next
      // request — not whenever the JWT happens to expire. A primary-key
      // lookup per request is cheap next to what the routes themselves do.
      // Returning null drops the claims; the next page load bounces to /login.
      if (process.env.NEXT_RUNTIME === "edge") return token;
      return revalidateSession(token);
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
