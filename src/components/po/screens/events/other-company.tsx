'use client';

/**
 * Deep link to an event of ANOTHER company the user belongs to (z8uq9m2vg7;
 * decision Max 2026-10-06, onboarding-orchestration §9): explain it and offer
 * "Switch to {company}" — never switch silently, because a company switch is a
 * deliberate act (a platform admin's switch even writes platform_access_log).
 *
 * How we know, without a new query: the event detail already reads the event by
 * id without a company filter (usePoEventForEdit → fetchEventForEdit, RLS-scoped),
 * which returns the owning company's NAME. RLS only returns that row when the
 * user may read the event at all. The user's own memberships (usePo().myVenues)
 * then give the company id to switch to.
 *
 * Matching is by name, so it is deliberately strict: exactly one OTHER company
 * of the user's with that exact name. Zero matches (not a member: an organizer
 * or a platform admin reading through RLS) or two (two companies with the same
 * name) fall back to the plain "not available" state — it never guesses, and a
 * non-member never learns the event exists. The switch itself goes through the
 * existing server action, which checks the membership again.
 */
import type { JSX } from 'react';
import { t, fmt } from '@/lib/i18n';
import type { PoVenueMembership } from '../../context';
import { Btn, GuideCard, Scroll, Top } from '../../kit';
import { col } from './shared';

/** The one other company of the user's that owns this event, or null. */
export function otherCompanyForEvent({
  eventVenueName,
  myVenues,
  activeVenueId,
}: {
  eventVenueName: string | null | undefined;
  myVenues: readonly PoVenueMembership[];
  activeVenueId: string | null;
}): PoVenueMembership | null {
  if (!eventVenueName) return null;
  const matches = myVenues.filter((v) => v.venueId !== activeVenueId && v.venueName === eventVenueName);
  return matches.length === 1 ? matches[0]! : null;
}

export function OtherCompanyEvent({
  company,
  activeName,
  onBack,
  onSwitch,
}: {
  company: PoVenueMembership;
  activeName: string;
  onBack: () => void;
  onSwitch: () => void;
}): JSX.Element {
  const oc = t.events.otherCompany;
  return (
    <div className={col}>
      <Top onBack={onBack} title={t.events.detailTitle} />
      <Scroll bottom={28}>
        <div data-testid="event-other-company" className="md:mx-auto md:max-w-[560px]">
          <GuideCard
            icon="swap"
            title={fmt(oc.title, { company: company.venueName })}
            body={fmt(oc.body, { active: activeName })}
            actions={
              <Btn kind="primary" sm icon="swap" onClick={onSwitch}>
                {fmt(oc.cta, { company: company.venueName })}
              </Btn>
            }
          />
        </div>
      </Scroll>
    </div>
  );
}
