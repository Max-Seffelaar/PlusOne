'use client';

/** Shared per-event-stats view (M6, 86ey7dzmp) — KPIs, arrivals, by-tier and
 *  by-member breakdown. Rendered on the event-home (EventView/PastEvent's
 *  Activity section) AND on the Analytics event-first screen: ONE component, ONE
 *  fetch (`usePoEventActivity`), so the two surfaces can never show different
 *  numbers for the same event (K-10-les, ux-ia-audit-claude-code.md §2-E). */
import { cn } from '@/lib/utils';
import { fmt, t } from '@/lib/i18n';
import { usePoEventActivity } from '@/features/po/hooks';
import { Avatar, Empty, Label, press } from '../../kit';

export function EventStatsPanel({ eventId, isLive }: { eventId: string; isLive?: boolean }): JSX.Element {
  const { data, isLoading, isError, refetch } = usePoEventActivity(eventId, {
    refetchInterval: isLive ? 15_000 : undefined,
  });

  if (isLoading) {
    return <div className="py-[18px] text-center text-[13px] text-faint">{t.analytics.loading}</div>;
  }
  if (isError || !data) {
    return (
      <div className="rounded-[18px] border border-line bg-elev px-4 py-[22px] text-center">
        <Empty text={t.analytics.fetchError} />
        <button
          type="button"
          onClick={() => void refetch()}
          className={cn(
            'mt-1 inline-flex items-center justify-center rounded-[12px] bg-acc px-[18px] py-[10px] font-display text-[13.5px] font-bold text-ink',
            press
          )}
        >
          {t.analytics.retry}
        </button>
      </div>
    );
  }

  const { ek, perKwartier, perTier, perUser } = data;
  // Only surface the free/paid split when the event actually uses a paid tier —
  // for an all-free venue "0 paid" on every row is noise. Paid = display-only (#T3).
  const anyPaid = perUser.some((u) => u.addedPaid > 0);
  const maxK = Math.max(1, ...perKwartier.map((x) => x.n));
  const maxT = Math.max(1, ...perTier.map((x) => x.aangemeld));

  return (
    // Desktop: two balanced columns (KPIs + arrivals · tier + per-member).
    // Mobile: the two column wrappers are plain blocks, so the original
    // single-column order (KPIs → arrivals → tier → per-member) is preserved.
    <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-4">
      <div>
        <div className="mb-4 grid grid-cols-2 gap-[10px]">
          <div className="rounded-[18px] border border-line bg-elev px-4 py-[14px]">
            <div className="font-display text-[24px] font-extrabold text-text">{ek.peak ?? '—'}</div>
            <div className="mt-[3px] text-[12px] text-faint">
              {ek.peakCount > 0 ? fmt(t.analytics.peakWithCount, { n: ek.peakCount }) : t.analytics.peakLabel}
            </div>
          </div>
          <div className="rounded-[18px] border border-line bg-elev px-4 py-[14px]">
            <div className="font-display text-[24px] font-extrabold text-text">{ek.noShows}</div>
            <div className="mt-[3px] text-[12px] text-faint">{fmt(t.analytics.noShowLabel, { pct: ek.noShowPct })}</div>
          </div>
        </div>

        <Label className="mb-[10px]">{t.analytics.arrivalsLabel}</Label>
        <div className="mb-4 rounded-[18px] border border-line bg-elev p-4">
          {perKwartier.length === 0 ? (
            <div className="py-[18px] text-center text-[13px] text-faint">{t.analytics.noCheckins}</div>
          ) : (
            <div className="flex h-[120px] items-end gap-[5px]">
              {perKwartier.map((b) => (
                <div key={b.t} className="flex flex-1 flex-col items-center gap-1.5">
                  <div className="font-display text-[10px] font-bold text-dim">{b.n}</div>
                  <div
                    className={cn('w-full rounded-[5px] border', b.n === maxK ? 'border-transparent bg-acc' : 'border-line bg-elev2')}
                    style={{ height: (b.n / maxK) * 80 }}
                  />
                  <div className="font-display text-[9px] text-faint">{b.t}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div>
        <Label className="mb-[10px]">{t.analytics.tierLabel}</Label>
        <div className="mb-4 rounded-[18px] border border-line bg-elev p-4">
          {perTier.length === 0 ? (
            <div className="py-[14px] text-center text-[13px] text-faint">{t.analytics.noTierData}</div>
          ) : (
            perTier.map((row, i) => (
              <div key={row.tier} className={i < perTier.length - 1 ? 'mb-[13px]' : ''}>
                <div className="mb-1.5 flex justify-between">
                  <span className="text-[13px] font-semibold text-text">{row.tier}</span>
                  <span className="font-display text-[12px] text-faint">
                    <b className="text-acc">{row.binnen}</b>/{row.aangemeld}
                  </span>
                </div>
                <div className="relative h-[8px] overflow-hidden rounded-[5px] bg-elev2">
                  <div className="absolute inset-0 bg-white/[0.08]" style={{ width: (row.aangemeld / maxT) * 100 + '%' }} />
                  <div className="absolute inset-0 rounded-[5px] bg-acc" style={{ width: (row.binnen / maxT) * 100 + '%' }} />
                </div>
              </div>
            ))
          )}
        </div>

        <Label className="mb-[3px]">{t.analytics.addedByLabel}</Label>
        <div className="mb-[10px] text-[11.5px] text-faint">{t.analytics.addedByUnit}</div>
        <div className="mb-[14px] rounded-[18px] border border-line bg-elev px-[14px] py-0.5">
          {perUser.length === 0 ? (
            <div className="py-[14px] text-center text-[13px] text-faint">{t.analytics.noOneAdded}</div>
          ) : (
            perUser.map((u, i) => (
              <div
                key={`${u.who}-${i}`}
                className={cn('flex items-center gap-[12px] py-[11px]', i < perUser.length - 1 && 'border-b border-line2')}
              >
                <Avatar name={u.who} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="font-display text-[14.5px] font-bold text-text">{u.who}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-faint">
                    <span>{fmt(t.analytics.memberCheckedIn, { in: u.in })}</span>
                    {u.removed > 0 && (
                      <>
                        <span className="text-ghost">·</span>
                        <span>{fmt(t.analytics.memberRemoved, { n: u.removed })}</span>
                      </>
                    )}
                    {anyPaid && (
                      <>
                        <span className="text-ghost">·</span>
                        <span>{fmt(t.analytics.memberFreePaid, { free: u.addedFree, paid: u.addedPaid })}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-display text-[18px] font-extrabold leading-none text-text">{u.added}</div>
                  <div className="mt-[3px] text-[10px] font-bold uppercase tracking-[0.03em] text-faint">{t.analytics.addedWord}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
