'use client';

/**
 * Platform R (z8uq9m2ybj) — the ONE company block both Platform lists render:
 * Invites (a chip per company the invitee belongs to) and Companies (inside
 * each card). Same view-model (`PlatformCompany`, one adapter), same markup,
 * so the two lists can never disagree about a company.
 *
 * Shows names and aggregates only: status, events (count + latest), owner's
 * last login, last check-in. "Switch" and the events line both go through the
 * shell's `switchToVenue`, the same path the venue switcher uses, which writes
 * a `platform_access_log` row for a company the admin is not a member of
 * (switchActiveVenueAction). Nothing here bypasses that.
 *
 * Capacitor (#37): plain buttons, no browser-only API, no price.
 */
import type { JSX } from 'react';
import { t, fmt } from '@/lib/i18n';
import { platformCompanyStatus, type PlatformCompany } from '@/features/po/adapters';
import { formatShortDate } from '@/features/po/format';
import { Btn, MiniChip } from '../kit';

const DAY_MS = 86_400_000;

/** "today" / "yesterday" / "3 days ago" — calendar-free, from elapsed time. */
export function agoCopy(iso: string, now: number = Date.now()): string {
  const days = Math.floor((now - new Date(iso).getTime()) / DAY_MS);
  if (days <= 0) return t.platform.companyToday;
  if (days === 1) return t.platform.companyYesterday;
  return fmt(t.platform.companyDaysAgo, { count: days });
}

export function companyStatusLabel(company: PlatformCompany, now: number = Date.now()): string {
  const s = platformCompanyStatus(company, now);
  switch (s.kind) {
    case 'trial':
      if (s.daysLeft <= 0) return t.platform.companyTrialEndsToday;
      return s.daysLeft === 1
        ? t.platform.companyTrialDayLeft
        : fmt(t.platform.companyTrialDaysLeft, { count: s.daysLeft });
    case 'trial_stripe':
      return t.platform.companyTrialStripe;
    case 'trial_ended':
      return t.platform.companyTrialEnded;
    case 'paid_monthly':
      return t.platform.companyPaidMonthly;
    case 'paid_yearly':
      return t.platform.companyPaidYearly;
    case 'paid':
      return t.platform.companyPaid;
    case 'comped':
      return t.platform.subscriptionComped;
    case 'past_due':
      return t.platform.subscriptionPastDue;
    case 'canceled':
      return t.platform.subscriptionCanceled;
    case 'none':
      return t.platform.venuesNoSubscription;
  }
}

export function companyEventsLine(company: PlatformCompany): string {
  if (company.eventCount === 0 || !company.lastEvent) return t.platform.companyNoEvents;
  const events =
    company.eventCount === 1
      ? fmt(t.platform.companyEvent, { count: company.eventCount })
      : fmt(t.platform.companyEvents, { count: company.eventCount });
  const latest = fmt(t.platform.companyLatestEvent, {
    name: company.lastEvent.name,
    date: formatShortDate(company.lastEvent.startsAt),
  });
  return `${events} · ${latest}`;
}

export function companyActivityLine(company: PlatformCompany, now: number = Date.now()): string {
  const login = company.ownerLastSignInAt
    ? fmt(t.platform.companyLastLogin, { ago: agoCopy(company.ownerLastSignInAt, now) })
    : t.platform.companyNoLogin;
  const checkIn = company.lastCheckInAt
    ? fmt(t.platform.companyLastCheckIn, { date: formatShortDate(company.lastCheckInAt) })
    : t.platform.companyNoCheckIn;
  return `${login} · ${checkIn}`;
}

/** Status chip + events line + activity line. `onOpenEvents` makes the events
 *  line a button (Invites); the Companies card already has its own actions. */
export function CompanyDetail({
  company,
  onOpenEvents,
  showStatus = true,
}: {
  company: PlatformCompany;
  onOpenEvents?: () => void;
  /** Off where the card already shows a status chip (Companies). */
  showStatus?: boolean;
}): JSX.Element {
  const events = companyEventsLine(company);
  return (
    <div className="min-w-0">
      {showStatus && <MiniChip className="mb-[6px]">{companyStatusLabel(company)}</MiniChip>}
      {onOpenEvents ? (
        <button
          type="button"
          onClick={onOpenEvents}
          aria-label={fmt(t.platform.companyEventsAria, { name: company.name })}
          className="block min-h-[44px] w-full break-words text-left text-[12.5px] font-semibold text-dim underline-offset-2 hover:underline lg:[@media(pointer:fine)]:min-h-0"
        >
          {events}
        </button>
      ) : (
        <div className="break-words text-[12.5px] text-dim">{events}</div>
      )}
      <div className="mt-0.5 break-words text-[12px] text-faint">{companyActivityLine(company)}</div>
    </div>
  );
}

/** One company under an invite: name, detail, Switch. No `onSwitch` = the
 *  company is already the active one, so there is nothing to switch to. */
export function CompanyChip({
  company,
  onSwitch,
  onOpenEvents,
}: {
  company: PlatformCompany;
  onSwitch?: () => void;
  onOpenEvents: () => void;
}): JSX.Element {
  return (
    <div className="rounded-[13px] border border-line2 bg-elev2 px-[11px] py-[9px]">
      <div className="flex min-w-0 items-start justify-between gap-[10px]">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold text-text">{company.name}</div>
          <div className="mt-[6px]">
            <CompanyDetail company={company} onOpenEvents={onOpenEvents} />
          </div>
        </div>
        {onSwitch && (
          <Btn
            kind="ghost"
            sm
            icon="swap"
            className="min-h-[44px] shrink-0"
            ariaLabel={fmt(t.platform.companySwitchAria, { name: company.name })}
            onClick={onSwitch}
          >
            {t.platform.companySwitch}
          </Btn>
        )}
      </div>
    </div>
  );
}
