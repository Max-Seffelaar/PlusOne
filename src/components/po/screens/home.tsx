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
import { usePoHomeEvents, usePoGuestRequests, usePoQuotaRequests, usePoProfile } from '@/features/po/hooks';
import type { HomeEvent } from '@/features/po/adapters';
import { canWorkDoor } from '@/features/auth/roles';
import { useNav } from '../context';
import { Icon, type IconName } from '../icon';
import { Btn, Scroll } from '../kit';
import { Toast } from '../shell';
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
  when: 'today' | 'upcoming';
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
  const label = e.live ? t.home.chipLive : e.when === 'today' ? t.home.chipTonight : t.home.chipUpcoming;
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
function PulseTile({
  icon,
  label,
  value,
  action,
}: {
  icon: IconName;
  label: string;
  value: string | number;
  action?: boolean;
}): JSX.Element {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-1 flex-col rounded-[18px] border p-[16px_18px]',
        action ? 'border-transparent bg-acc-dim' : 'border-line bg-elev'
      )}
    >
      <div className="mb-3 flex items-center gap-2">
        <span className={action ? 'text-acc' : 'text-faint'}>
          <Icon name={icon} size={16} />
        </span>
        <span className="font-body text-[11.5px] font-bold uppercase tracking-[0.03em] text-faint">{label}</span>
        {action && (
          <span className="ml-auto font-body text-[9.5px] font-extrabold uppercase tracking-[0.05em] text-acc">
            {t.home.badgeAction}
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
    </div>
  );
}

