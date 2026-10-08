'use client';

/**
 * Platform > Venues (P-05, z8uq9m0tnx) — every company on the platform, with
 * member/event counts, subscription status and last activity, so a PlusOne
 * platform admin can see who's out there and jump in to help.
 *
 * Security shape (CLAUDE.md #1 — RLS is the boundary):
 *  - Gated on `usePoIsPlatformAdmin()` for the UI only, exactly like the
 *    Platform tab itself (P-04) — a non-admin who types the URL gets the flat
 *    "not available" state and no read is ever fired. The real boundary is
 *    `platform_venue_overview()`/`_count()`: SECURITY DEFINER RPCs that
 *    re-check `is_platform_admin()` and return zero rows for anyone else.
 *  - Aggregated in SQL (member/event counts, last activity) — never all rows
 *    downloaded and counted in JS (CLAUDE.md Scale). Windowed (p_limit/
 *    p_offset), search runs server-side.
 *  - "Switch into this venue" calls the SAME `switchToVenue` the venue
 *    switcher (settings > venue) uses — no bespoke mechanism. The server
 *    action recognises a platform admin and allows the switch even for a
 *    venue they hold no membership at (see actions.ts); once switched in,
 *    role-gated buttons elsewhere still reflect that they hold no REAL
 *    membership there (roles: []), matching how external-crew access already
 *    renders — a known, documented limitation, not a new one.
 *
 * Billing (Billing G, decision #32(d) 2026-10-06): each card shows the
 * company's billing state and lets a platform admin set "Trial until <date>"
 * or "Always free". The state is a direct `subscriptions` read for the visible
 * page only (≤ PAGE_SIZE ids, RLS lets a platform admin read every row); the
 * writes are set_venue_trial_end / set_venue_comped — SECURITY DEFINER RPCs that
 * re-check is_platform_admin() and are audited by the subscriptions trigger
 * under the admin's own uid. A Stripe-linked company has no controls (its
 * clock is Stripe's; the RPCs refuse it too).
 *
 * Capacitor (#37): client-side React Query reads + online-only server actions;
 * nothing door-adjacent, no new browser-only API (the date picker is a plain
 * <input type="date">). No price or checkout here — this is a status/admin
 * surface, not a purchase one.
 */
import { type JSX, useMemo, useState } from 'react';
import { t, fmt } from '@/lib/i18n';
import {
  usePoIsPlatformAdmin,
  usePoPlatformBilling,
  usePoPlatformCompanies,
  usePoPlatformVenues,
  usePoPlatformVenuesCount,
} from '@/features/po/hooks';
import { usePoSetVenueComped, usePoSetVenueTrialEnd } from '@/features/po/mutations';
import type { PlatformBilling, PlatformCompany, PlatformVenue } from '@/features/po/adapters';
import { formatShortDate, toDateInput } from '@/features/po/format';
import { useNav, usePo } from '../context';
import { CompanyDetail } from './platform-company';
import { Btn, Empty, Field, FieldErrorText, Label, MiniChip, Note, PageNav, Scroll, StatTile, ToggleRow, Top } from '../kit';

const col = 'flex h-full flex-col';
const PAGE_SIZE = 20;

// subscription_status enum -> display label (review finding, z8uq9m0tnx):
// the DB value is app vocabulary, never copy. Falls back to the raw value
// for a status this map hasn't caught up with yet, rather than hiding it.
const SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  trialing: t.platform.subscriptionTrialing,
  active: t.platform.subscriptionActive,
  past_due: t.platform.subscriptionPastDue,
  canceled: t.platform.subscriptionCanceled,
  comped: t.platform.subscriptionComped,
};
function subscriptionStatusLabel(status: string): string {
  return SUBSCRIPTION_STATUS_LABEL[status] ?? status;
}

export function PlatformVenues(): JSX.Element {
  const nav = useNav();
  const isPlatformAdmin = usePoIsPlatformAdmin();

  if (!isPlatformAdmin) {
    return (
      <div className={col}>
        <Top big title={t.platform.venuesTitle} onBack={nav.canGoBack ? nav.back : undefined} />
        <Scroll bottom={90}>
          <Empty text={t.platform.notAvailable} />
        </Scroll>
      </div>
    );
  }
  return <VenuesConsole />;
}

