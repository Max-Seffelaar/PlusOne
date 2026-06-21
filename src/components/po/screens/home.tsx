'use client';

/**
 * S11 · Mobiel Dashboard-home (KPI's) — launchplan §4b#1, bouwplan 3.8.
 *
 * The post-login landing on a phone: an active-event card (live / pre-event /
 * quiet states) with an opkomstbalk, three KPI tiles (aanwezig · open aanvragen ·
 * quota-resterend), quick actions (Nieuwe gast · Open deur · Aanvragen) and an
 * MFA-gated mini activity-feed that links to the audit log (S10).
 *
 * Live data: role-scoped headcounts (same aggregation as the Events cards, so a
 * doorhost sees real numbers) + open guest_requests count + event_quota_status,
 * via usePoHomeEvents()/usePoHomeStats(). When more than one event is live or
 * upcoming, the event name becomes a switcher (picker sheet). A refresh button
 * re-reads everything — the home is a live read, so the offline outbox/force-sync
 * stays in the Deur tab (#25), never duplicated here. Recreated from the Claude
 * Design handoff with the real po kit; every action reuses an existing screen.
 * Entrance motion is the shell's `po-screen-anim` (translateY, reduced-motion-safe);
 * tap targets are ≥44px.
 */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { usePoAal2, usePoAuditFeed, usePoHomeEvents, usePoHomeStats, usePoProfile } from '@/features/po/hooks';
import { toPoHome, type HomeEvent, type HomeScenario, type PoHomeView } from '@/features/po/adapters';
import { canWorkDoor } from '@/features/auth/roles';
import { venueCapabilities } from '@/features/venues/access';
import { formatWhen } from '@/features/audit/translate';
import { formatDay } from '@/features/stats/format';
import { auditActionMeta, isDoorDevice } from '@/features/po/audit-presenter';
import { useNav } from '../context';
import { Icon, type IconName } from '../icon';
import { Avatar, Btn, Empty, Label, Scroll } from '../kit';
import { Sheet } from '../shell';
import { PendingInvitesBanner } from '../pending-invites-banner';

const press = 'transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]';
const col = 'flex h-full flex-col';

/** Current hour in the product TZ (#26) — identical on server and client, so the
 *  greeting can't cause a hydration mismatch the way a client-local hour would. */
function amsterdamHour(): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Amsterdam',
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(new Date())
  );
}

function greetingFor(hour: number): string {
  if (hour < 6) return 'Goedenacht';
  if (hour < 12) return 'Goedemorgen';
  if (hour < 18) return 'Goedemiddag';
  return 'Goedenavond';
}

// ── Greeting + refresh + venue switcher ───────────────────────────────────────
function TopBar({
  venueName,
  userName,
  firstName,
  onVenue,
  onRefresh,
  refreshing,
}: {
  venueName: string;
  userName: string;
  firstName: string;
  onVenue: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}): JSX.Element {
  const hello = greetingFor(amsterdamHour());
  return (
    <div
      className="flex flex-none items-center gap-2.5 px-[18px] pb-[14px]"
      style={{ paddingTop: 'calc(16px + env(safe-area-inset-top))' }}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold tracking-[0.01em] text-faint">
          {hello}
          {firstName ? `, ${firstName}` : ''}
        </div>
        <div className="font-display text-[24px] font-extrabold leading-[1.05] tracking-[-0.02em] text-text">
          Overzicht
        </div>
      </div>
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        aria-label="Verversen"
        className={cn(
          'flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] border border-line bg-elev text-text',
          press,
          refreshing && 'opacity-60'
        )}
      >
        <Icon name="refresh" size={19} className={cn(refreshing && 'motion-safe:animate-spin')} />
      </button>
      <button
        type="button"
        onClick={onVenue}
        aria-label="Wissel venue"
        className={cn(
          'inline-flex min-h-[44px] shrink-0 items-center gap-[9px] rounded-full border border-line bg-elev py-[7px] pl-[13px] pr-[7px] text-text',
          press
        )}
      >
        <span className="max-w-[88px] truncate font-display text-[13px] font-bold tracking-[-0.01em]">
          {venueName}
        </span>
        <Avatar name={userName || venueName} size={30} accent />
      </button>
    </div>
  );
}