// ── bar panel (one metric per event) ──────────────────────────────────────────
function Bars({
  title,
  sub,
  data,
  accent,
}: {
  title: string;
  sub: string;
  data: { id: string; label: string; value: number; live: boolean }[];
  accent: boolean;
}): JSX.Element {
  const H = 150;
  const top = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="card flex min-w-0 flex-col rounded-[22px] border border-line bg-elev p-[22px]">
      <div className="mb-5">
        <div className="font-display text-[16.5px] font-bold tracking-[-0.01em] text-text">{title}</div>
        <div className="mt-0.5 text-[12.5px] text-faint">{sub}</div>
      </div>
      <div className="relative mb-[10px]" style={{ height: H }}>
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={i === 3 ? 'h-px bg-line' : 'h-px bg-line2'} />
          ))}
        </div>
        <div className="relative flex h-full items-end">
          {data.map((d) => {
            const h = Math.max((d.value / top) * (H - 22), 3);
            return (
              <div key={d.id} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
                <span className="font-display text-[12.5px] font-bold leading-none text-text">{kfmt(d.value)}</span>
                <div
                  className={cn(
                    'relative w-full max-w-[38px] rounded-[7px_7px_3px_3px] transition-[height] duration-300',
                    accent ? 'bg-acc' : 'bg-acc-soft'
                  )}
                  style={{ height: h }}
                >
                  {d.live && (
                    <span className="absolute -top-[3px] left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-white motion-safe:animate-pulse" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex">
        {data.map((d) => (
          <div
            key={d.id}
            className={cn(
              'min-w-0 flex-1 truncate px-0.5 text-center font-body text-[10.5px] font-semibold',
              d.live ? 'text-acc-soft' : 'text-faint'
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
function Count({ value, label, action, live }: { value: string | number; label: string; action?: boolean; live?: boolean }): JSX.Element {
  return (
    <div className="min-w-0 max-lg:flex-1 max-lg:rounded-[12px] max-lg:border max-lg:border-line2 max-lg:bg-bg max-lg:p-[9px_11px] lg:text-center">
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
    </div>
  );
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
  onReq: () => void;
  onEdit: () => void;
  onLock: () => void;
}): JSX.Element {
  const counts = (
    <div className="ev-counts flex shrink-0 flex-wrap gap-2 lg:items-center lg:gap-[26px]">
      <Count value={kfmt(e.onList)} label={t.home.cOnList} />
      <Count value={e.requests} label={t.home.cRequests} action={e.requests > 0} />
      <Count value={e.quota} label={t.home.cQuota} action={e.quota > 0} />
      {e.live && <Count value={`${e.inside} · ${e.turnout}%`} label={t.home.cInside} live />}
    </div>
  );
  const actions = (
    <div className="flex shrink-0 items-center gap-2 max-lg:w-full">
      <Btn sm kind="primary" icon="arrowR" onClick={onOpen} className="max-lg:flex-1" style={{ flexDirection: 'row-reverse' }}>
        {t.home.aOpen}
      </Btn>
      {showDoor && <ActionBtn icon="door" title={t.home.aDoor} onClick={onDoor} />}
      <ActionBtn icon="inbox" title={t.home.aRequests} badge={e.requests} onClick={onReq} />
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

  const eventsQ = usePoHomeEvents();
  const guestReqQ = usePoGuestRequests();
  const quotaReqQ = usePoQuotaRequests();
  const firstName = usePoProfile().data?.firstName ?? '';

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
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
    return evs.map((e) => {
      const live = e.status === 'live';
      return {
        id: e.id,
        name: e.name,
        venue: e.venue_name,
        date: fmtDate(e.starts_at),
        door: fmtTime(e.starts_at),
        when: live || dayKey(e.starts_at) === today ? 'today' : 'upcoming',
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

  const liveFirst = (a: BoardEvent, b: BoardEvent): number =>
    (a.when === 'today' ? 0 : 1) - (b.when === 'today' ? 0 : 1);

  const pulse = useMemo(
    () => ({
      onList: board.reduce((s, e) => s + e.onList, 0),
      requests: guestReqQ.data?.length ?? 0,
      quota: quotaReqQ.data?.length ?? 0,
      live: board.filter((e) => e.live).length,
      today: board.filter((e) => e.when === 'today').length,
      upcoming: board.filter((e) => e.when === 'upcoming').length,
      hasLive: board.some((e) => e.live),
    }),
    [board, guestReqQ.data, quotaReqQ.data]
  );

  // Cap the graph x-axis so it stays readable at scale (today/live first).
  const series = useMemo(
    () =>
      board
        .slice()
        .sort(liveFirst)
        .slice(0, 8)
        .map((e) => ({ id: e.id, label: e.name, live: e.live, requested: e.requests, onList: e.onList })),
    [board]
  );

  const segCounts = useMemo(
    () => ({
      all: board.length,
      today: board.filter((e) => e.when === 'today').length,
      upcoming: board.filter((e) => e.when === 'upcoming').length,
    }),
    [board]
  );

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return board
      .filter((e) => (filter === 'all' || e.when === filter) && (!q || (e.name + ' ' + e.venue).toLowerCase().includes(q)))
      .sort(liveFirst);
  }, [board, query, filter]);

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
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-[27px] font-extrabold leading-[1.02] tracking-[-0.025em] text-text lg:text-[33px]">
                {greetingFor(amsterdamHour(), firstName)}
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13.5px] text-faint">
                <span className="font-semibold text-dim">{venueName ?? 'Venue'}</span>
                <span className="text-ghost">·</span>
                <span>{fmt(t.home.metaEventsToday, { n: pulse.today })}</span>
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
            <div className="flex gap-2.5 max-lg:hidden">
              <Btn sm kind="ghost" icon="plus" onClick={() => nav.setTab('guests')}>
                {t.home.newGuest}
              </Btn>
              <Btn sm icon="cal" onClick={() => nav.push('eventedit', { isNew: true })}>
                {t.home.newEvent}
              </Btn>
            </div>
          </div>

          {/* pulse strip */}
          <div className="grid grid-cols-2 gap-[14px] lg:grid-cols-4">
            <PulseTile icon="users" label={t.home.pulseOnList} value={kfmt(pulse.onList)} />
            <PulseTile icon="inbox" label={t.home.pulseRequests} value={pulse.requests} action={pulse.requests > 0} />
            <PulseTile icon="ticket" label={t.home.pulseQuota} value={pulse.quota} action={pulse.quota > 0} />
            <PulseTile icon="spark" label={t.home.pulseLive} value={pulse.live} />
          </div>

          {/* two graphs */}
          {board.length > 0 && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Bars
                title={t.home.graphRequestedTitle}
                sub={t.home.graphRequestedSub}
                accent={false}
                data={series.map((s) => ({ id: s.id, label: s.label, value: s.requested, live: s.live }))}
              />
              <Bars
                title={t.home.graphOnListTitle}
                sub={t.home.graphOnListSub}
                accent
                data={series.map((s) => ({ id: s.id, label: s.label, value: s.onList, live: s.live }))}
              />
            </div>
          )}

          {/* events list */}
          <div>
            <div className="mb-4 flex flex-wrap items-center gap-2.5">
              <h2 className="font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">
                {t.home.eventsHeading}
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
                      onReq={() => nav.push('aanvragen', { id: e.id })}
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
        </div>
      </Scroll>
      {toast && <Toast>{toast}</Toast>}
    </div>
  );
}
