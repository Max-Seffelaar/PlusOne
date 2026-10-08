'use client';

/**
 * Deep link to an event of ANOTHER company the user belongs to (z8uq9m2vg7;
 * decision Max 2026-10-06, onboarding-orchestration §9): explain it and offer
 * "Switch to {company}" — never switch silently, because a company switch is a
 * deliberate act (a platform admin's switch even writes platform_access_log).
 *
 * How we know: the event detail already reads the event by id without a
 * company filter (usePoEventForEdit → fetchEventForEdit, RLS-scoped), and that
 * read returns the owning company's id. RLS only returns the row when the user
 * may read the event at all. The user's own memberships (usePo().myVenues) then
 * decide: the owning company must be one of them and not the active one.
 * Anything else — not a member (an organizer or a platform admin reading
 * through RLS), or the active company itself — falls back to the plain "not
 * available" state, so a non-member never learns the event exists. The switch
 * goes through the existing server action, which checks the membership again.
 */
import type { JSX } from 'react';
import { t, fmt } from '@/lib/i18n';
import type { PoVenueMembership } from '../../context';
import { Btn, GuideCard, Scroll, Top } from '../../kit';
import { col } from './shared';

/** The one other company of the user's that owns this event, or null. */
export function otherCompanyForEvent({
  eventVenueId,
  myVenues,
  activeVenueId,
}: {
  eventVenueId: string | null | undefined;
  myVenues: readonly PoVenueMembership[];
  activeVenueId: string | null;
}): PoVenueMembership | null {
  if (!eventVenueId || eventVenueId === activeVenueId) return null;
  return myVenues.find((v) => v.venueId === eventVenueId) ?? null;
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
