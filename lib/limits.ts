// Pure helper shared by the truck inventory page, the audit page, and the
// audit report: given a truck's caps, find the one that applies to a part.
// An exact part cap always wins; otherwise a category cap applies if the
// part has that category. Without this, category-level caps a manager set
// were silently ignored everywhere except the checkout limit check itself.

export type LimitLike = {
  part?: { id: string } | null;
  partId?: string | null;
  category?: string | null;
  maxQty: number;
};

export function findApplicableLimit<T extends LimitLike>(
  limits: T[],
  part: { id: string; category?: string | null }
): T | null {
  const partLimit = limits.find((l) => (l.part?.id ?? l.partId) === part.id);
  if (partLimit) return partLimit;
  const category = part.category?.trim();
  if (!category) return null;
  return (
    limits.find((l) => !(l.part?.id ?? l.partId) && l.category?.trim().toLowerCase() === category.toLowerCase()) ??
    null
  );
}
