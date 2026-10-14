/**
 * How many extra spots a guest that costs `cost` (1 + plus-ones) needs on top
 * of what is `remaining` in the caller's quota — null when it fits, or when
 * there is no limit (exempt / not loaded). Pure; the quick-add hint and the
 * number a quota request asks for both come from it.
 *
 * `remaining` must be fresh (usePoQuota refetches on mount/focus since
 * z8uq9m5kux): Max's 2026-10-14 test ran it on a cached "4 left" against a
 * real 7, so a +4 guest that fitted became a "+1" request. The database
 * re-derives the number for a named guest anyway (fit_quota_request_to_guest).
 */
export function quotaShortfall(cost: number, remaining: number | null): number | null {
  if (remaining === null) return null;
  return cost > remaining ? Math.max(1, cost - remaining) : null;
}
