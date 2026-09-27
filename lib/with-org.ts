import { auth } from "@/lib/auth";
import { runAsOrg } from "@/lib/tenant";

/**
 * Wraps a signed-in route handler so everything it does runs inside the
 * signed-in user's organization (see lib/tenant.ts). Every route under
 * app/api that uses a browser session is exported through this.
 *
 * No session means no organization context: the handler still runs (so it
 * can answer 401 itself), but any organization-owned query it made would
 * throw rather than see everyone's data.
 */
export function withOrg<A extends unknown[], R>(handler: (...args: A) => Promise<R>) {
  return async (...args: A): Promise<R> => {
    const session = await auth();
    const organizationId = (session?.user as { organizationId?: string } | undefined)?.organizationId;
    if (!organizationId) return handler(...args);
    return runAsOrg(organizationId, () => handler(...args));
  };
}
