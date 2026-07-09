'use client';

/**
 * Shared event card (the Home "operations board" row) + its BoardEvent mapping.
 *
 * Extracted from screens/home.tsx (Max, 7 jul 2026) so the door's event picker
 * renders the SAME card as the Home/board list — one component, so a design
 * change propagates to every surface that lists events. Home and the Deur/cockpit
 * picker both import from here; never fork this card per screen.
 */
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import type { HomeEvent } from '@/features/po/adapters';
import { isOpenGuestRequest } from '@/features/po/adapters';
import { eventPhase } from '@/features/po/event-phase';
import { TZ, formatTime, formatWeekdayDate } from '@/features/po/format';
import { Icon, type IconName } from './icon';
import { Btn, press } from './kit';

// FE-2: these three used to hand-roll their own Intl.DateTimeFormat + TZ const
// (drifted from adapters.ts's/door's equivalents) — now thin aliases over the
// shared, pinned formatters. Kept as named exports (not inlined at call sites)
// since screens import fmtTime/fmtDate/dayKey from here, not from format.ts.
export const fmtTime = formatTime;
export const fmtDate = formatWeekdayDate;
export const dayKey = (iso: string | number): string => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
export const kfmt = (n: number): string => (n >= 1000 ? (n / 1000).toFixed(1).replace('.0', '') + 'k' : String(n));

/**
 * The flattened per-event row the board (and the door picker) renders from.
 *
 * FE-1 note: NOT collapsed into `Pick<PoEvent, ...>` despite the name overlap on
 * `date`/`when` — those two fields mean something DIFFERENT here than on
 * `PoEvent` (PoEvent.date is a bare day-of-month digit; BoardEvent.date is a
 * full weekday+day+month string. PoEvent.when is 'upcoming'|'past'; BoardEvent
 * adds the 'today' bucket the board needs). Aliasing them would silently
 * misrepresent what the field holds — verified during the FE-1 audit, kept
 * deliberately separate rather than forced into a shared shape.
 */
export interface BoardEvent {
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

/**
 * Map the home-events bundle + the venue-wide request lists to BoardEvent rows.
 * Pure (now injected) — Home's board memo and the door picker share this, so the
 * counts/phase/date formatting can never drift between the two surfaces.
 */
export function toBoardEvents(
  events: HomeEvent[],
  guestReqs: { eventId: string; status: string }[],
  quotaReqs: { eventId: string }[],
  lockOverride: Record<string, boolean>,
  nowMs: number
): BoardEvent[] {
  // Only OPEN (pending) requests count toward the card badge — shared predicate
  // so the board, the Home pulse tile, and the Requests screen never disagree (T9).
  const reqBy = new Map<string, number>();
  for (const r of guestReqs) if (isOpenGuestRequest(r)) reqBy.set(r.eventId, (reqBy.get(r.eventId) ?? 0) + 1);
  const quotaBy = new Map<string, number>();
  for (const r of quotaReqs) quotaBy.set(r.eventId, (quotaBy.get(r.eventId) ?? 0) + 1);
  const today = dayKey(nowMs);
  return events.map((e) => {
    const phase = eventPhase(e.starts_at, e.ends_at, nowMs);
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
}

// ── status chip ───────────────────────────────────────────────────────────────
export function StatusChip({ e }: { e: BoardEvent }): JSX.Element {
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

/**
 * The away-navigating affordances (requests inbox, event settings, lock) are
 * OPTIONAL: a caller that omits the handler gets a card without that button.
 * Home passes all of them (the full operations card); the door's event picker
 * passes none — there, every click must lead to the door, never to the event
 * settings (Max, 7 jul 2026).
 */
export function EventRow({
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
  onReq?: (tab: 'landing' | 'quota') => void;
  onEdit?: () => void;
  onLock?: () => void;
}): JSX.Element {
  const counts = (
    <div className="ev-counts flex shrink-0 flex-wrap gap-2 lg:items-center lg:gap-[26px]">
      <Count value={kfmt(e.onList)} label={t.home.cOnList} />
      <Count value={e.requests} label={t.home.cRequests} action={e.requests > 0} onClick={onReq && (() => onReq('landing'))} />
      <Count value={e.quota} label={t.home.cQuota} action={e.quota > 0} onClick={onReq && (() => onReq('quota'))} />
      {e.live && <Count value={`${e.inside} · ${e.turnout}%`} label={t.home.cInside} live />}
    </div>
  );
  const actions = (
    <div className="flex shrink-0 items-center gap-2 max-lg:w-full">
      <Btn sm kind="primary" icon="arrowR" onClick={onOpen} className="max-lg:flex-1" style={{ flexDirection: 'row-reverse' }}>
        {t.home.aOpen}
      </Btn>
      {showDoor && <ActionBtn icon="door" title={t.home.aDoor} onClick={onDoor} />}
      {onReq && <ActionBtn icon="inbox" title={t.home.aRequests} badge={e.requests} onClick={() => onReq('landing')} />}
      {onEdit && <ActionBtn icon="cog" title={t.home.aEdit} onClick={onEdit} />}
      {onLock && (
        <ActionBtn
          icon="lock"
          title={e.locked ? t.home.aUnlock : t.home.aLock}
          on={e.locked}
          onClick={onLock}
        />
      )}
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