// ── Live status dot (pulse only when truly live + motion allowed) ─────────────
function LiveBadge({ scenario, label }: { scenario: HomeScenario; label: string }): JSX.Element {
  const live = scenario === 'live';
  const quiet = scenario === 'quiet';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 whitespace-nowrap font-body text-[12.5px] font-extrabold uppercase tracking-[0.04em]',
        live ? 'text-acc' : quiet ? 'text-faint' : 'text-acc-soft'
      )}
    >
      <span className="relative h-[9px] w-[9px] shrink-0">
        {live && (
          <span className="absolute -inset-1 rounded-full bg-acc opacity-60 motion-safe:animate-ping" />
        )}
        <span
          className={cn(
            'absolute inset-0 rounded-full',
            live ? 'bg-acc' : quiet ? 'border-2 border-ghost' : 'bg-acc-soft'
          )}
        />
      </span>
      {label}
    </span>
  );
}

// ── Active-event hero (name is a switcher when >1 event is live/upcoming) ─────
function EventCard({
  v,
  showDoor,
  canSwitch,
  onSwitch,
  onDoor,
}: {
  v: PoHomeView;
  showDoor: boolean;
  canSwitch: boolean;
  onSwitch: () => void;
  onDoor: () => void;
}): JSX.Element {
  const live = v.scenario === 'live';
  const quiet = v.scenario === 'quiet';
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[22px] p-5',
        live ? 'border border-[rgba(181,166,255,0.30)]' : 'border border-line bg-elev'
      )}
      style={
        live
          ? {
              background:
                'linear-gradient(165deg, rgba(181,166,255,0.14), rgba(181,166,255,0.04) 60%, transparent), #161618',
            }
          : undefined
      }
    >
      <div className="mb-[14px] flex items-center">
        <LiveBadge scenario={v.scenario} label={v.statusLabel} />
        {v.locked && (
          <span className="ml-auto inline-flex items-center gap-[5px] whitespace-nowrap rounded-[7px] border border-line px-[9px] py-[3px] font-body text-[11px] font-bold text-faint">
            <Icon name="lock" size={11} sw={2} className="text-faint" />
            Lijst vergrendeld
          </span>
        )}
      </div>

      {canSwitch ? (
        <button type="button" onClick={onSwitch} aria-label="Wissel event" className={cn('-mx-1 flex max-w-full items-center gap-2 rounded-[10px] px-1 text-left', press)}>
          <span className="min-w-0 truncate font-display text-[27px] font-extrabold leading-[1.04] tracking-[-0.025em] text-text">
            {v.name}
          </span>
          <Icon name="chevD" size={20} className="shrink-0 text-ghost" />
        </button>
      ) : (
        <div className="font-display text-[27px] font-extrabold leading-[1.04] tracking-[-0.025em] text-text">
          {v.name}
        </div>
      )}
      <div className="mt-[7px] flex items-center gap-[9px] text-[13.5px] text-dim">
        <Icon name="cal" size={14} className="shrink-0 text-faint" />
        <span className="whitespace-nowrap">
          {v.dateLabel} · {v.time}
        </span>
        <span className="text-ghost">·</span>
        <Icon name="pin" size={14} className="shrink-0 text-faint" />
        <span className="min-w-0 truncate">{v.venue}</span>
      </div>

      {quiet ? (
        <div className="mt-[18px] flex items-center gap-3 rounded-[14px] border border-line2 bg-bg px-[15px] py-[13px]">
          <span className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-[12px] border border-line bg-elev2 text-acc">
            <Icon name="clock" size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-body text-[14.5px] font-bold text-text">
              {v.daysUntil <= 1 ? 'Volgende event morgen' : `Volgende event over ${v.daysUntil} dagen`}
            </div>
            <div className="mt-px text-[12.5px] text-faint">
              {v.registered} aangemeld · lijst {v.locked ? 'vergrendeld' : 'nog open'}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-5 flex items-end gap-3">
            <div className="flex items-baseline gap-2">
              <span
                className={cn(
                  'font-display text-[46px] font-extrabold leading-[0.9] tracking-[-0.03em]',
                  live ? 'text-text' : 'text-dim'
                )}
              >
                {v.inside}
              </span>
              <span className="font-display text-[19px] font-bold text-faint">/ {v.registered}</span>
            </div>
            <span className="mb-1 font-body text-[12.5px] font-bold uppercase tracking-[0.03em] text-faint">
              binnen · aangemeld
            </span>
            {live && v.walking > 0 && (
              <span className="mb-1 ml-auto inline-flex items-center gap-[5px] whitespace-nowrap font-body text-[12.5px] font-bold text-acc-soft">
                <Icon name="user" size={13} className="text-acc-soft" />
                {v.walking} onderweg
              </span>
            )}
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.07]">
            <div className="h-full rounded-full bg-acc" style={{ width: `${Math.max(v.attendancePct, 2)}%` }} />
          </div>
          <div className="mt-[7px] text-[12px] text-faint">
            {v.attendancePct}% opkomst{live ? '' : ' — deur nog niet open'}
          </div>
          {v.scenario === 'pre' && showDoor && (
            <div className="mt-4">
              <Btn kind="primary" full icon="door" onClick={onDoor}>
                Open de deur
              </Btn>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── KPI tile (a button when it drills in, a plain card otherwise) ─────────────
function Kpi({
  icon,
  label,
  value,
  sub,
  badge,
  accent,
  onClick,
}: {
  icon: IconName;
  label: string;
  value: string | number;
  sub?: string;
  badge?: number;
  accent?: boolean;
  onClick?: () => void;
}): JSX.Element {
  const className = cn(
    'relative flex min-w-0 flex-1 flex-col rounded-[16px] border px-[14px] pb-[13px] pt-[14px] text-left',
    accent ? 'border-transparent bg-acc-dim' : 'border-line bg-elev',
    onClick && cn('cursor-pointer', press)
  );
  const inner = (
    <>
      <div className="flex items-center justify-between">
        <span className={accent ? 'text-acc' : 'text-faint'}>
          <Icon name={icon} size={18} />
        </span>
        {badge != null && badge > 0 && (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-acc px-1.5 font-body text-[11.5px] font-extrabold text-on-acc">
            {badge}
          </span>
        )}
      </div>
      <div className="mt-[14px] font-display text-[30px] font-extrabold leading-none tracking-[-0.03em] text-text">
        {value}
      </div>
      <div className="mt-[5px] font-body text-[12px] font-bold uppercase tracking-[0.03em] text-faint">{label}</div>
      {sub && <div className={cn('mt-[3px] text-[11.5px]', accent ? 'text-acc-soft' : 'text-faint')}>{sub}</div>}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={className}>
      {inner}
    </button>
  ) : (
    <div className={className}>{inner}</div>
  );
}

// ── Quick action ──────────────────────────────────────────────────────────────
function QuickAction({
  icon,
  label,
  badge,
  primary,
  onClick,
}: {
  icon: IconName;
  label: string;
  badge?: number;
  primary?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative flex min-h-[44px] min-w-0 flex-1 flex-col items-center gap-[9px] rounded-[16px] border px-2 py-4 font-display text-[13px] font-bold tracking-[-0.01em]',
        primary ? 'border-transparent bg-acc text-on-acc' : 'border-line bg-elev text-text',
        press
      )}
    >
      {badge != null && badge > 0 && (
        <span className="absolute right-3 top-[10px] inline-flex h-[19px] min-w-[19px] items-center justify-center rounded-full border-2 border-bg bg-acc px-[5px] font-body text-[11px] font-extrabold text-on-acc">
          {badge}
        </span>
      )}
      <Icon name={icon} size={23} sw={2} />
      {label}
    </button>
  );
}

// ── Mini activity feed (only mounted for admin/finance at AAL2) ───────────────
function ActivityMini({ eventId, onAudit }: { eventId: string; onAudit: () => void }): JSX.Element {
  // Scoped to the featured event + polled on the home's 10s cadence (matches the
  // KPIs). The full audit screen opens pre-filtered to the same event via onAudit.
  const feed = usePoAuditFeed({ action: 'all', eventId, limit: 5 }, { enabled: true, refetchInterval: 10_000 });
  const shown = (feed.data ?? []).slice(0, 4);
  return (
    <div>
      <div className="mb-2 flex items-center pl-0.5">
        <Label>Laatste activiteit</Label>
        <button
          type="button"
          onClick={onAudit}
          className={cn('ml-auto inline-flex min-h-[44px] items-center gap-[5px] px-1 font-body text-[13px] font-bold text-acc', press)}
        >
          Audit log
          <Icon name="chev" size={15} className="text-acc" />
        </button>
      </div>
      <div className="rounded-[18px] border border-line bg-elev px-[15px]">
        {feed.isLoading ? (
          <div className="py-[18px] text-center text-[13px] text-faint">Laden…</div>
        ) : shown.length === 0 ? (
          <div className="py-[18px] text-center text-[13px] text-faint">Nog niets gelogd.</div>
        ) : (
          shown.map((l, i) => {
            const meta = auditActionMeta(l.action);
            const door = isDoorDevice(l.device);
            return (
              <div
                key={l.id}
                className={cn('flex items-center gap-3 py-3', i < shown.length - 1 && 'border-b border-line2')}
              >
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border',
                    door ? 'border-transparent bg-acc-dim text-acc' : 'border-line bg-elev2 text-faint'
                  )}
                >
                  <Icon name={meta.icon} size={15} sw={2.1} />
                </span>
                <span className="min-w-0 flex-1 text-[13.5px] leading-[1.35] text-dim">
                  <b className="font-bold text-text">{l.actor}</b> {l.text}
                </span>
                <span className="shrink-0 font-display text-[12px] font-semibold text-faint">{formatWhen(l.iso)}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Event switcher (when >1 event is live/upcoming) ───────────────────────────
function EventPickerSheet({
  events,
  selectedId,
  onPick,
  onClose,
}: {
  events: HomeEvent[];
  selectedId: string;
  onPick: (id: string) => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <Sheet onClose={onClose} center={false}>
      <Label className="mb-3">Kies event</Label>
      <div className="flex flex-col gap-1.5">
        {events.map((e) => {
          const live = e.status === 'live';
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => {
                onPick(e.id);
                onClose();
              }}
              className={cn(
                'flex min-h-[44px] items-center gap-3 rounded-[13px] border px-[14px] py-[12px] text-left',
                press,
                e.id === selectedId ? 'border-transparent bg-acc-dim' : 'border-line bg-elev'
              )}
            >
              <span className={cn('h-2 w-2 shrink-0 rounded-full', live ? 'bg-acc' : 'bg-ghost')} />
              <span className="min-w-0 flex-1 truncate font-display text-[14.5px] font-bold text-text">{e.name}</span>
              <span className="shrink-0 text-[12.5px] text-faint">{live ? 'Live' : formatDay(e.starts_at)}</span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

// ── Personal-quota sheet (event_quota_status for the caller) ──────────────────
function QuotaSheet({ v, onClose, onAdd }: { v: PoHomeView; onClose: () => void; onAdd: () => void }): JSX.Element {
  const pct = v.quotaTotal > 0 ? Math.min(100, Math.round((v.quotaConsumed / v.quotaTotal) * 100)) : 0;
  return (
    <Sheet onClose={onClose} center={false}>
      <Label className="mb-3">Jouw quota op dit event</Label>
      {v.quotaExempt ? (
        <div className="rounded-[16px] border border-line bg-elev p-4">
          <div className="font-display text-[20px] font-extrabold text-acc">Geen limiet</div>
          <div className="mt-1 text-[13px] leading-[1.5] text-faint">
            Als beheerder of organisator tellen jouw toevoegingen niet tegen een persoonlijk quotum.
          </div>
        </div>
      ) : (
        <>
          <div className="rounded-[16px] border border-line2 bg-bg p-[18px]">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-[40px] font-extrabold leading-[0.9] tracking-[-0.03em] text-acc">
                {v.quotaFree ?? 0}
              </span>
              <span className="font-display text-[17px] font-bold text-faint">
                {v.quotaFree === 1 ? 'plek vrij' : 'plekken vrij'}
              </span>
            </div>
            <div className="mt-[14px] h-2 overflow-hidden rounded-full bg-white/[0.07]">
              <div className="h-full rounded-full bg-acc" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-2 text-[12.5px] text-faint">
              {v.quotaConsumed} van {v.quotaTotal} gebruikt
            </div>
          </div>
          <div className="mt-3 text-[12.5px] leading-[1.5] text-faint">
            Dit is jouw persoonlijke quotum voor dit event (#22/#31). De database bewaakt de harde grens.
          </div>
        </>
      )}
      <div className="mt-4 flex flex-col gap-2">
        <Btn kind="primary" full icon="plus" onClick={onAdd}>
          Nieuwe gast toevoegen
        </Btn>
        <Btn kind="ghost" full onClick={onClose}>
          Sluiten
        </Btn>
      </div>
    </Sheet>
  );
}

// ── Empty state (no live/upcoming event at this venue) ────────────────────────
function NoEvent({ isAdmin, onNew }: { isAdmin: boolean; onNew: () => void }): JSX.Element {
  return (
    <div className="rounded-[22px] border border-line bg-elev p-6 text-center">
      <span className="mx-auto mb-3 flex h-[52px] w-[52px] items-center justify-center rounded-[16px] border border-line bg-elev2 text-acc">
        <Icon name="cal" size={24} />
      </span>
      <div className="font-display text-[18px] font-extrabold text-text">Nog geen event gepland</div>
      <div className="mx-auto mt-1.5 max-w-[260px] text-[13px] leading-[1.5] text-faint">
        Zodra er een event live of komend is, zie je hier de opkomst, openstaande aanvragen en je resterende
        plekken.
      </div>
      {isAdmin && (
        <Btn kind="primary" full icon="cal" className="mt-4" onClick={onNew}>
          Nieuw event
        </Btn>
      )}
    </div>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────
export function Home(): JSX.Element {
  const nav = useNav();
  const { roles, venueName } = usePoIdentity();
  const events = usePoHomeEvents();
  const profile = usePoProfile();
  const aal = usePoAal2();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quotaOpen, setQuotaOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);

  const showDoor = canWorkDoor(roles);
  const canAudit = venueCapabilities(roles).viewAudit;
  const userName = profile.data?.name ?? '';
  const firstName = profile.data?.firstName ?? '';

  const list = events.data?.events ?? [];
  // Honour an explicit pick while it's still a candidate, else the default pick.
  const effectiveId =
    (selectedId && list.some((e) => e.id === selectedId) ? selectedId : null) ??
    events.data?.defaultId ??
    null;
  const selected = list.find((e) => e.id === effectiveId) ?? null;

  const stats = usePoHomeStats(effectiveId);
  const view = selected
    ? toPoHome(selected, stats.data?.openRequests ?? 0, stats.data?.quota ?? null, Date.now())
    : null;

  // Spin the icon only on a manual tap — the 10s auto-poll refetches silently in
  // the background (React Query keeps the previous data, so numbers update in place).
  const onRefresh = (): void => {
    setManualRefreshing(true);
    void Promise.all([events.refetch(), effectiveId ? stats.refetch() : Promise.resolve()]).finally(() =>
      setManualRefreshing(false)
    );
  };

  return (
    <div className={col}>
      <TopBar
        venueName={venueName ?? 'Venue'}
        userName={userName}
        firstName={firstName}
        onVenue={() => nav.push('venueswitch')}
        onRefresh={onRefresh}
        refreshing={manualRefreshing}
      />
      <Scroll pad={18} bottom={28} className="flex flex-col gap-[18px]">
        <PendingInvitesBanner />
        {events.isLoading ? (
          <Empty text="Overzicht laden…" />
        ) : events.isError ? (
          <Empty text="Kon het overzicht niet laden. Probeer het later opnieuw." />
        ) : !view ? (
          <NoEvent isAdmin={roles.includes('admin')} onNew={() => nav.push('eventedit', { isNew: true })} />
        ) : (
          <>
            <EventCard
              v={view}
              showDoor={showDoor}
              canSwitch={list.length > 1}
              onSwitch={() => setPickerOpen(true)}
              onDoor={() => nav.setTab('deur')}
            />

            <div className="flex gap-[11px]">
              <Kpi
                icon="user"
                label="Aanwezig"
                value={view.inside}
                sub={view.scenario === 'live' ? `${view.walking} onderweg` : 'deur dicht'}
                accent={view.scenario === 'live'}
              />
              <Kpi
                icon="inbox"
                label="Aanvragen"
                value={view.requests}
                sub="open"
                badge={view.requests}
                onClick={() => nav.push('aanvragen', { id: view.id })}
              />
              <Kpi
                icon="ticket"
                label="Quota vrij"
                value={!view.quotaKnown ? '—' : view.quotaExempt ? '∞' : view.quotaFree ?? 0}
                sub={!view.quotaKnown ? 'onbekend' : view.quotaExempt ? 'geen limiet' : `van ${view.quotaTotal}`}
                onClick={view.quotaKnown ? () => setQuotaOpen(true) : undefined}
              />
            </div>

            <div>
              <Label className="mb-3 pl-0.5">Snelle acties</Label>
              <div className="flex gap-[11px]">
                <QuickAction icon="plus" label="Nieuwe gast" primary onClick={() => nav.push('quickadd', { id: view.id })} />
                {showDoor && <QuickAction icon="door" label="Open deur" onClick={() => nav.setTab('deur')} />}
                <QuickAction icon="inbox" label="Aanvragen" badge={view.requests} onClick={() => nav.push('aanvragen', { id: view.id })} />
              </div>
            </div>

            {canAudit && aal.isAal2 && (
              <ActivityMini eventId={view.id} onAudit={() => nav.push('audit', { id: view.id })} />
            )}
          </>
        )}
      </Scroll>

      {quotaOpen && view && (
        <QuotaSheet
          v={view}
          onClose={() => setQuotaOpen(false)}
          onAdd={() => {
            setQuotaOpen(false);
            nav.push('quickadd', { id: view.id });
          }}
        />
      )}
      {pickerOpen && view && (
        <EventPickerSheet events={list} selectedId={view.id} onPick={setSelectedId} onClose={() => setPickerOpen(false)} />
      )}
    </div>
  );
}