function VenuesConsole(): JSX.Element {
  const nav = useNav();
  const { switchToVenue } = usePo();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const offset = page * PAGE_SIZE;
  const trimmed = search.trim() || undefined;

  const venuesQ = usePoPlatformVenues({ limit: PAGE_SIZE, offset, search: trimmed });
  const countQ = usePoPlatformVenuesCount(trimmed);
  const venues = useMemo(() => venuesQ.data ?? [], [venuesQ.data]);
  const total = countQ.data ?? 0;
  const venueIds = useMemo(() => venues.map((v) => v.venueId), [venues]);
  const billingQ = usePoPlatformBilling(venueIds);
  // Platform R (z8uq9m2ybj): the same per-company detail the Invites list
  // shows — one view-model, one adapter, one read per page.
  const companiesQ = usePoPlatformCompanies(venueIds);

  return (
    <div className={col}>
      <Top
        big
        title={t.platform.venuesTitle}
        sub={t.platform.venuesSubtitle}
        onBack={nav.canGoBack ? nav.back : undefined}
      />
      <Scroll bottom={100}>
        <Field
          icon="search"
          placeholder={t.platform.venuesSearchPlaceholder}
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(0);
          }}
          className="mb-4"
        />

        {venuesQ.isLoading ? (
          <Empty text={t.platform.venuesLoading} />
        ) : venuesQ.isError ? (
          <Empty text={t.platform.venuesLoadError} />
        ) : venues.length === 0 ? (
          <Empty text={t.platform.venuesEmpty} />
        ) : (
          <>
            <div className="flex flex-col gap-2">
              {venues.map((v) => (
                <VenueCard
                  key={v.venueId}
                  venue={v}
                  billing={billingQ.data?.get(v.venueId) ?? null}
                  company={companiesQ.data?.get(v.venueId) ?? null}
                  billingError={billingQ.isError}
                  onSwitch={() => switchToVenue(v.venueId)}
                  onViewAudit={() => nav.push('platformaudit', { id: v.venueId })}
                />
              ))}
            </div>

            {/* Only while there is a real page to show — never "0 of 0"
                under an empty/loading/error state (review finding, z8uq9m0tnx). */}
            <PageNav
              summary={fmt(t.platform.venuesCountOf, { shown: offset + venues.length, total })}
              hasPrev={page > 0}
              hasNext={offset + venues.length < total}
              onPrev={() => setPage((p) => Math.max(0, p - 1))}
              onNext={() => setPage((p) => p + 1)}
              prevLabel={t.platform.pagePrev}
              nextLabel={t.platform.pageNext}
            />
          </>
        )}
      </Scroll>
    </div>
  );
}

function VenueCard({
  venue,
  billing,
  company,
  billingError,
  onSwitch,
  onViewAudit,
}: {
  venue: PlatformVenue;
  billing: PlatformBilling | null;
  company: PlatformCompany | null;
  billingError: boolean;
  onSwitch: () => void;
  onViewAudit: () => void;
}): JSX.Element {
  const membersCopy =
    venue.memberCount === 1
      ? fmt(t.platform.venuesMembers, { count: venue.memberCount })
      : fmt(t.platform.venuesMembersPlural, { count: venue.memberCount });
  const eventsCopy =
    venue.eventCount === 1
      ? fmt(t.platform.venuesEvents, { count: venue.eventCount })
      : fmt(t.platform.venuesEventsPlural, { count: venue.eventCount });

  return (
    <div className="rounded-[16px] border border-line bg-elev p-[14px]">
      <div className="flex min-w-0 items-start justify-between gap-[10px]">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14.5px] font-semibold text-text">{venue.name}</div>
          <div className="mt-0.5 truncate text-[12px] text-faint">
            {venue.lastActivityAt
              ? fmt(t.platform.venuesLastActivity, { date: formatShortDate(venue.lastActivityAt) })
              : t.platform.venuesNoActivity}
          </div>
        </div>
        {billing || venue.subscriptionStatus ? (
          <MiniChip>{billingChipLabel(billing, venue.subscriptionStatus)}</MiniChip>
        ) : (
          <MiniChip className="border-line2 text-faint">{t.platform.venuesNoSubscription}</MiniChip>
        )}
      </div>

      {company && (
        <div className="mt-[9px]">
          {/* The billing chip above stays the status here: it pairs with the
              trial-date control below ("Trial until <date>"). */}
          <CompanyDetail company={company} showStatus={false} />
        </div>
      )}

      <div className="mt-[11px] grid grid-cols-2 gap-2">
        <StatTile label={membersCopy} value={venue.memberCount} />
        <StatTile label={eventsCopy} value={venue.eventCount} />
      </div>

      {billingError ? (
        <div className="mt-[11px] text-[12px] text-faint">{t.platform.billingLoadError}</div>
      ) : (
        billing && <BillingControls venueId={venue.venueId} billing={billing} />
      )}

      <div className="mt-[11px] flex flex-wrap gap-2">
        <Btn kind="ghost" sm icon="history" className="min-h-[44px]" onClick={onViewAudit}>
          {t.platform.venuesOpenAudit}
        </Btn>
        <Btn kind="primary" sm icon="swap" className="min-h-[44px]" onClick={onSwitch}>
          {t.platform.venuesSwitchInto}
        </Btn>
      </div>
    </div>
  );
}

