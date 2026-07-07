'use client';

/**
 * S14 · Dashboard-home (mission control) — the multi-event operations board.
 *
 * Replaces the S11 single-featured-event home. Built for a venue running many
 * events at once: a venue-wide pulse strip, two per-event bar graphs (requested
 * vs on-the-list), and a searchable, PAGINATED list of event cards — each with
 * its live counts (on list · open requests · quota requests · inside/turnout when
 * live) and quick actions (Open · Door · Requests · Edit · Lock list).
 *
 * Scalable data (the "50 events / 1000+ guests" concern): THREE queries total,
 * regardless of event count — usePoHomeEvents (all non-closed events + role-scoped
 * on-list/inside headcounts) + usePoGuestRequests + usePoQuotaRequests (venue-wide,
 * grouped by event here). Search/filter/pagination are client-side over that set.
 * The shell (sidebar / bottom-tabs) is the ResponsiveShell; this screen renders
 * only the content column. English copy via the i18n catalogus; lg: = 1024px.
 */
import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { usePoHomeEvents, usePoGuestRequests, usePoQuotaRequests, usePoProfile, useBillingBlocked } from '@/features/po/hooks';
import type { HomeEvent } from '@/features/po/adapters';
import { eventPhase } from '@/features/po/event-phase';
import { canWorkDoor } from '@/features/auth/roles';
import { useNav } from '../context';
import { Icon, type IconName } from '../icon';
import { Btn, Note, Scroll } from '../kit';
import { Sheet, Toast } from '../shell';
import { PendingInvitesBanner } from '../pending-invites-banner';

const TZ = 'Europe/Amsterdam';
const press = 'transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]';
const PAGE_SIZE = 7;

const fmtTime = (iso: string): string =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(
    new Date(iso)
  );
const fmtDate = (iso: string): string =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(
    new Date(iso)
  );
const dayKey = (iso: string | number): string =>
  new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
const kfmt = (n: number): string => (n >= 1000 ? (n / 1000).toFixed(1).replace('.0', '') + 'k' : String(n));

/** Current hour in the product TZ (#26) — stable across SSR/CSR. */
function amsterdamHour(): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(new Date())
  );
}
function greetingFor(hour: number, name: string): string {
  if (hour < 6) return name ? fmt(t.home.greetLate, { name }) : t.home.greetLateNoName;
  if (hour < 12) return name ? fmt(t.home.greetMorning, { name }) : t.home.greetMorningNoName;
  if (hour < 18) return name ? fmt(t.home.greetAfternoon, { name }) : t.home.greetAfternoonNoName;
  return name ? fmt(t.home.greetEvening, { name }) : t.home.greetEveningNoName;
}

/** The flattened per-event row the whole board renders from. */
interface BoardEvent {
  id: string;
  name: string;
  venue: string;
  date: string;
  door: string;
  startsAtMs: number;
  when: 'today' | 'upcoming' | 'past';
  live: boolean;
  locked: boolean;
  onList: number;
  inside: number;
  turnout: number;
  requests: number;
  quota: number;
}

// ── status chip ───────────────────────────────────────────────────────────────
function StatusChip({ e }: { e: BoardEvent }): JSX.Element {
  const label = e.live
    ? t.home.chipLive
    : e.when === 'today'
      ? t.home.chipTonight
      : e.when === 'past'
        ? t.home.chipPast
        : t.home.chipUpcoming;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-[6px] whitespace-nowrap rounded-full border px-[9px] py-1 font-body text-[11px] font-extrabold uppercase tracking-[0.04em]',
        e.live ? 'border-transparent bg-acc-dim text-acc' : 'border-line text-faint'
      )}
    >
      <span className="relative h-[7px] w-[7px]">
        {e.live && <span className="absolute -inset-1 rounded-full bg-acc opacity-60 motion-safe:animate-ping" />}
        <span className={cn('absolute inset-0 rounded-full', e.live ? 'bg-acc' : 'bg-ghost')} />
      </span>
      {label}
    </span>
  );
}

