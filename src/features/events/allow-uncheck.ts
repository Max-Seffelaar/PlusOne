/**
 * Effective "uitchecken toestaan" for an event (S1.1). Pure mirror of the SQL
 * resolver public.event_allows_uncheck: the per-event override wins, else the
 * venue/company default, else true (today's behaviour — opt-out, #3). The UI uses
 * this to show toggle states + hide the uncheck affordance; the database (a
 * RESTRICTIVE check_ins policy) is the real boundary.
 */
export function resolveAllowUncheck(
  eventOverride: boolean | null | undefined,
  venueDefault: boolean | null | undefined,
): boolean {
  return eventOverride ?? venueDefault ?? true;
}