/** The chip: "Trial until 21 Oct" / "Trial ended 3 Oct" / "Always free" /
 *  the plain status — the billing read wins over the overview's status. */
function billingChipLabel(billing: PlatformBilling | null, overviewStatus: string | null): string {
  if (billing?.status === 'trialing' && billing.trialEndsAt && !billing.stripeLinked) {
    const date = formatShortDate(billing.trialEndsAt);
    return new Date(billing.trialEndsAt).getTime() >= Date.now()
      ? fmt(t.platform.billingTrialUntil, { date })
      : fmt(t.platform.billingTrialEnded, { date });
  }
  return subscriptionStatusLabel(billing?.status ?? overviewStatus ?? '');
}

/** Default for the date field: the current trial end if it is still ahead,
 *  else 14 days from today (Amsterdam calendar day). */
function defaultTrialDay(billing: PlatformBilling): string {
  const now = Date.now();
  const end = billing.trialEndsAt ? new Date(billing.trialEndsAt).getTime() : 0;
  return toDateInput(new Date(end > now ? end : now + 14 * 86_400_000).toISOString());
}

function BillingControls({ venueId, billing }: { venueId: string; billing: PlatformBilling }): JSX.Element {
  const setTrial = usePoSetVenueTrialEnd();
  const setComped = usePoSetVenueComped();
  const [day, setDay] = useState(() => defaultTrialDay(billing));
  const busy = setTrial.isPending || setComped.isPending;
  const error = setTrial.error ?? setComped.error;

  if (billing.stripeLinked) {
    return (
      <div className="mt-[11px]">
        <Note icon="card">{t.platform.billingStripeManaged}</Note>
      </div>
    );
  }

  const comped = billing.status === 'comped';
  return (
    <div className="mt-[11px] rounded-[14px] border border-line2 px-[12px]">
      <ToggleRow
        title={t.platform.billingAlwaysFree}
        sub={t.platform.billingAlwaysFreeSub}
        on={comped}
        set={(v) => {
          if (busy) return;
          setTrial.reset();
          setComped.mutate({ venueId, comped: v });
        }}
        last
      />
      <div className="border-t border-line2 py-[12px]">
        <Label className="mb-2">{t.platform.billingTrialDateLabel}</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Field icon="cal" type="date" value={day} onChange={setDay} className="min-w-[170px] flex-1" />
          <Btn
            kind="ghost"
            sm
            icon="clock"
            className="min-h-[44px]"
            disabled={busy || !day}
            onClick={() => {
              setComped.reset();
              setTrial.mutate({ venueId, trialEndsOn: day });
            }}
          >
            {setTrial.isPending ? t.platform.billingWorking : t.platform.billingSetTrial}
          </Btn>
        </div>
        {error && <FieldErrorText className="mt-2">{error.message}</FieldErrorText>}
      </div>
    </div>
  );
}