// ── pulse strip ─────────────────────────────────────────────────────────────
// A tile is a plain readout, or — when `onClick` is set (Requests / Quota) — a
// button that jumps into the approval inbox. Clickable tiles show a → affordance.
function PulseTile({
  icon,
  label,
  value,
  action,
  onClick,
  className,
}: {
  icon: IconName;
  label: string;
  value: string | number;
  action?: boolean;
  onClick?: () => void;
  className?: string;
}): JSX.Element {
  const cls = cn(
    'flex min-w-0 flex-1 flex-col rounded-[18px] border p-[16px_18px] text-left',
    action ? 'border-transparent bg-acc-dim' : 'border-line bg-elev',
    onClick && press,
    className
  );
  const inner = (
    <>
      <div className="mb-3 flex items-center gap-2">
        <span className={action ? 'text-acc' : 'text-faint'}>
          <Icon name={icon} size={16} />
        </span>
        <span className="font-body text-[11.5px] font-bold uppercase tracking-[0.03em] text-faint">{label}</span>
        {onClick && (
          <span className={cn('ml-auto', action ? 'text-acc' : 'text-ghost')}>
            <Icon name="arrowR" size={15} />
          </span>
        )}
      </div>
      <div
        className={cn(
          'font-display text-[34px] font-extrabold leading-none tracking-[-0.03em]',
          action ? 'text-acc' : 'text-text'
        )}
      >
        {value}
      </div>
    </>
  );
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={cls}>
        {inner}
      </button>
    );
  return <div className={cls}>{inner}</div>;
}

