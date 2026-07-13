'use client';

/** Past-event recap + shared event-activity/audit section — split from events.tsx (FE-5). */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import { usePoEvent, usePoEventForEdit, usePoEventRecap, usePoEventActivity, usePoAuditFeed } from '@/features/po/hooks';
import type { TierStat, UserAddition } from '@/features/stats/data';
import type { AuditLine } from '@/features/audit/translate';
import { formatWhen } from '@/features/audit/translate';
import { venueCapabilities } from '@/features/venues/access';
import { auditActionMeta } from '@/features/po/audit-presenter';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { useNav } from '../../context';
import { Icon } from '../../icon';
import { Avatar, Btn, Empty, IconBtn, Label, Scroll, Top } from '../../kit';
import { TierPill } from '../guests/_shared';
import { col, ScreenState } from './shared';
import { SaveAsTemplate } from './edit';

// ── PAST EVENT recap (pushed) ────────────────────────────────────────────────────
const RECAP_CAP = 8;

export function PastEvent({ id }: { id?: string }): JSX.Element {
  const nav = useNav();
  const { event, isLoading: evLoading, isError: evError, notFound } = usePoEvent(id ?? '');
  const { data: r, isLoading: rLoading, isError: rError } = usePoEventRecap(id ?? '');
  // Past events stay editable (M11); "Save as template" reuses that same right.
  const { canManage } = usePoEventForEdit(id ?? '');
  const [showAllIn, setShowAllIn] = useState(false);
  const [showAllNo, setShowAllNo] = useState(false);

  if (evLoading || rLoading) return <ScreenState onBack={nav.back} title={t.events.recapTitle} text={t.events.loading} />;
  if (evError || rError || notFound || !event || !r) {
    return <ScreenState onBack={nav.back} title={t.events.recapTitle} text={t.events.recapUnavailable} />;
  }

  const ev = event;
  const pct = r.listed > 0 ? Math.round((r.arrived / r.listed) * 100) : 0;
  const maxT = Math.max(1, ...r.perTier.map((x) => x.aangemeld));
  const inList = showAllIn ? r.checkedIn : r.checkedIn.slice(0, RECAP_CAP);
  const noList = showAllNo ? r.noShows : r.noShows.slice(0, RECAP_CAP);

  return (
    <div className={col}>
      <Top onBack={nav.back} title={ev.name} sub={`${ev.venue} · ${ev.date} ${ev.mon}`} right={<IconBtn name="share" />} />
      <Scroll bottom={28}>
        {/* Desktop (S3.3): two columns — left = opkomst + ingecheckt, right =
            no-shows + per-tier + acties. Stacks to one column below lg. */}
        <div className="lg:grid lg:grid-cols-2 lg:gap-5 lg:items-start">
        <div>
        <div className="mb-[14px] rounded-[18px] bg-acc-dim p-[18px]">
          <Label className="mb-[10px] text-acc-soft">{t.events.recapHeading}</Label>
          <div className="flex items-end gap-[10px]">
            <div className="font-display text-[54px] font-extrabold leading-[0.9] text-text">{pct}%</div>
            <div className="pb-1.5">
              <div className="text-[14px] font-semibold text-text">{t.events.turnoutWord}</div>
              <div className="text-[12.5px] text-dim">
                {fmt(t.events.peopleOf, { arrived: r.arrived, listed: r.listed })}
              </div>
            </div>
          </div>
          <div className="mt-[14px] h-[8px] overflow-hidden rounded-[5px] bg-white/[0.12]">
            <div className="h-full rounded-[5px] bg-acc" style={{ width: pct + '%' }} />
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-[10px]">
          <div className="rounded-[18px] border border-line bg-elev px-4 py-[14px]">
            <div className="font-display text-[30px] font-extrabold leading-none text-acc">{r.arrived}</div>
            <div className="mt-1 text-[12.5px] text-dim">{t.events.checkedIn}</div>
          </div>
          <div className="rounded-[18px] border border-line bg-elev px-4 py-[14px]">
            <div className="font-display text-[30px] font-extrabold leading-none text-text">{r.noShow}</div>
            <div className="mt-1 text-[12.5px] text-faint">{t.events.noShows}</div>
          </div>
        </div>

        <Label className="mb-[10px]">{fmt(t.events.checkedInLabel, { n: r.checkedIn.length })}</Label>
        {r.checkedIn.length === 0 ? (
          <div className="mb-4">
            <Empty text={t.events.noOneCheckedIn} />
          </div>
        ) : (
          <div className="mb-4 rounded-[18px] border border-line bg-elev px-[14px] py-0.5">
            {inList.map((g, i) => (
              <div key={`${g.name}-${i}`} className={cn('flex items-center gap-[12px] py-[11px]', i < inList.length - 1 && 'border-b border-line2')}>
                <Avatar name={g.name} size={36} accent={g.role === 'VIP'} />
                <div className="min-w-0 flex-1">
                  <div className="font-display text-[14.5px] font-bold text-text">
                    {g.name}
                    {g.plus > 0 && <span className="font-semibold text-faint"> +{g.plus}</span>}
                  </div>
                  <div className="mt-1">
                    <TierPill name={g.tierName} color={g.tierColor} fallback={g.role} />
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 font-display text-[13px] font-bold text-acc">
                  <Icon name="check2" size={14} stroke="#B5A6FF" sw={2.4} />
                  {g.at ?? '—'}
                </span>
              </div>
            ))}
            {!showAllIn && r.checkedIn.length > RECAP_CAP && (
              <button
                type="button"
                onClick={() => setShowAllIn(true)}
                className="w-full border-t border-line2 py-3 font-body text-[13.5px] font-bold text-dim transition-[filter] hover:brightness-[1.2]"
              >
                {fmt(t.events.showAllCheckedIn, { n: r.checkedIn.length })}
              </button>
            )}
          </div>
        )}

        </div>
        <div className="mt-4 lg:mt-0">
        <Label className="mb-[10px]">{fmt(t.events.noShowsLabel, { n: r.noShows.length })}</Label>
        {r.noShows.length === 0 ? (
          <div className="mb-[18px]">
            <Empty text={t.events.everyoneShowed} />
          </div>
        ) : (
          <div className="mb-[18px] rounded-[18px] border border-line bg-elev px-[14px] py-0.5">
            {noList.map((g, i) => (
              <div key={`${g.name}-${i}`} className={cn('flex items-center gap-[12px] py-[11px] opacity-[0.72]', i < noList.length - 1 && 'border-b border-line2')}>
                <Avatar name={g.name} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="font-display text-[14.5px] font-bold text-dim">
                    {g.name}
                    {g.plus > 0 && <span className="font-semibold text-faint"> +{g.plus}</span>}
                  </div>
                  {g.by && <div className="mt-[3px] text-[12px] text-faint">{fmt(t.events.addedBy, { by: g.by })}</div>}
                </div>
                <span className="text-[12px] font-bold text-faint">{t.events.noShowTag}</span>
              </div>
            ))}
            {!showAllNo && r.noShows.length > RECAP_CAP && (
              <button
                type="button"
                onClick={() => setShowAllNo(true)}
                className="w-full border-t border-line2 py-3 font-body text-[13.5px] font-bold text-dim transition-[filter] hover:brightness-[1.2]"
              >
                {fmt(t.events.showAllNoShows, { n: r.noShows.length })}
              </button>
            )}
          </div>
        )}

        <Label className="mb-[10px]">{t.events.byTier}</Label>
        <div className="mb-[14px] rounded-[18px] border border-line bg-elev p-4">
          {r.perTier.length === 0 ? (
            <div className="py-[14px] text-center text-[13px] text-faint">{t.events.noTierData}</div>
          ) : (
            r.perTier.map((row, i) => (
              <div key={row.tier} className={i < r.perTier.length - 1 ? 'mb-[13px]' : ''}>
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
        <div className="mb-4 grid grid-cols-2 gap-[10px]">
          <div className="rounded-[18px] border border-line bg-elev px-4 py-[14px]">
            <div className="font-display text-[24px] font-extrabold text-text">{r.refused}</div>
            <div className="mt-[3px] text-[12px] text-faint">{t.events.refused}</div>
          </div>
          <div className="rounded-[18px] border border-line bg-elev px-4 py-[14px]">
            <div className="font-display text-[24px] font-extrabold text-text">{r.peak}</div>
            <div className="mt-[3px] text-[12px] text-faint">{t.events.peak}</div>
          </div>
        </div>
        <div className="flex gap-[10px]">
          <Btn kind="dark" full icon="users" onClick={() => nav.push('lijst', { id: ev.id })}>
            {t.events.recapGuestList}
          </Btn>
          <Btn kind="quiet" full icon="dl">
            {t.events.exportLabel}
          </Btn>
        </div>
        {id && canManage && <SaveAsTemplate eventId={id} />}
        </div>
        </div>
        {id && <EventActivitySection eventId={id} />}
      </Scroll>
    </div>
  );
}

// ── EVENT ACTIVITY SECTION (admin/finance only, 86ey21vnd) ───────────────────────

function TierActivityTable({ tiers }: { tiers: TierStat[] }): JSX.Element {
  if (tiers.length === 0) return <Empty text={t.events.activityNoTiers} />;
  return (
    <ul className="flex flex-col divide-y divide-line2">
      {tiers.map((tier) => (
        <li key={tier.tier_id} className="flex items-center gap-[10px] py-[9px]">
          <span
            className="mt-px h-[9px] w-[9px] shrink-0 rounded-full"
            style={{ backgroundColor: tier.color || '#B5A6FF' }}
          />
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-text">
            {tier.tier_name}
          </span>
          <span className="font-display text-[13px] font-bold text-text">
            {tier.registered_headcount}
          </span>
          <span className="text-[11.5px] text-faint">{t.events.activityPpl}</span>
          <span className="font-display text-[13px] font-bold text-acc">
            {tier.present_headcount}
          </span>
          <span className="text-[11.5px] text-faint">{t.events.activityIn}</span>
        </li>
      ))}
    </ul>
  );
}

function MemberActivityTable({ members }: { members: UserAddition[] }): JSX.Element {
  if (members.length === 0) return <Empty text={t.events.activityNoMembers} />;
  return (
    <ul className="flex flex-col divide-y divide-line2">
      {members.map((m) => (
        <li key={m.user_id} className="flex items-center gap-[10px] py-[9px]">
          <Avatar name={m.full_name} size={30} />
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-text">
            {m.full_name}
          </span>
          <span className="text-right">
            <span className="font-display text-[13px] font-bold text-text">{m.added}</span>
            <span className="ml-1 text-[11.5px] text-faint">
              {fmt(t.events.activityAddedPpl, { n: m.added_headcount })}
            </span>
          </span>
          {m.present > 0 && (
            <span className="font-display text-[12px] font-bold text-acc">
              {m.present} {t.events.activityInShort}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function EventAuditEntry({ line }: { line: AuditLine }): JSX.Element {
  const nav = useNav();
  const meta = auditActionMeta(line.action);
  const isDoor = /deur|door/i.test(line.device);
  return (
    <li>
      <button
        type="button"
        disabled={!line.guestId}
        onClick={() => line.guestId && nav.push('guest', { id: line.guestId })}
        className="flex w-full items-start gap-[10px] py-[9px] text-left"
      >
        <span className="mt-[1px] flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-full bg-elev2 text-dim">
          <Icon name={meta.icon} size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] leading-[1.4] text-dim">
            <span className="font-semibold text-text">{line.actor}</span>{' '}
            {line.text}
          </span>
          <span className="mt-0.5 flex items-center gap-x-[6px] text-[11.5px] text-faint">
            <span>{formatWhen(line.iso)}</span>
            <span className="text-ghost">·</span>
            <span className={cn('flex items-center gap-[4px]', isDoor && 'text-acc')}>
              <span className={cn('h-[5px] w-[5px] rounded-full', isDoor ? 'bg-acc' : 'bg-ghost')} />
              {line.device}
            </span>
          </span>
        </span>
      </button>
    </li>
  );
}

// Audit feed paging (86ey8w79x): first window stays small; "Show more" widens
// the server-side cap in steps — an event with hundreds of guests must never
// ship its whole log to render this section.
const FEED_PAGE = 50;

export function EventActivitySection({
  eventId,
  isLive,
}: {
  eventId: string;
  isLive?: boolean;
}): JSX.Element | null {
  const { roles } = usePoIdentity();
  const canAudit = venueCapabilities(roles).viewAudit;
  const interval = isLive ? 15_000 : undefined;
  const [feedLimit, setFeedLimit] = useState(FEED_PAGE);
  const { data: activity, isLoading: statsLoading } = usePoEventActivity(eventId, {
    enabled: canAudit,
    refetchInterval: canAudit ? interval : undefined,
  });
  const { data: feed, isLoading: feedLoading } = usePoAuditFeed(
    { eventId, limit: feedLimit },
    { enabled: canAudit, refetchInterval: canAudit ? interval : undefined }
  );

  if (!canAudit) return null;

  const tiers = activity?.tiers ?? [];
  const members = activity?.members ?? [];
  const lines = feed ?? [];
  // A full window means there may be more; a short read means we've seen it all.
  const maybeMore = lines.length >= feedLimit;

  return (
    <div className="mt-6 border-t border-line pt-5">
      <Label className="mb-4">{t.events.activityHeading}</Label>
      {/* Stats grid: tier table + member table side by side on desktop */}
      <div className="mb-5 lg:grid lg:grid-cols-2 lg:gap-5">
        <div className="mb-5 lg:mb-0">
          <Label className="mb-[10px] text-[11.5px]">{t.events.activityPerTier}</Label>
          {statsLoading ? (
            <div className="py-4 text-center text-[13px] text-faint">{t.events.loading}</div>
          ) : (
            <TierActivityTable tiers={tiers} />
          )}
        </div>
        <div>
          <Label className="mb-[10px] text-[11.5px]">{t.events.activityPerMember}</Label>
          {statsLoading ? (
            <div className="py-4 text-center text-[13px] text-faint">{t.events.loading}</div>
          ) : (
            <MemberActivityTable members={members} />
          )}
        </div>
      </div>
      {/* Audit feed */}
      <Label className="mb-[10px] text-[11.5px]">{t.events.activityLog}</Label>
      {feedLoading ? (
        <div className="py-4 text-center text-[13px] text-faint">{t.events.loading}</div>
      ) : lines.length === 0 ? (
        <Empty text={t.events.activityEmpty} />
      ) : (
        <>
          <ul className="divide-y divide-line2">
            {lines.map((line) => (
              <EventAuditEntry key={line.id} line={line} />
            ))}
          </ul>
          {maybeMore && (
            <Btn kind="ghost" full sm className="mt-3" onClick={() => setFeedLimit((n) => n + FEED_PAGE)}>
              {t.events.activityShowMore}
            </Btn>
          )}
        </>
      )}
    </div>
  );
}
