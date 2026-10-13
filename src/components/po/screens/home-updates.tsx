'use client';

/**
 * Home · Updates card (z8uq9m2xyp) — the decision on the signed-in user's own
 * quota request, until they dismiss it. Three shapes:
 *   raised    — "Your quota for {event} went up by +{n}"   → Add guests
 *   fulfilled — "{guest} is on the list for {event}"       → View list
 *   declined  — "Your request for {event} was declined" + the reason
 * An approval that was adjusted first (z8uq9m5kux) says so under the headline:
 * "Approved with changes: +1 spots instead of +2, on Backstage." The numbers
 * in the headline are what was granted, never what was asked.
 * "Got it" and the action both set seen_at (the requester's own column, RLS
 * quota_requests_seen_own); the card disappears with the next read. Reads its
 * own small query (usePoMyQuotaUpdates), so it adds nothing to Home's board
 * queries; renders nothing when there is nothing to say. Online-only write via
 * a server action (not door-adjacent).
 */
import { type JSX, useState } from 'react';
import { fmt, t } from '@/lib/i18n';
import { usePoMyQuotaUpdates } from '@/features/po/hooks';
import { usePoMarkQuotaSeen } from '@/features/po/mutations';
import type { PoQuotaUpdate, PoQuotaUpdateChanges } from '@/features/po/adapters';
import { useNav } from '../context';
import { Icon } from '../icon';
import { Btn } from '../kit';

function headline(u: PoQuotaUpdate): string {
  if (u.kind === 'declined') return fmt(t.home.updateDeclined, { event: u.eventName });
  if (u.kind === 'fulfilled' && u.guestLabel) {
    return fmt(t.home.updateRaisedGuest, { guest: u.guestLabel, event: u.eventName });
  }
  return fmt(t.home.updateRaised, { event: u.eventName, n: u.extra });
}

/** "Approved with changes: …" — only the parts that differ from the request. */
function changesLine(c: PoQuotaUpdateChanges): string {
  const parts: string[] = [];
  if (c.extra) {
    parts.push(fmt(c.extra.granted === 1 ? t.home.updateChangeExtraOne : t.home.updateChangeExtra, { n: c.extra.granted, asked: c.extra.asked }));
  }
  if (c.plusOnes) parts.push(fmt(t.home.updateChangePlusOnes, { n: c.plusOnes.granted, asked: c.plusOnes.asked }));
  if (c.tier) parts.push(c.tier.name ? fmt(t.home.updateChangeTier, { tier: c.tier.name }) : t.home.updateChangeTierUnnamed);
  return fmt(t.home.updateChanged, { changes: parts.join(', ') });
}

function UpdateRow({ u, busy, onSeen, onAction }: {
  u: PoQuotaUpdate;
  busy: boolean;
  onSeen: () => void;
  onAction: () => void;
}): JSX.Element {
  const declined = u.kind === 'declined';
  const sub = declined
    ? u.reason && fmt(t.home.updateDeclinedReason, { reason: u.reason })
    : u.kind === 'fulfilled' && u.guestLabel
      ? fmt(t.home.updateRaisedGuestSub, { n: u.extra })
      : null;
  return (
    <div className="flex flex-col gap-3 py-[13px] md:flex-row md:items-center" data-testid="quota-update" data-kind={u.kind}>
      <div className="flex min-w-0 flex-1 items-start gap-[11px]">
        <Icon
          name={declined ? 'close' : 'check2'}
          size={18}
          className={declined ? 'mt-[2px] shrink-0 text-faint' : 'mt-[2px] shrink-0 text-acc'}
        />
        <div className="min-w-0 flex-1">
          <div className="font-display text-[15px] font-bold leading-[1.3] text-text">{headline(u)}</div>
          {sub && <div className="mt-0.5 break-words text-[13px] leading-[1.45] text-dim">{sub}</div>}
          {u.changes && (
            <div className="mt-0.5 break-words text-[13px] leading-[1.45] text-acc" data-testid="quota-update-changes">
              {changesLine(u.changes)}
            </div>
          )}
          <div className="mt-0.5 text-[12px] text-faint">{u.at}</div>
        </div>
      </div>
      <div className="flex gap-2 md:flex-none">
        <Btn sm kind="ghost" className="min-h-[44px] flex-1 md:flex-none" disabled={busy} onClick={onSeen}>
          {t.home.updateGotIt}
        </Btn>
        {!declined && (
          <Btn sm kind="primary" icon={u.kind === 'fulfilled' ? 'users' : 'plus'} className="min-h-[44px] flex-1 md:flex-none" disabled={busy} onClick={onAction}>
            {u.kind === 'fulfilled' ? t.home.updateViewList : t.home.updateAddGuests}
          </Btn>
        )}
      </div>
    </div>
  );
}

export function QuotaUpdatesCard(): JSX.Element | null {
  const nav = useNav();
  const updates = usePoMyQuotaUpdates();
  const markSeen = usePoMarkQuotaSeen();
  const [err, setErr] = useState<string | null>(null);
  const list = updates.data ?? [];
  if (list.length === 0) return null;

  const dismiss = async (u: PoQuotaUpdate, then?: () => void): Promise<void> => {
    setErr(null);
    try {
      await markSeen.mutateAsync({ requestId: u.id });
      then?.();
    } catch {
      setErr(t.home.updateFailed);
    }
  };

  return (
    <section className="rounded-[18px] border border-acc/40 bg-elev px-[15px] pt-[13px]" data-testid="quota-updates" aria-label={t.home.updatesTitle}>
      <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-acc">{t.home.updatesTitle}</div>
      <div className="divide-y divide-line2">
        {list.map((u) => (
          <UpdateRow
            key={u.id}
            u={u}
            busy={markSeen.isPending}
            onSeen={() => void dismiss(u)}
            onAction={() =>
              void dismiss(u, () => nav.push(u.kind === 'fulfilled' ? 'event' : 'quickadd', { id: u.eventId }))
            }
          />
        ))}
      </div>
      {err && (
        <p className="pb-[12px] text-[12.5px] text-acc" role="alert">
          {err}
        </p>
      )}
    </section>
  );
}