// ── combined graph (requested vs on-the-list, grouped per event) ──────────────
// One chart, two bars per event on a SHARED y-scale so the comparison is honest.
// Hovering (desktop) or tapping (touch) a column reveals a tooltip with both
// exact numbers — the bars themselves stay number-free so 8 events read clean.
function ComboChart({
  data,
}: {
  data: { id: string; label: string; live: boolean; requested: number; onList: number }[];
}): JSX.Element {
  const [active, setActive] = useState<number | null>(null);
  const H = 168;
  const top = Math.max(...data.flatMap((d) => [d.requested, d.onList]), 1);
  const last = data.length - 1;
  const barH = (v: number): number => (v <= 0 ? 0 : Math.max((v / top) * (H - 16), 3));
  return (
    <div className="card flex min-w-0 flex-col rounded-[22px] border border-line bg-elev p-[22px]">
      {/* header + legend */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="font-display text-[16.5px] font-bold tracking-[-0.01em] text-text">
            {t.home.graphComboTitle}
          </div>
          <div className="mt-0.5 text-[12.5px] text-faint">{t.home.graphComboSub}</div>
        </div>
        <div className="flex items-center gap-[14px]">
          <span className="inline-flex items-center gap-[7px] font-body text-[12px] font-semibold text-dim">
            <span className="h-[10px] w-[10px] rounded-[3px] bg-acc-soft" />
            {t.home.legRequested}
          </span>
          <span className="inline-flex items-center gap-[7px] font-body text-[12px] font-semibold text-dim">
            <span className="h-[10px] w-[10px] rounded-[3px] bg-acc" />
            {t.home.legOnList}
          </span>
        </div>
      </div>

      {/* plot */}
      <div className="relative mb-[10px]" style={{ height: H }}>
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={i === 3 ? 'h-px bg-line' : 'h-px bg-line2'} />
          ))}
        </div>
        <div className="relative flex h-full items-end gap-1">
          {data.map((d, i) => {
            const on = active === i;
            return (
              <button
                type="button"
                key={d.id}
                aria-label={`${d.label}: ${d.requested} ${t.home.legRequested}, ${d.onList} ${t.home.legOnList}`}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive((cur) => (cur === i ? null : cur))}
                onClick={() => setActive((cur) => (cur === i ? null : i))}
                className="group relative flex h-full min-w-0 flex-1 items-end justify-center rounded-[8px] transition-colors"
                style={{ background: on ? 'rgba(255,255,255,0.04)' : undefined }}
              >
                <span className="flex h-full items-end justify-center gap-[4px] px-0.5">
                  <span
                    className="w-full max-w-[15px] rounded-[5px_5px_2px_2px] bg-acc-soft transition-[height,filter] duration-300 group-hover:brightness-110"
                    style={{ height: barH(d.requested), minWidth: 6 }}
                  />
                  <span
                    className="relative w-full max-w-[15px] rounded-[5px_5px_2px_2px] bg-acc transition-[height,filter] duration-300 group-hover:brightness-110"
                    style={{ height: barH(d.onList), minWidth: 6 }}
                  >
                    {d.live && (
                      <span className="absolute -top-[3px] left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-white motion-safe:animate-pulse" />
                    )}
                  </span>
                </span>

                {on && (
                  <span
                    className={cn(
                      'absolute bottom-[calc(100%+8px)] z-10 w-max max-w-[200px] rounded-[12px] border border-line bg-elev2 p-[10px_12px] text-left shadow-[0_10px_34px_rgba(0,0,0,0.5)]',
                      i === 0 ? 'left-0' : i === last ? 'right-0' : 'left-1/2 -translate-x-1/2'
                    )}
                  >
                    <span className="mb-1.5 block truncate font-display text-[13px] font-bold text-text">{d.label}</span>
                    <span className="flex items-center justify-between gap-5 font-body text-[12.5px]">
                      <span className="inline-flex items-center gap-[6px] text-dim">
                        <span className="h-[9px] w-[9px] rounded-[2px] bg-acc-soft" />
                        {t.home.legRequested}
                      </span>
                      <span className="font-display font-extrabold text-text">{d.requested}</span>
                    </span>
                    <span className="mt-1 flex items-center justify-between gap-5 font-body text-[12.5px]">
                      <span className="inline-flex items-center gap-[6px] text-dim">
                        <span className="h-[9px] w-[9px] rounded-[2px] bg-acc" />
                        {t.home.legOnList}
                      </span>
                      <span className="font-display font-extrabold text-text">{d.onList}</span>
                    </span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex gap-1">
        {data.map((d, i) => (
          <div
            key={d.id}
            className={cn(
              'min-w-0 flex-1 truncate px-0.5 text-center font-body text-[10.5px] font-semibold',
              active === i ? 'text-text' : d.live ? 'text-acc-soft' : 'text-faint'
            )}
          >
            {d.label}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── event card pieces ─────────────────────────────────────────────────────────
// A stat readout. Requests / Quota pass `onClick` → tapping the number itself
// opens that event's approval queue (stopPropagation keeps the card's Open click
// from also firing).
function Count({
  value,
  label,
  action,
  live,
  onClick,
}: {
  value: string | number;
  label: string;
  action?: boolean;
  live?: boolean;
  onClick?: () => void;
}): JSX.Element {
  const cls = cn(
    'min-w-0 max-lg:flex-1 max-lg:rounded-[12px] max-lg:border max-lg:border-line2 max-lg:bg-bg max-lg:p-[9px_11px] lg:text-center',
    onClick && cn(press, 'cursor-pointer max-lg:hover:border-ghost')
  );
  const inner = (
    <>
      <div
        className={cn(
          'font-display text-[19px] font-extrabold leading-none tracking-[-0.02em]',
          action ? 'text-acc' : live ? 'text-acc-soft' : 'text-text'
        )}
      >
        {value}
      </div>
      <div
        className={cn(
          'mt-[5px] whitespace-nowrap font-body text-[10.5px] font-bold uppercase tracking-[0.03em]',
          action ? 'text-acc-soft' : 'text-faint'
        )}
      >
        {label}
      </div>
    </>
  );
  if (onClick)
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className={cn(cls, 'text-left lg:text-center')}
      >
        {inner}
      </button>
    );
  return <div className={cls}>{inner}</div>;
}

function ActionBtn({
  icon,
  title,
  badge,
  on,
  onClick,
}: {
  icon: IconName;
  title: string;
  badge?: number;
  on?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'relative flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] border',
        on ? 'border-transparent bg-acc-dim text-acc' : 'border-line bg-elev2 text-dim',
        press
      )}
    >
      <Icon name={icon} size={19} />
      {badge != null && badge > 0 && (
        <span className="absolute -right-1.5 -top-1.5 inline-flex h-[19px] min-w-[19px] items-center justify-center rounded-full border-2 border-bg bg-acc px-[5px] font-body text-[11px] font-extrabold text-on-acc">
          {badge}
        </span>
      )}
    </button>
  );
}

function EventRow({
  e,
  showDoor,
  onOpen,
  onDoor,
  onReq,
  onEdit,
  onLock,
}: {
  e: BoardEvent;
  showDoor: boolean;
  onOpen: () => void;
  onDoor: () => void;
  onReq: (tab: 'landing' | 'quota') => void;
  onEdit: () => void;
  onLock: () => void;
}): JSX.Element {
  const counts = (
    <div className="ev-counts flex shrink-0 flex-wrap gap-2 lg:items-center lg:gap-[26px]">
      <Count value={kfmt(e.onList)} label={t.home.cOnList} />
      <Count value={e.requests} label={t.home.cRequests} action={e.requests > 0} onClick={() => onReq('landing')} />
      <Count value={e.quota} label={t.home.cQuota} action={e.quota > 0} onClick={() => onReq('quota')} />
      {e.live && <Count value={`${e.inside} · ${e.turnout}%`} label={t.home.cInside} live />}
    </div>
  );
  const actions = (
    <div className="flex shrink-0 items-center gap-2 max-lg:w-full">
      <Btn sm kind="primary" icon="arrowR" onClick={onOpen} className="max-lg:flex-1" style={{ flexDirection: 'row-reverse' }}>
        {t.home.aOpen}
      </Btn>
      {showDoor && <ActionBtn icon="door" title={t.home.aDoor} onClick={onDoor} />}
      <ActionBtn icon="inbox" title={t.home.aRequests} badge={e.requests} onClick={() => onReq('landing')} />
      <ActionBtn icon="cog" title={t.home.aEdit} onClick={onEdit} />
      <ActionBtn
        icon="lock"
        title={e.locked ? t.home.aUnlock : t.home.aLock}
        on={e.locked}
        onClick={onLock}
      />
    </div>
  );
  const meta = (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-dim">
      <span className="inline-flex items-center gap-[5px]">
        <Icon name="pin" size={13} className="text-faint" />
        {e.venue}
      </span>
      <span className="text-ghost">·</span>
      <span className="inline-flex items-center gap-[5px]">
        <Icon name="cal" size={13} className="text-faint" />
        {e.date}
      </span>
      <span className="text-ghost">·</span>
      <span className="inline-flex items-center gap-[5px]">
        <Icon name="clock" size={13} className="text-faint" />
        {fmt(t.home.doorAt, { time: e.door })}
      </span>
    </div>
  );
  return (
    <div
      onClick={onOpen}
      className={cn(
        'evcard cursor-pointer rounded-[20px] border p-4 transition-[border-color] active:scale-[0.995] lg:flex lg:items-center lg:gap-[22px] lg:p-[18px_22px]',
        e.live ? 'border-[rgba(181,166,255,0.28)]' : 'border-line bg-elev hover:border-ghost'
      )}
      style={
        e.live
          ? { background: 'linear-gradient(110deg, rgba(181,166,255,0.10), transparent 45%), #161618' }
          : undefined
      }
    >
      <div className="min-w-0 flex-1 max-lg:mb-[14px]">
        <div className="flex items-start gap-2.5 lg:items-center">
          <span className="min-w-0 font-display text-[19px] font-extrabold leading-[1.1] tracking-[-0.02em] text-text lg:text-[21px]">
            {e.name}
          </span>
          <span className="ml-auto lg:ml-2">
            <StatusChip e={e} />
          </span>
        </div>
        {meta}
      </div>
      <div className="max-lg:mb-[14px]">{counts}</div>
      {actions}
    </div>
  );
}

// ── search + filter ───────────────────────────────────────────────────────────
function SearchFilter({
  query,
  setQuery,
  filter,
  setFilter,
  counts,
}: {
  query: string;
  setQuery: (s: string) => void;
  filter: string;
  setFilter: (s: string) => void;
  counts: Record<string, number>;
}): JSX.Element {
  const filters: [string, string][] = [
    ['all', t.home.filterAll],
    ['today', t.home.filterToday],
    ['upcoming', t.home.filterUpcoming],
  ];
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
      <div className="flex flex-1 items-center gap-[11px] rounded-[14px] border border-line bg-elev px-[15px] py-[11px]">
        <Icon name="search" size={19} className="shrink-0 text-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.home.searchEvents}
          className="min-w-0 flex-1 bg-transparent font-body text-[16px] text-text outline-none placeholder:text-faint"
        />
      </div>
      <div className="flex gap-1 overflow-x-auto rounded-[13px] border border-line bg-elev p-1">
        {filters.map(([k, l]) => {
          const on = filter === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              className={cn(
                'inline-flex min-h-[40px] items-center gap-[7px] whitespace-nowrap rounded-[9px] px-[14px] font-display text-[13.5px] font-bold',
                press,
                on ? 'bg-acc text-on-acc' : 'text-dim'
              )}
            >
              {l}
              <span className={cn('font-body text-[11px] font-bold', on ? 'text-on-acc/70' : 'text-faint')}>
                {counts[k] ?? 0}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── pagination ────────────────────────────────────────────────────────────────
function Pagination({
  page,
  pages,
  setPage,
  total,
  shown,
}: {
  page: number;
  pages: number;
  setPage: (n: number) => void;
  total: number;
  shown: number;
}): JSX.Element {
  if (pages <= 1)
    return <div className="py-1.5 text-center text-[12.5px] text-faint">{fmt(t.home.eventsCount, { n: total })}</div>;
  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <span className="text-[12.5px] text-faint">{fmt(t.home.pageOf, { shown, total })}</span>
      <div className="flex items-center gap-[7px]">
        <button
          type="button"
          disabled={page === 0}
          onClick={() => setPage(page - 1)}
          className={cn('flex h-[38px] w-[38px] items-center justify-center rounded-[11px] border border-line bg-elev', press, page === 0 ? 'text-ghost' : 'text-dim')}
        >
          <Icon name="back" size={17} />
        </button>
        {Array.from({ length: pages }).map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setPage(i)}
            className={cn(
              'h-[38px] min-w-[38px] rounded-[11px] border font-display text-[14px] font-bold',
              press,
              i === page ? 'border-transparent bg-acc text-on-acc' : 'border-line bg-elev text-dim'
            )}
          >
            {i + 1}
          </button>
        ))}
        <button
          type="button"
          disabled={page === pages - 1}
          onClick={() => setPage(page + 1)}
          className={cn('flex h-[38px] w-[38px] items-center justify-center rounded-[11px] border border-line bg-elev', press, page === pages - 1 ? 'text-ghost' : 'text-dim')}
        >
          <Icon name="chev" size={17} />
        </button>
      </div>
    </div>
  );
}

function Skeleton(): JSX.Element {
  return (
    <div className="flex items-center gap-[22px] rounded-[20px] border border-line bg-elev p-[18px_22px]">
      <div className="min-w-0 flex-1">
        <div className="h-[18px] w-[45%] animate-pulse rounded-[7px] bg-elev2" />
        <div className="mt-3 h-3 w-[62%] animate-pulse rounded-md bg-elev2" />
      </div>
      <div className="flex gap-2 max-lg:hidden">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-11 w-11 animate-pulse rounded-[12px] bg-elev2" />
        ))}
      </div>
    </div>
  );
}

function EmptyBoard({
  filtered,
  isAdmin,
  onClear,
  onNew,
}: {
  filtered: boolean;
  isAdmin: boolean;
  onClear: () => void;
  onNew: () => void;
}): JSX.Element {
  return (
    <div className="flex flex-col items-center rounded-[22px] border border-dashed border-line bg-elev px-6 py-[54px] text-center">
      <span className="flex h-[60px] w-[60px] items-center justify-center rounded-[18px] border border-line bg-elev2 text-faint">
        <Icon name={filtered ? 'search' : 'cal'} size={26} />
      </span>
      <div className="mt-[18px] font-display text-[21px] font-extrabold tracking-[-0.01em] text-text">
        {filtered ? t.home.emptyFilteredTitle : t.home.emptyNoneTitle}
      </div>
      <div className="mt-[7px] max-w-[320px] text-[14px] leading-[1.5] text-faint">
        {filtered ? t.home.emptyFilteredBody : t.home.emptyNoneBody}
      </div>
      <div className="mt-[22px]">
        {filtered ? (
          <Btn kind="ghost" sm icon="close" onClick={onClear}>
            {t.home.clearFilters}
          </Btn>
        ) : (
          isAdmin && (
            <Btn kind="primary" sm icon="cal" onClick={onNew}>
              {t.home.createEvent}
            </Btn>
          )
        )}
      </div>
    </div>
  );
}

// ── screen ────────────────────────────────────────────────────────────────────
export function Home(): JSX.Element {
  const nav = useNav();
  const { roles, venueName } = usePoIdentity();
  const showDoor = canWorkDoor(roles);
  const isAdmin = roles.includes('admin');
  // Soft-block (#32 refinement): hide growth CTAs; the banner explains why.
  const billingLock = useBillingBlocked();

  const eventsQ = usePoHomeEvents();
  const guestReqQ = usePoGuestRequests();
  const quotaReqQ = usePoQuotaRequests();
  const firstName = usePoProfile().data?.firstName ?? '';

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [guestPickOpen, setGuestPickOpen] = useState(false);
  const [guestQuery, setGuestQuery] = useState('');
  // Lock is optimistic-local for now (the DB lock mutation lives on the event /
  // cockpit; wiring it here is a follow-up). Tracked per event id.
  const [lockOverride, setLockOverride] = useState<Record<string, boolean>>({});

  const showToast = (msg: string): void => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  };

  const board: BoardEvent[] = useMemo(() => {
    const evs: HomeEvent[] = eventsQ.data?.events ?? [];
    const reqBy = new Map<string, number>();
    for (const r of guestReqQ.data ?? []) reqBy.set(r.eventId, (reqBy.get(r.eventId) ?? 0) + 1);
    const quotaBy = new Map<string, number>();
    for (const r of quotaReqQ.data ?? []) quotaBy.set(r.eventId, (quotaBy.get(r.eventId) ?? 0) + 1);
    const today = dayKey(Date.now());
    const now = Date.now();
    return evs.map((e) => {
      const phase = eventPhase(e.starts_at, e.ends_at, now);
      const live = phase === 'live';
      const when: BoardEvent['when'] =
        phase === 'past' ? 'past' : live || dayKey(e.starts_at) === today ? 'today' : 'upcoming';
      return {
        id: e.id,
        name: e.name,
        venue: e.venue_name,
        date: fmtDate(e.starts_at),
        door: fmtTime(e.starts_at),
        startsAtMs: new Date(e.starts_at).getTime(),
        when,
        live,
        locked: lockOverride[e.id] ?? e.list_locked,
        onList: e.registered,
        inside: e.present,
        turnout: e.registered > 0 ? Math.round((e.present / e.registered) * 100) : 0,
        requests: reqBy.get(e.id) ?? 0,
        quota: quotaBy.get(e.id) ?? 0,
      };
    });
  }, [eventsQ.data, guestReqQ.data, quotaReqQ.data, lockOverride]);

  // Upcoming section: live/today first, then soonest upcoming.
  const sortUpcoming = (a: BoardEvent, b: BoardEvent): number => {
    const wA = a.when === 'today' ? 0 : 1;
    const wB = b.when === 'today' ? 0 : 1;
    if (wA !== wB) return wA - wB;
    return a.startsAtMs - b.startsAtMs;
  };

  const pulse = useMemo(
    () => ({
      requests: guestReqQ.data?.length ?? 0,
      quota: quotaReqQ.data?.length ?? 0,
      live: board.filter((e) => e.live).length,
      today: board.filter((e) => e.when === 'today').length,
      upcoming: board.filter((e) => e.when === 'upcoming').length,
      hasLive: board.some((e) => e.live),
    }),
    [board, guestReqQ.data, quotaReqQ.data]
  );

  // Cap the graph to non-past events (today/live first) so the chart stays relevant.
  const series = useMemo(
    () =>
      board
        .filter((e) => e.when !== 'past')
        .slice()
        .sort(sortUpcoming)
        .slice(0, 8)
        .map((e) => ({ id: e.id, label: e.name, live: e.live, requested: e.requests, onList: e.onList })),
    [board]
  );

  const segCounts = useMemo(
    () => ({
      all: board.filter((e) => e.when !== 'past').length,
      today: board.filter((e) => e.when === 'today').length,
      upcoming: board.filter((e) => e.when === 'upcoming').length,
    }),
    [board]
  );

  // Upcoming section: non-past events filtered by tab + search.
  const upcomingList = useMemo(() => {
    const q = query.trim().toLowerCase();
    return board
      .filter((e) => e.when !== 'past' && (filter === 'all' || e.when === filter) && (!q || (e.name + ' ' + e.venue).toLowerCase().includes(q)))
      .sort(sortUpcoming);
  }, [board, query, filter]);

  // Past section: past events filtered by search only, most recent first.
  const pastList = useMemo(() => {
    const q = query.trim().toLowerCase();
    return board
      .filter((e) => e.when === 'past' && (!q || (e.name + ' ' + e.venue).toLowerCase().includes(q)))
      .sort((a, b) => b.startsAtMs - a.startsAtMs);
  }, [board, query]);

  // Guest-picker sheet: non-past events, filtered by its own search box.
  const pickable = useMemo(() => board.filter((e) => e.when !== 'past').sort(sortUpcoming), [board]);
  const pickMatches = useMemo(() => {
    const q = guestQuery.trim().toLowerCase();
    return q ? pickable.filter((e) => (e.name + ' ' + e.venue).toLowerCase().includes(q)) : pickable;
  }, [pickable, guestQuery]);

  // Alias used in EmptyBoard + pagination (upcoming section only).
  const list = upcomingList;

  const filtersActive = query.trim() !== '' || filter !== 'all';
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const pageClamped = Math.min(page, pages - 1);
  const visible = list.slice(pageClamped * PAGE_SIZE, pageClamped * PAGE_SIZE + PAGE_SIZE);

  const onLock = (e: BoardEvent): void => {
    const next = !e.locked;
    setLockOverride((m) => ({ ...m, [e.id]: next }));
    showToast(fmt(next ? t.home.toastListLocked : t.home.toastListOpen, { name: e.name }));
  };

  const loading = eventsQ.isLoading;

  return (
    <div className="flex h-full flex-col">
      <Scroll pad={0} bottom={28} className="po-screen-anim">
        <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-[22px] px-4 pb-2 pt-[18px] lg:px-[38px] lg:pt-[30px]">
          <PendingInvitesBanner />

          {/* greeting */}
          {nav.canGoBack && (
            <div>
              <button
                type="button"
                onClick={nav.back}
                aria-label={t.shared.kit.back}
                className="flex h-[40px] w-[40px] items-center justify-center rounded-[12px] border border-line bg-elev text-text transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]"
              >
                <Icon name="back" size={20} />
              </button>
            </div>
          )}
          <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end lg:gap-4">
            <div className="min-w-0 lg:flex-1">
              <h1 className="font-display text-[27px] font-extrabold leading-[1.02] tracking-[-0.025em] text-text lg:text-[33px]">
                {greetingFor(amsterdamHour(), firstName)}
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13.5px] text-faint">
                <span className="font-semibold text-dim">{venueName ?? 'Venue'}</span>
                {pulse.upcoming > 0 && (
                  <>
                    <span className="text-ghost">·</span>
                    <span>{fmt(t.home.metaUpcoming, { n: pulse.upcoming })}</span>
                  </>
                )}
                {pulse.hasLive && (
                  <>
                    <span className="text-ghost">·</span>
                    <span className="inline-flex items-center gap-1.5 font-bold text-acc">
                      <span className="h-[7px] w-[7px] rounded-full bg-acc motion-safe:animate-pulse" />
                      {t.home.metaDoorsOpen}
                    </span>
                  </>
                )}
              </div>
            </div>
            <div className="flex gap-2.5">
              <Btn
                sm
                icon="plus"
                onClick={() => {
                  setGuestQuery('');
                  setGuestPickOpen(true);
                }}
              >
                {t.home.newGuest}
              </Btn>
            </div>
          </div>

          {isAdmin && billingLock.blocked && (
            <Note icon="warn">
              {billingLock.reason === 'canceled'
                ? t.settings.billing.blockedCanceled
                : t.settings.billing.blockedTrial}{' '}
              <button
                type="button"
                className="cursor-pointer font-bold text-acc underline underline-offset-2"
                onClick={() => nav.push('billing')}
              >
                {t.settings.billing.blockedCta}
              </button>
            </Note>
          )}

          {/* pulse strip — Requests / Quota tiles deep-link into the inbox */}
          <div className="grid grid-cols-2 gap-[14px] lg:grid-cols-3">
            <PulseTile
              icon="inbox"
              label={t.home.pulseRequests}
              value={pulse.requests}
              action={pulse.requests > 0}
              onClick={() => nav.push('aanvragen', { tab: 'landing' })}
            />
            <PulseTile
              icon="ticket"
              label={t.home.pulseQuota}
              value={pulse.quota}
              action={pulse.quota > 0}
              onClick={() => nav.push('aanvragen', { tab: 'quota' })}
            />
            <PulseTile
              icon="spark"
              label={t.home.pulseLive}
              value={pulse.live}
              onClick={() => nav.setTab('events')}
              className="max-lg:col-span-2"
            />
          </div>

          {/* combined graph — requested vs on-the-list, per event */}
          {board.length > 0 && <ComboChart data={series} />}

          {/* Upcoming events section */}
          <div>
            <div className="mb-4 flex flex-wrap items-center gap-2.5">
              <h2 className="font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">
                {t.home.upcomingEventsHeading}
              </h2>
              {!loading && (
                <span className="text-[12.5px] text-faint">
                  {list.length} {filtersActive ? t.home.countFound : t.home.countTotal}
                </span>
              )}
            </div>
            <div className="mb-4">
              <SearchFilter query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} counts={segCounts} />
            </div>

            {loading ? (
              <div className="flex flex-col gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} />
                ))}
              </div>
            ) : list.length === 0 ? (
              <EmptyBoard
                filtered={filtersActive}
                isAdmin={isAdmin}
                onClear={() => {
                  setQuery('');
                  setFilter('all');
                }}
                onNew={() => nav.push('eventedit', { isNew: true })}
              />
            ) : (
              <>
                <div className="flex flex-col gap-3">
                  {visible.map((e) => (
                    <EventRow
                      key={e.id}
                      e={e}
                      showDoor={showDoor}
                      onOpen={() => nav.push('event', { id: e.id })}
                      onDoor={() => nav.openDoor(e.id)}
                      onReq={(tab) => nav.push('aanvragen', { id: e.id, tab })}
                      onEdit={() => nav.push('eventedit', { id: e.id })}
                      onLock={() => onLock(e)}
                    />
                  ))}
                </div>
                <div className="mt-[22px]">
                  <Pagination
                    page={pageClamped}
                    pages={pages}
                    setPage={setPage}
                    total={list.length}
                    shown={visible.length + pageClamped * PAGE_SIZE}
                  />
                </div>
              </>
            )}
          </div>

          {/* Past events section — most recent first, capped at 5, link to Events tab */}
          {!loading && pastList.length > 0 && (
            <div>
              <div className="mb-4 flex flex-wrap items-center gap-2.5">
                <h2 className="font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">
                  {t.home.pastEventsHeading}
                </h2>
                <span className="text-[12.5px] text-faint">
                  {fmt(pastList.length === 1 ? t.home.pastEventsCount : t.home.pastEventsCountPlural, { n: pastList.length })}
                </span>
              </div>
              <div className="flex flex-col gap-3">
                {pastList.slice(0, 5).map((e) => (
                  <EventRow
                    key={e.id}
                    e={e}
                    showDoor={false}
                    onOpen={() => nav.push('pastevent', { id: e.id })}
                    onDoor={() => nav.openDoor(e.id)}
                    onReq={(tab) => nav.push('aanvragen', { id: e.id, tab })}
                    onEdit={() => nav.push('eventedit', { id: e.id })}
                    onLock={() => onLock(e)}
                  />
                ))}
              </div>
              {pastList.length > 5 && (
                <div className="mt-4 text-center">
                  <button
                    type="button"
                    onClick={() => nav.setTab('events')}
                    className={cn('inline-flex items-center gap-2 font-body text-[13.5px] font-bold text-dim', press)}
                  >
                    {t.home.viewAllPast}
                    <Icon name="arrowR" size={15} />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </Scroll>
      {toast && <Toast>{toast}</Toast>}

      {guestPickOpen && (
        <Sheet onClose={() => setGuestPickOpen(false)}>
          <h2 className="mb-4 font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">
            {t.home.pickEventForGuest}
          </h2>
          {pickable.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <p className="text-[14px] text-faint">{t.home.noUpcomingToday}</p>
              {isAdmin && !billingLock.blocked && (
                <Btn sm kind="primary" icon="cal" onClick={() => { setGuestPickOpen(false); nav.push('eventedit', { isNew: true }); }}>
                  {t.home.newEvent}
                </Btn>
              )}
            </div>
          ) : (
            <>
              <div className="mb-3 flex w-full items-center gap-[11px] rounded-[14px] border border-line bg-bg px-[15px] py-[11px]">
                <Icon name="search" size={19} className="shrink-0 text-faint" />
                <input
                  value={guestQuery}
                  onChange={(e) => setGuestQuery(e.target.value)}
                  placeholder={t.home.searchEvents}
                  className="min-w-0 flex-1 bg-transparent font-body text-[16px] text-text outline-none placeholder:text-faint"
                />
              </div>
              {pickMatches.length === 0 ? (
                <p className="py-5 text-center text-[14px] text-faint">{t.home.emptyFilteredTitle}</p>
              ) : (
                <div className="flex w-full flex-col gap-2">
                  {pickMatches.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => {
                        setGuestPickOpen(false);
                        nav.push('quickadd', { id: e.id });
                      }}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-[16px] border border-line bg-elev px-4 py-3 text-left',
                        press
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-display text-[15.5px] font-bold text-text">{e.name}</div>
                        <div className="mt-0.5 text-[12.5px] text-faint">
                          {e.date} · {fmt(t.home.doorAt, { time: e.door })}
                        </div>
                      </div>
                      <StatusChip e={e} />
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </Sheet>
      )}
    </div>
  );
}
