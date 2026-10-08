// "Free until end of ADE" (Onboarding A, z8uq9m2vg5; decision Max 2026-10-08).
// ADE 2026 runs 21-25 October; free means through Monday 26 October, so the
// trial ends at 2026-10-27 00:00 Europe/Amsterdam (CET, +01:00, after the
// 25 October clock change). The database owns the real date
// (create_venue_with_owner, migration 20261012140000, ADE_TRIAL_END); this
// copy only decides whether the Platform invite form still offers the
// toggle. After it, the option goes (expand-contract follow-up).

export const ADE_TRIAL_END = new Date('2026-10-27T00:00:00+01:00');

/** The last free day, as the toggle shows it ("26 Oct"). */
export const ADE_LAST_FREE_DAY_LABEL = '26 Oct';

/** Whether the Platform invite form still offers "Free until end of ADE". */
export function adeOfferOpen(now: Date = new Date()): boolean {
  return now.getTime() < ADE_TRIAL_END.getTime();
}
