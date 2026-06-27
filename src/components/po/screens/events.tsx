'use client';

/** Events tab + event detail, event CRUD, tier/alias beheer, past-event recap. */
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import type { PoEvent } from '@/lib/po/types';
import {
  usePoCrew,
  usePoAssignableCrew,
  usePoEvent,
  usePoEventDetail,
  usePoEventForEdit,
  usePoEventRecap,
  usePoEvents,
  usePoTemplates,
  usePoTiers,
  usePoVenueSettings,
  usePoEventActivity,
  usePoAuditFeed,
} from '@/features/po/hooks';
import type { PoCrewMember } from '@/features/po/queries';
import type { TierStat, UserAddition } from '@/features/stats/data';
import type { AuditLine } from '@/features/audit/translate';
import { formatWhen } from '@/features/audit/translate';
import { venueCapabilities } from '@/features/venues/access';
import { auditActionMeta } from '@/features/po/audit-presenter';
import {
  usePoAssignCrew,
  usePoInviteExternalCrew,
  usePoSetCrewQuota,
  usePoRemoveCrew,
  usePoSetCancelled,
  usePoCreateEvent,
  usePoCreateEventFromTemplate,
  usePoCreateTemplateFromEvent,
  usePoCreateTier,
  usePoSetAllowUncheck,
  usePoSetAutoLock,
  usePoSetLandingActive,
  usePoSetListLock,
  usePoUpdateEvent,
  usePoUpdateTier,
} from '@/features/po/mutations';
import { resolveAllowUncheck } from '@/features/events/allow-uncheck';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { canWorkDoor } from '@/features/auth/roles';
import { isoToLocalInput, localInputToIso } from '@/features/events/datetime';
import { formatClock } from '@/features/stats/format';
import { useNav } from '../context';
import { Icon } from '../icon';
import { Avatar, Btn, Empty, Field, IconBtn, Label, MiniChip, Note, RoleChip, Scroll, ToggleRow, Top } from '../kit';
import { BottomBar, Sheet } from '../shell';

const cardPress = 'transition-[border-color,transform] hover:border-white/[0.24] active:scale-[0.99]';
const press = 'transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]';
const col = 'flex h-full flex-col';

// ── helpers ───────────────────────────────────────────────────────────────────
function Stat({ v, l, acc, big }: { v: number; l: string; acc?: boolean; big?: boolean }): JSX.Element {
  return (
    <div className="rounded-[18px] border border-line bg-elev p-4">
      <div className={cn('font-display font-extrabold leading-none', big ? 'text-[38px]' : 'text-[28px]', acc ? 'text-acc' : 'text-text')}>{v}</div>
      <div className="mt-1 text-[13px] text-dim">{l}</div>
    </div>
  );
}

/** Full-screen loading / empty / error state with a back header (kit-only). */
function ScreenState({ onBack, title, text }: { onBack: () => void; title: string; text: string }): JSX.Element {
  return (
    <div className={col}>
      <Top onBack={onBack} title={title} />
      <Scroll bottom={28}>
        <Empty text={text} />
      </Scroll>
    </div>
  );
}

// ── EVENTS (tab) ──────────────────────────────────────────────────────────────
export function Events(): JSX.Element {
  const nav = useNav();
  const [when, setWhen] = useState<'upcoming' | 'past'>('upcoming');
  const { data, isLoading, isError } = usePoEvents();
  const evs = (data ?? []).filter((e) => e.when === when);
  const months = [...new Set(evs.map((e) => e.month))];
  return (
    <div className={col}>
      <Top big title={t.events.title} onBack={nav.canGoBack ? nav.back : undefined} right={<IconBtn name="search" />} />
      <div className="flex flex-none items-center gap-2 px-5 pb-[14px]">
        {([['upcoming', t.events.tabUpcoming], ['past', t.events.tabPast]] as const).map(([k, l]) => (
          <button
            key={k}
            type="button"
            onClick={() => setWhen(k)}
            className={cn(
              'cursor-pointer rounded-full border px-4 py-2 font-display text-[13.5px] font-bold transition-[filter] hover:brightness-[1.07]',
              when === k ? 'border-transparent bg-text text-bg' : 'border-line bg-transparent text-dim',
            )}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="flex flex-none gap-2 px-5 pb-[14px]">
        <Btn sm kind="primary" icon="plus" onClick={() => nav.push('quickadd')}>
          {t.events.addGuest}
        </Btn>
        <Btn sm kind="ghost" icon="cal" onClick={() => nav.push('eventedit', { isNew: true })}>
          {t.events.newEvent}
        </Btn>
      </div>
      <Scroll bottom={100}>
        {isLoading ? (
          <Empty text={t.events.loadingEvents} />
        ) : isError ? (
          <Empty text={t.events.loadEventsError} />
        ) : evs.length === 0 ? (
          <Empty text={when === 'upcoming' ? t.events.emptyUpcoming : t.events.emptyPast} />
        ) : (
          months.map((m) => (
            <div key={m} className="mb-2">
              <Label className="mx-0.5 mb-[10px] mt-3">{m}</Label>
              <div className="flex flex-col gap-[10px] lg:grid lg:grid-cols-2 xl:grid-cols-3">
                {evs
                  .filter((e) => e.month === m)
                  .map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => nav.push(e.when === 'past' ? 'pastevent' : 'event', { id: e.id })}
                      className={cn('flex items-center gap-[14px] rounded-[18px] border border-line bg-elev p-[14px] text-left', cardPress)}
                    >
                      <div className="w-[52px] shrink-0 text-center">
                        <div className={cn('font-display text-[24px] font-extrabold leading-none', e.accent ? 'text-acc' : 'text-text')}>{e.date}</div>
                        <div className="mt-0.5 text-[11px] font-bold tracking-[0.05em] text-faint">{e.mon}</div>
                      </div>
                      <div className="w-px self-stretch bg-line2" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="overflow-hidden text-ellipsis whitespace-nowrap font-display text-[17px] font-bold text-text">{e.name}</div>
                          {e.cancelled ? (
                            <span className="shrink-0 rounded-full bg-[#E89AC0]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#E89AC0]">
                              {t.events.cancelledBadge}
                            </span>
                          ) : e.phase === 'live' ? (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-acc-dim px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-acc">
                              <span className="h-1.5 w-1.5 rounded-full bg-acc" />
                              {t.events.liveBadge}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-[3px] flex items-center gap-1.5 text-[13px] text-faint">
                          <Icon name="clock" size={13} stroke="rgba(255,255,255,0.40)" />
                          {fmt(t.events.cardDoors, { time: e.time, venue: e.venue })}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-display text-[16px] font-bold text-text">{e.guests}</div>
                        <div className="text-[11px] text-faint">{when === 'past' ? (e.guests > 0 ? Math.round((e.inside / e.guests) * 100) : 0) + t.events.cardTurnoutSuffix : t.events.cardGuests}</div>
                      </div>
                    </button>
                  ))}
              </div>
            </div>
          ))
        )}
      </Scroll>
    </div>
  );
}

// ── EVENT detail (pushed) ───────────────────────────────────────────────────────
export function EventView({ id }: { id?: string }): JSX.Element {
  const nav = useNav();
  const { event, isLoading, isError, notFound } = usePoEvent(id ?? '');
  const { data: detail } = usePoEventDetail(id ?? '');
  const { roles } = usePoIdentity();
  const isAdmin = roles.includes('admin');
  // Door-only affordances: a non-door role (staff) can't work the door or read
  // check_ins (#17), so hide the Check-in button (its tab is gated too) and the
  // "Laatst binnen" list unless there's data they're allowed to see.
  const showDoor = canWorkDoor(roles);
  // External crew count for the admin-only crew row below; only admins can manage
  // it, so a non-admin passes an empty id and the hook stays disabled (no fetch).
  const crewQ = usePoCrew(isAdmin ? id ?? '' : '');

  if (isLoading) return <ScreenState onBack={nav.back} title={t.events.detailTitle} text={t.events.loading} />;
  if (isError || notFound || !event) {
    return <ScreenState onBack={nav.back} title={t.events.detailTitle} text={t.events.eventUnavailable} />;
  }

  const ev = event;
  const onweg = Math.max(0, ev.guests - ev.inside);
  const pct = ev.guests > 0 ? ev.inside / ev.guests : 0;
  const recent = detail?.recent ?? [];
  const openRequests = detail?.openRequests ?? 0;
  // Desktop (S3.3): the headline numbers/actions go left, the "needs attention"
  // + "laatst binnen" feed go right. When there's no secondary content the left
  // column reads as a normal centered column instead of a wide thin strip.
  const hasSecondary = openRequests > 0 || showDoor || recent.length > 0;

  return (
    <div className={col}>
      {/* Feedback Joeri: the "dots" icon was unreadable — use a clear settings/edit cog. */}
      <Top onBack={nav.back} title={ev.name} sub={`${ev.venue} · ${ev.date} ${ev.mon}`} right={<IconBtn name="cog" onClick={() => nav.push('eventedit', { id: ev.id })} />} />
      <Scroll bottom={28}>
        <div className={cn(hasSecondary && 'lg:grid lg:grid-cols-2 lg:gap-5 lg:items-start')}>
          <div className={cn(!hasSecondary && 'lg:mx-auto lg:max-w-[680px]')}>
            <div className="mb-3 grid grid-cols-2 gap-[10px]">
              <Stat big v={onweg} l={t.events.statOnTheWay} />
              <Stat big v={ev.inside} l={t.events.statInside} acc />
            </div>
            <div className="mb-3 rounded-[18px] border border-line bg-elev p-4">
              <div className="mb-[9px] flex justify-between">
                <Label>{t.events.turnout}</Label>
                <span className="font-display font-bold text-acc">{Math.round(pct * 100)}%</span>
              </div>
              <div className="h-[10px] overflow-hidden rounded-[6px] bg-elev2">
                <div className="h-full rounded-[6px] bg-acc" style={{ width: pct * 100 + '%' }} />
              </div>
              <div className="mt-[9px] text-[12.5px] text-faint">{fmt(t.events.peopleOnList, { n: ev.guests })}</div>
            </div>
            <div className="mb-4 flex gap-[10px] lg:mb-0">
              {showDoor && (
                <Btn kind="primary" full icon="user" onClick={() => nav.openDoor(ev.id)}>
                  {t.events.checkIn}
                </Btn>
              )}
              <Btn kind="dark" full icon="users" onClick={() => nav.push('lijst', { id: ev.id })}>
                {t.events.guestList}
              </Btn>
            </div>
            {/* External crew — admin-only quick entry straight from the event. */}
            {isAdmin && (
              <button
                type="button"
                onClick={() => nav.push('crew', { id: ev.id })}
                className={cn('mt-3 flex w-full items-center gap-[12px] rounded-[16px] border border-line bg-elev p-[13px] text-left lg:mt-4', cardPress)}
              >
                <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] border border-line bg-elev2 text-acc">
                  <Icon name="users" size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-body text-[15px] font-semibold text-text">{t.events.crew.rowTitle}</span>
                  <span className="mt-px block text-[12.5px] text-faint">
                    {(crewQ.data?.length ?? 0) === 0
                      ? t.events.crew.rowEmpty
                      : fmt(crewQ.data?.length === 1 ? t.events.crew.rowCountOne : t.events.crew.rowCountMany, {
                          n: crewQ.data?.length ?? 0,
                        })}
                  </span>
                </span>
                <Icon name="chev" size={18} className="text-ghost" />
              </button>
            )}
          </div>
          {hasSecondary && (
            <div className="mt-4 lg:mt-0">
              {openRequests > 0 && (
                <>
                  <Label className="mb-[10px]">{t.events.needsAttention}</Label>
                  <div className="mb-[18px] flex flex-col gap-[9px]">
                    <button
                      type="button"
                      onClick={() => nav.push('aanvragen', { id: ev.id })}
                      className={cn('flex w-full gap-[12px] rounded-[14px] border bg-elev p-[13px] text-left', cardPress)}
                      style={{ borderColor: 'rgba(181,166,255,0.4)' }}
                    >
                      <span className="mt-px text-acc-soft">
                        <Icon name="bell" size={19} />
                      </span>
                      <div className="flex-1">
                        <div className="font-body text-[14px] font-bold text-text">
                          {openRequests === 1
                            ? fmt(t.events.openRequest, { n: openRequests })
                            : fmt(t.events.openRequests, { n: openRequests })}
                        </div>
                        <div className="mt-0.5 text-[12.5px] leading-[1.4] text-faint">{t.events.requestsSub}</div>
                      </div>
                      <span className="self-center text-acc">
                        <Icon name="chev" size={20} />
                      </span>
                    </button>
                  </div>
                </>
              )}
              {(showDoor || recent.length > 0) && (
                <>
                  <Label className="mb-[10px]">{t.events.justIn}</Label>
                  {recent.length === 0 ? (
                    <Empty text={t.events.noOneInside} />
                  ) : (
                    <div className="flex flex-col">
                      {recent.map((g) => (
                        <div key={g.guestId} className="flex items-center gap-[12px] border-b border-line2 py-[10px]">
                          <Avatar name={g.name} size={38} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[14.5px] font-semibold text-text">
                              {g.name}
                              {g.plus > 0 && <span className="text-faint"> +{g.plus}</span>}
                            </div>
                            <div className="mt-0.5 truncate text-[12px] text-faint">{fmt(t.events.by, { by: g.by })}</div>
                          </div>
                          <span className="font-display text-[13px] font-bold text-acc">{formatClock(g.at)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        {id && <EventActivitySection eventId={id} isLive />}
      </Scroll>
    </div>
  );
}

// ── EVENT edit / create (pushed) ─────────────────────────────────────────────────
/** ISO instant → [date, time] local strings for the date/time inputs. */
function splitLocal(iso: string | null): [string, string] {
  const [d = '', t = ''] = isoToLocalInput(iso).split('T');
  return [d, t];
}

/** A blank/template selector chip for the create-from-template picker (86exyp8gn). */
function TemplateChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-[13px] py-[7px] font-display text-[12.5px] font-bold transition-colors',
        active ? 'border-acc bg-acc-dim text-acc' : 'border-line text-dim hover:brightness-110',
      )}
    >
      {label}
    </button>
  );
}

/** Save an existing event's setup (tiers + capacity + settings) as a reusable template. */
function SaveAsTemplate({ eventId }: { eventId: string }): JSX.Element {
  const createTpl = usePoCreateTemplateFromEvent();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (!name.trim() || createTpl.isPending) return;
    setErr(null);
    setMsg(null);
    try {
      await createTpl.mutateAsync({ eventId, name: name.trim() });
      setMsg(t.events.saveTemplateDone);
      setName('');
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.events.saveTemplateError);
    }
  };

  return (
    <div className="mt-[18px]">
      <Label className="mb-[10px]">{t.events.saveTemplateLabel}</Label>
      {open ? (
        <div className="rounded-[16px] border border-acc bg-elev p-4">
          <p className="mb-2.5 text-[12.5px] leading-[1.5] text-faint">{t.events.saveTemplateHint}</p>
          <Field
            placeholder={t.events.saveTemplatePlaceholder}
            value={name}
            onChange={setName}
            autoFocus
            className="mb-3"
          />
          <div className="flex gap-2">
            <Btn
              kind="primary"
              sm
              icon="check"
              onClick={() => void submit()}
              disabled={!name.trim() || createTpl.isPending}
              className={!name.trim() || createTpl.isPending ? 'opacity-50' : ''}
            >
              {createTpl.isPending ? t.events.saving : t.events.saveTemplateConfirm}
            </Btn>
            <Btn
              kind="ghost"
              sm
              onClick={() => {
                setOpen(false);
                setName('');
                setErr(null);
              }}
            >
              {t.events.saveTemplateCancel}
            </Btn>
          </div>
          {err && <p className="mt-2 text-[12.5px] text-[#E89AC0]">{err}</p>}
        </div>
      ) : (
        <>
          <Btn
            kind="dark"
            full
            icon="grid"
            onClick={() => {
              setOpen(true);
              setMsg(null);
            }}
          >
            {t.events.saveTemplateCta}
          </Btn>
          {msg && <p className="mt-2 text-[12.5px] text-acc-soft">{msg}</p>}
        </>
      )}
    </div>
  );
}

export function EventEdit({ id, isNew }: { id?: string; isNew?: boolean }): JSX.Element {
  const nav = useNav();
  const { venueId, venueName, roles } = usePoIdentity();
  const isAdmin = roles.includes('admin');
  const editId = isNew ? '' : id ?? '';
  const { data: ev, isLoading, isError, canManage } = usePoEventForEdit(editId);

  const createEvent = usePoCreateEvent();
  const createFromTemplate = usePoCreateEventFromTemplate();
  const templates = usePoTemplates();
  const updateEvent = usePoUpdateEvent(editId);
  const setCancelled = usePoSetCancelled(editId);
  const setLandingActive = usePoSetLandingActive(editId);
  const setListLock = usePoSetListLock(editId);
  const setAutoLock = usePoSetAutoLock(editId);
  const setAllowUncheck = usePoSetAllowUncheck(editId);

  const [name, setName] = useState('');
  // Create-from-template (86exyp8gn): null = blank event (the existing path).
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [dateStr, setDateStr] = useState('');
  const [timeStr, setTimeStr] = useState('');
  const [endDateStr, setEndDateStr] = useState('');
  const [endTimeStr, setEndTimeStr] = useState('');
  const [landingOn, setLandingOn] = useState(false);
  const [autoOn, setAutoOn] = useState(false);
  const [autoDate, setAutoDate] = useState('');
  const [autoTime, setAutoTime] = useState('');
  const [locked, setLocked] = useState(false);
  // Per-event "uitchecken toestaan" override: true/false force it, null inherits
  // the venue default (#3 / S1.1). An immediate operational control like the lock.
  const [uncheckOverride, setUncheckOverride] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Hydrate the form once the event identity loads / changes (edit mode only).
  useEffect(() => {
    if (!ev) return;
    setName(ev.name);
    const [d, t] = splitLocal(ev.startsAt);
    setDateStr(d);
    setTimeStr(t);
    const [ed, et] = splitLocal(ev.endsAt);
    setEndDateStr(ed);
    setEndTimeStr(et);
    setLandingOn(ev.landingActive);
    setLocked(ev.listLocked);
    setUncheckOverride(ev.allowUncheckOverride);
    const [ad, at] = splitLocal(ev.autoLockAt);
    setAutoOn(!!ev.autoLockAt);
    setAutoDate(ad);
    setAutoTime(at);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ev?.id]);

  if (!isNew && isLoading) return <ScreenState onBack={nav.back} title={t.events.editTitle} text={t.events.loading} />;
  if (!isNew && (isError || !ev)) {
    return <ScreenState onBack={nav.back} title={t.events.editTitle} text={t.events.eventUnavailable} />;
  }

  const writable = isNew ? isAdmin : canManage;
  const venueLabel = isNew ? venueName ?? '' : ev?.venueName ?? '';
  const saving = createEvent.isPending || createFromTemplate.isPending || updateEvent.isPending;
  // Uitchecken toestaan: effective = override ?? venue default ?? true (#3 / S1.1).
  const venueDefaultUncheck = ev?.venueAllowUncheck ?? true;
  const effectiveUncheck = resolveAllowUncheck(uncheckOverride, venueDefaultUncheck);

  // Name + start (+ landing/auto-lock as config) commit together on save; list-lock
  // and status are immediate operational controls (mirrors the desktop split).
  const save = async (): Promise<void> => {
    setErr(null);
    if (!name.trim()) {
      setErr(t.events.errName);
      return;
    }
    const startsAt = localInputToIso(`${dateStr}T${timeStr}`);
    if (!startsAt) {
      setErr(t.events.errDateTime);
      return;
    }
    // End time is optional, but if either end field is filled both must be, and the
    // end must be after the start — mirror the DB CHECK so the user gets a clear
    // message instead of the generic save failure (the date-save bug).
    const endsAt = endDateStr && endTimeStr ? localInputToIso(`${endDateStr}T${endTimeStr}`) : null;
    if ((endDateStr || endTimeStr) && !endsAt) {
      setErr(t.events.errEndDateTime);
      return;
    }
    if (endsAt && endsAt <= startsAt) {
      setErr(t.events.errStartAfterEnd);
      return;
    }
    const autoIso = autoOn ? localInputToIso(`${autoDate}T${autoTime}`) : null;
    if (autoOn && !autoIso) {
      setErr(t.events.errCloseDateTime);
      return;
    }
    try {
      if (isNew) {
        if (!venueId) {
          setErr(t.events.errNoVenue);
          return;
        }
        if (templateId) {
          await createFromTemplate.mutateAsync({ templateId, name: name.trim(), startsAt, endsAt });
        } else {
          await createEvent.mutateAsync({ venueId, name: name.trim(), startsAt, endsAt, landingActive: landingOn });
        }
      } else {
        await updateEvent.mutateAsync({ eventId: editId, name: name.trim(), startsAt, endsAt });
        if (ev && landingOn !== ev.landingActive) {
          await setLandingActive.mutateAsync({ eventId: editId, active: landingOn });
        }
        if (autoIso !== (ev?.autoLockAt ?? null)) {
          await setAutoLock.mutateAsync({ eventId: editId, autoLockAt: autoIso });
        }
      }
      nav.back();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.events.errSaveFailed);
    }
  };

  const toggleLock = async (v: boolean): Promise<void> => {
    setLocked(v);
    setErr(null);
    try {
      await setListLock.mutateAsync({ eventId: editId, locked: v });
    } catch (e) {
      setLocked(!v);
      setErr(e instanceof Error ? e.message : t.events.errLockFailed);
    }
  };

  // Set (true/false) or clear (null = follow company default) the uncheck override.
  const toggleUncheck = async (next: boolean | null): Promise<void> => {
    const prev = uncheckOverride;
    setUncheckOverride(next);
    setErr(null);
    try {
      await setAllowUncheck.mutateAsync({ eventId: editId, allowUncheck: next });
    } catch (e) {
      setUncheckOverride(prev);
      setErr(e instanceof Error ? e.message : t.events.errUncheckFailed);
    }
  };

  const toggleCancel = async (next: boolean): Promise<void> => {
    setErr(null);
    try {
      await setCancelled.mutateAsync({ eventId: editId, cancelled: next });
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.events.errCancelFailed);
    }
  };

  const copyLink = async (): Promise<void> => {
    if (!ev?.landingSlug) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/e/${ev.landingSlug}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked (rare in webviews) — silently ignore; the slug is visible.
    }
  };

  return (
    <div className={col}>
      <Top onBack={nav.back} title={isNew ? t.events.newEvent : t.events.editTitle} sub={isNew ? undefined : ev?.name} />
      <Scroll bottom={120}>
        {err && <div className="mb-3 text-[13px] font-semibold text-[#E89AC0]">{err}</div>}
        {!isNew && ev?.cancelledAt && (
          <div
            className="mb-3 rounded-[12px] border px-3 py-2.5 text-[13px] font-semibold text-[#E89AC0]"
            style={{ borderColor: 'rgba(232,154,192,0.4)' }}
          >
            {t.events.cancelledBanner}
          </div>
        )}
        {!writable && (
          <Note icon="shield">
            {isNew ? t.events.noteAdminsOnly : t.events.noteViewOnly}
          </Note>
        )}

        {isNew && isAdmin && (templates.data?.length ?? 0) > 0 && (
          <>
            <Label className="mb-2">{t.events.fieldTemplate}</Label>
            <div className="mb-[14px] flex flex-wrap gap-2">
              <TemplateChip label={t.events.templateBlank} active={!templateId} onClick={() => setTemplateId(null)} />
              {(templates.data ?? []).map((tpl) => (
                <TemplateChip
                  key={tpl.id}
                  label={tpl.name}
                  active={templateId === tpl.id}
                  onClick={() => setTemplateId(tpl.id)}
                />
              ))}
            </div>
            {templateId && (
              <div className="mb-[14px]">
                <Note icon="spark">{t.events.templateNote}</Note>
              </div>
            )}
          </>
        )}

        <Label className="mb-2">{t.events.fieldName}</Label>
        <Field placeholder={t.events.namePlaceholder} value={name} onChange={writable ? setName : undefined} className="mb-[14px]" />

        <Label className="mb-2">{t.events.fieldVenue}</Label>
        <Field icon="building" value={venueLabel} placeholder={t.events.venuePlaceholder} className="mb-[14px]" />

        <div className="mb-[14px] flex gap-[10px]">
          <div className="flex-1">
            <Label className="mb-2">{t.events.fieldDate}</Label>
            <Field icon="cal" type="date" value={dateStr} onChange={writable ? setDateStr : undefined} />
          </div>
          <div className="flex-1">
            <Label className="mb-2">{t.events.fieldDoors}</Label>
            <Field icon="clock" type="time" value={timeStr} onChange={writable ? setTimeStr : undefined} />
          </div>
        </div>

        {/* End time (optional). Drives the Upcoming/Live/Past phase — a night with
            an end stays "Live" until it actually ends, then rolls to "Past". */}
        <div className="mb-[14px] flex gap-[10px]">
          <div className="flex-1">
            <Label className="mb-2">{t.events.fieldEndDate}</Label>
            <Field icon="cal" type="date" value={endDateStr} onChange={writable ? setEndDateStr : undefined} />
          </div>
          <div className="flex-1">
            <Label className="mb-2">{t.events.fieldEnd}</Label>
            <Field icon="clock" type="time" value={endTimeStr} onChange={writable ? setEndTimeStr : undefined} />
          </div>
        </div>

        {!isNew && (
          <button
            type="button"
            onClick={() => nav.push('tiers', { id: editId })}
            className="mb-[14px] flex w-full items-center gap-[13px] rounded-[14px] border border-line bg-elev px-[14px] py-[15px] text-left transition-colors hover:bg-white/[0.03]"
          >
            <span className="flex h-[38px] w-[38px] items-center justify-center rounded-[11px] border border-line bg-elev2 text-acc">
              <Icon name="ticket" size={18} />
            </span>
            <span className="flex-1">
              <span className="block font-body text-[15px] font-semibold text-text">{t.events.tiersRowTitle}</span>
              <span className="mt-px block text-[12.5px] text-faint">{t.events.tiersRowSub}</span>
            </span>
            <Icon name="chev" size={18} className="text-ghost" />
          </button>
        )}

        {/* External crew (event_organizers) — sits beside Tiers as event setup.
            Visible once the event exists; the screen itself gates add/remove to admin. */}
        {!isNew && (
          <button
            type="button"
            onClick={() => nav.push('crew', { id: editId })}
            className="mb-[18px] flex w-full items-center gap-[13px] rounded-[14px] border border-line bg-elev px-[14px] py-[15px] text-left transition-colors hover:bg-white/[0.03]"
          >
            <span className="flex h-[38px] w-[38px] items-center justify-center rounded-[11px] border border-line bg-elev2 text-acc">
              <Icon name="users" size={18} />
            </span>
            <span className="flex-1">
              <span className="block font-body text-[15px] font-semibold text-text">{t.events.crew.rowTitle}</span>
              <span className="mt-px block text-[12.5px] text-faint">{t.events.crew.rowSub}</span>
            </span>
            <Icon name="chev" size={18} className="text-ghost" />
          </button>
        )}

        <Label className="mb-[10px]">{t.events.landingPage}</Label>
        <div className="mb-[18px] rounded-[16px] border border-line bg-elev px-[14px] py-1">
          <ToggleRow
            title={t.events.landingActiveTitle}
            sub={t.events.landingActiveSub}
            on={isNew && templateId ? false : landingOn}
            set={(v) => writable && !(isNew && templateId) && setLandingOn(v)}
            last={!landingOn || isNew}
          />
          {!isNew && landingOn && ev?.landingSlug && (
            <div className="flex items-center gap-[9px] border-t border-line2 pb-[14px] pt-3">
              <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[12.5px] text-dim">/e/{ev.landingSlug}</span>
              <button
                type="button"
                onClick={() => void copyLink()}
                aria-label={t.events.copyLinkAria}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-[10px] border px-3 py-[7px] font-display text-[12.5px] font-bold transition-[filter] hover:brightness-[1.2]',
                  copied ? 'border-acc/40 bg-acc-dim text-acc' : 'border-line text-dim',
                )}
              >
                <Icon name={copied ? 'check' : 'link'} size={15} />
                {copied ? t.events.copyLinkDone : t.events.copyLinkLabel}
              </button>
            </div>
          )}
          {!isNew && landingOn && (
            <div className="border-t border-line2">
              <ToggleRow
                title={t.events.autoCloseTitle}
                sub={autoOn ? t.events.autoCloseOnSub : t.events.autoCloseOffSub}
                on={autoOn}
                set={(v) => writable && setAutoOn(v)}
                last={!autoOn}
              />
              {autoOn && (
                <div className="flex gap-[10px] pb-[14px]">
                  <div className="flex-1">
                    <Label className="mb-2">{t.events.closesOn}</Label>
                    <Field icon="cal" type="date" value={autoDate} onChange={writable ? setAutoDate : undefined} />
                  </div>
                  <div className="flex-1">
                    <Label className="mb-2">{t.events.closesAt}</Label>
                    <Field icon="clock" type="time" value={autoTime} onChange={writable ? setAutoTime : undefined} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {!isNew && (
          <>
            <Label className="mb-[10px]">{t.events.atTheDoor}</Label>
            <Note icon="shield">{t.events.lockListNote}</Note>
            <div className="rounded-[16px] border border-line bg-elev px-[14px] py-1">
              <ToggleRow
                title={t.events.lockListTitle}
                sub={locked ? t.events.lockListOnSub : t.events.lockListOffSub}
                on={locked}
                set={(v) => writable && void toggleLock(v)}
              />
              <ToggleRow
                title={t.events.allowCheckoutTitle}
                sub={
                  uncheckOverride === null
                    ? fmt(t.events.allowCheckoutFollowsSub, {
                        state: venueDefaultUncheck ? t.events.stateOn : t.events.stateOff,
                      })
                    : effectiveUncheck
                      ? t.events.allowCheckoutOnSub
                      : t.events.allowCheckoutOffSub
                }
                on={effectiveUncheck}
                set={(v) => writable && void toggleUncheck(v)}
                last={uncheckOverride === null}
              />
              {uncheckOverride !== null && writable && (
                <button
                  type="button"
                  onClick={() => void toggleUncheck(null)}
                  className="w-full border-t border-line2 py-[11px] text-left font-body text-[12.5px] font-semibold text-faint transition-[filter] hover:brightness-[1.2]"
                >
                  {fmt(t.events.followVenueDefault, {
                    state: venueDefaultUncheck ? t.events.stateOn : t.events.stateOff,
                  })}
                </button>
              )}
            </div>
          </>
        )}
        {!isNew && writable && <SaveAsTemplate eventId={editId} />}

        {!isNew && isAdmin && (
          <>
            <Label className="mb-[10px] mt-[18px]">{t.events.cancelHeading}</Label>
            <div className="rounded-[16px] border border-line bg-elev p-[14px]">
              <div className="mb-2.5 text-[12.5px] leading-[1.4] text-faint">
                {ev?.cancelledAt ? t.events.reinstateSub : t.events.cancelSub}
              </div>
              <Btn
                kind="dark"
                sm
                full
                icon={ev?.cancelledAt ? 'check' : 'close'}
                onClick={() => void toggleCancel(!ev?.cancelledAt)}
                disabled={setCancelled.isPending}
              >
                {ev?.cancelledAt ? t.events.reinstateEvent : t.events.cancelEvent}
              </Btn>
            </div>
          </>
        )}
      </Scroll>
      <BottomBar>
        <Btn
          kind="primary"
          full
          icon="check"
          onClick={() => void save()}
          disabled={!writable || saving}
          className={!writable || saving ? 'opacity-50' : ''}
        >
          {saving ? t.events.saving : isNew ? t.events.createEvent : t.events.saveEvent}
        </Btn>
      </BottomBar>
    </div>
  );
}

// ── TIERS & aliases (pushed) ─────────────────────────────────────────────────────
const TIER_COLORS = ['#B5A6FF', '#9DE0C0', '#E8C98A', '#9FB8E8', '#E89AC0', '#8E8E93'];

export function Tiers({ eventId }: { eventId?: string }): JSX.Element {
  const nav = useNav();
  const id = eventId ?? '';
  const { event } = usePoEvent(id);
  const { data: tierList, isLoading, isError } = usePoTiers(id);
  const createTier = usePoCreateTier(id);
  const updateTier = usePoUpdateTier(id);

  const [adding, setAdding] = useState(false);
  const [nm, setNm] = useState('');
  const [color, setColor] = useState('#B5A6FF');
  const [max, setMax] = useState('');
  const [price, setPrice] = useState('');
  const [aliasText, setAliasText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [aliasFor, setAliasFor] = useState<string | null>(null);
  const [newAlias, setNewAlias] = useState('');

  const resetForm = (): void => {
    setNm('');
    setColor('#B5A6FF');
    setMax('');
    setPrice('');
    setAliasText('');
  };

  const submit = async (): Promise<void> => {
    if (!nm.trim() || createTier.isPending) return;
    setErr(null);
    const maxNum = Number.parseInt(max, 10);
    // Door price in euros → cents (#34, display only). Blank/0 = free (null).
    const priceNum = Number.parseFloat(price.replace(',', '.'));
    const doorPriceCents =
      price.trim() && Number.isFinite(priceNum) && priceNum > 0 ? Math.round(priceNum * 100) : null;
    try {
      await createTier.mutateAsync({
        eventId: id,
        name: nm.trim(),
        color,
        maxGuests: Number.isFinite(maxNum) && maxNum > 0 ? maxNum : null,
        doorPriceCents,
        aliases: aliasText.split(',').map((a) => a.trim()).filter(Boolean),
      });
      resetForm();
      setAdding(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.events.errCreateTier);
    }
  };

  const commitAlias = async (tierId: string, current: string[]): Promise<void> => {
    const a = newAlias.trim().toLowerCase();
    setAliasFor(null);
    setNewAlias('');
    if (!a || current.includes(a)) return;
    setErr(null);
    try {
      await updateTier.mutateAsync({ tierId, aliases: [...current, a] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.events.errSaveAlias);
    }
  };

  return (
    <div className={col}>
      <Top
        onBack={nav.back}
        title={t.events.tiersTitle}
        sub={event?.name}
        right={<IconBtn name={adding ? 'close' : 'plus'} onClick={() => setAdding((a) => !a)} />}
      />
      <Scroll bottom={adding ? 120 : 24}>
        {err && <div className="mb-3 text-[13px] font-semibold text-[#E89AC0]">{err}</div>}
        {adding && (
          <div className="mb-[14px] rounded-[18px] border border-acc bg-elev p-4">
            <Label className="mb-[10px]">{t.events.newTier}</Label>
            <Field placeholder={t.events.tierNamePlaceholder} value={nm} onChange={setNm} autoFocus className="mb-3" />
            <Label className="mb-2">{t.events.color}</Label>
            <div className="mb-[14px] flex gap-[9px]">
              {TIER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className="h-[34px] w-[34px] cursor-pointer rounded-full transition-[filter] hover:brightness-[1.1]"
                  style={{ background: c, border: '2px solid ' + (color === c ? '#FFFFFF' : 'transparent') }}
                  aria-label={fmt(t.events.colorAria, { color: c })}
                />
              ))}
            </div>
            <Label className="mb-2">{t.events.maxOptional}</Label>
            <Field placeholder={t.events.maxPlaceholder} value={max} onChange={setMax} inputMode="numeric" className="mb-[14px]" />
            <Label className="mb-2">{t.events.priceOptional}</Label>
            <Field placeholder={t.events.pricePlaceholder} value={price} onChange={setPrice} inputMode="numeric" className="mb-[14px]" />
            <Label className="mb-2">{t.events.aliasesFeedLabel}</Label>
            <Field icon="spark" placeholder={t.events.aliasesPlaceholder} value={aliasText} onChange={setAliasText} />
            {aliasText.trim() && (
              <div className="mt-[10px] flex flex-wrap gap-1.5">
                {aliasText
                  .split(',')
                  .map((a) => a.trim())
                  .filter(Boolean)
                  .map((a) => (
                    <span key={a} className="rounded-[8px] border border-line bg-elev2 px-[9px] py-[5px] font-mono text-[12px] text-dim">
                      {a}
                    </span>
                  ))}
              </div>
            )}
          </div>
        )}
        <Note icon="spark">{t.events.aliasesNote}</Note>
        {isLoading ? (
          <Empty text={t.events.loadingTiers} />
        ) : isError ? (
          <Empty text={t.events.loadTiersError} />
        ) : (tierList ?? []).length === 0 ? (
          <Empty text={t.events.emptyTiers} />
        ) : (
          <div className="flex flex-col gap-[11px]">
            {(tierList ?? []).map((tier) => (
              <div key={tier.id} className="rounded-[18px] border border-line bg-elev p-[15px]">
                <div className="mb-3 flex items-center gap-[11px]">
                  <span className="h-[14px] w-[14px] shrink-0 rounded-full" style={{ background: tier.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-[15.5px] font-bold text-text">{tier.name}</div>
                    <div className="mt-px text-[12px] text-faint">{tier.max ? fmt(t.events.tierUsedOfMax, { used: tier.used, max: tier.max }) : fmt(t.events.tierUsedNoMax, { used: tier.used })}</div>
                  </div>
                  {tier.doorPrice > 0 && (
                    <span className="shrink-0 rounded-[7px] bg-acc-dim px-2 py-[3px] font-display text-[11.5px] font-bold text-acc">
                      €{tier.doorPrice % 1 === 0 ? tier.doorPrice : tier.doorPrice.toFixed(2)}
                    </span>
                  )}
                  {tier.isDefault && <MiniChip>{t.events.tierDefault}</MiniChip>}
                </div>
                {tier.max && (
                  <div className="mb-3 h-[6px] overflow-hidden rounded-[4px] bg-elev2">
                    <div className="h-full rounded-[4px]" style={{ width: Math.min(100, (tier.used / tier.max) * 100) + '%', background: tier.color }} />
                  </div>
                )}
                <Label className="mb-2">{t.events.aliases}</Label>
                <div className="flex flex-wrap gap-1.5">
                  {tier.aliases.map((a) => (
                    <span key={a} className="inline-flex items-center gap-[5px] rounded-[8px] border border-line bg-elev2 px-[9px] py-[5px] font-mono text-[12px] text-dim">
                      {a}
                    </span>
                  ))}
                  {aliasFor === tier.id ? (
                    <input
                      autoFocus
                      value={newAlias}
                      onChange={(e) => setNewAlias(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void commitAlias(tier.id, tier.aliases);
                        if (e.key === 'Escape') {
                          setAliasFor(null);
                          setNewAlias('');
                        }
                      }}
                      onBlur={() => {
                        setAliasFor(null);
                        setNewAlias('');
                      }}
                      placeholder={t.events.aliasInputPlaceholder}
                      className="w-[120px] rounded-[8px] border border-acc bg-elev2 px-[9px] py-[5px] font-mono text-[12px] text-text outline-none placeholder:text-faint"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setAliasFor(tier.id);
                        setNewAlias('');
                      }}
                      className="inline-flex items-center gap-1 rounded-[8px] border border-dashed border-line bg-transparent px-[9px] py-[5px] font-body text-[12px] text-faint transition-[filter] hover:brightness-[1.2]"
                    >
                      <Icon name="plus" size={12} sw={2.4} />
                      {t.events.aliasAdd}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Scroll>
      {adding && (
        <BottomBar>
          <Btn kind="primary" full icon="check" onClick={() => void submit()} disabled={!nm.trim() || createTier.isPending} className={nm.trim() && !createTier.isPending ? '' : 'opacity-50'}>
            {createTier.isPending ? t.events.saving : t.events.addTier}
          </Btn>
        </BottomBar>
      )}
    </div>
  );
}

// ── EXTERNAL CREW (pushed) — event_organizers + per-event quota (#6/#24, 86ey21vre) ──
// Event-scoped EXTERNAL people (a DJ, artist, guest organizer). Venue Team works
// every event already, so they're not shown here. Each crew member has a guest
// quota (event_quotas). Add/remove/quota is admin-only (RLS, role-only since the
// #20 2026-06-24 refinement); non-admins see a read-only list.
const crewStep = cn('flex h-[32px] w-[32px] items-center justify-center rounded-[9px] border border-line bg-elev2 text-text', press);

/** Tiny inline error under a crew sub-form action. */
function CrewError({ show, text }: { show: boolean; text: string }): JSX.Element | null {
  return show ? <p className="mt-2 text-[12px] text-red-300" role="alert">{text}</p> : null;
}

/** One crew member: name/email + an editable guest quota (Save chip on change) + remove. */
function CrewMemberRow({ eventId, member, canManage }: { eventId: string; member: PoCrewMember; canManage: boolean }): JSX.Element {
  const setQuota = usePoSetCrewQuota(eventId);
  const removeCrew = usePoRemoveCrew(eventId);
  const [value, setValue] = useState(member.quota);
  useEffect(() => setValue(member.quota), [member.quota]);
  const changed = value !== member.quota;
  return (
    <div className="rounded-[16px] border border-line bg-elev p-[13px]">
      <div className="flex items-center gap-[12px]">
        <Avatar name={member.fullName} size={42} />
        <div className="min-w-0 flex-1">
          <div className="font-display text-[15px] font-bold text-text">{member.fullName}</div>
          <div className="mt-0.5 truncate text-[12px] text-faint">{member.email}</div>
        </div>
        {canManage && (
          <MiniChip onClick={() => removeCrew.mutate({ eventId, userId: member.userId })}>
            {removeCrew.isPending ? t.events.crew.removing : t.events.crew.remove}
          </MiniChip>
        )}
      </div>
      {canManage && (
        <>
          <div className="mt-3 flex items-center justify-between gap-2 rounded-[13px] bg-acc-dim px-[12px] py-[8px]">
            <span className="text-[12.5px] text-dim">{t.events.crew.quotaRowLabel}</span>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => setValue((v) => Math.max(0, v - 1))} className={crewStep} aria-label={t.events.crew.quotaLess}>
                <Icon name="minus" size={15} sw={2.4} />
              </button>
              <span className="min-w-[24px] text-center font-display text-[17px] font-extrabold text-text">{value}</span>
              <button type="button" onClick={() => setValue((v) => v + 1)} className={cn(crewStep, 'text-acc')} aria-label={t.events.crew.quotaMore}>
                <Icon name="plus" size={15} sw={2.4} stroke="#B5A6FF" />
              </button>
              {changed && (
                <MiniChip onClick={() => setQuota.mutate({ eventId, userId: member.userId, quota: value })} className="ml-1 border-transparent bg-acc text-on-acc">
                  {setQuota.isPending ? t.events.crew.saving : t.events.crew.save}
                </MiniChip>
              )}
            </div>
          </div>
          <CrewError show={setQuota.isError} text={t.events.crew.assignError} />
          <CrewError show={removeCrew.isError} text={t.events.crew.removeError} />
        </>
      )}
    </div>
  );
}

/** A returning external person from the pool: a quota input + Add. */
function CrewPoolRow({ eventId, member, defaultQuota }: { eventId: string; member: PoCrewMember; defaultQuota: number }): JSX.Element {
  const assign = usePoAssignCrew(eventId);
  const [q, setQ] = useState(String(defaultQuota));
  const add = (): void => assign.mutate({ eventId, userId: member.userId, quota: q === '' ? undefined : Number(q) });
  return (
    <div className="rounded-[13px] border border-line bg-elev2 p-[11px]">
      <div className="flex items-center gap-[12px]">
        <Avatar name={member.fullName} size={36} />
        <div className="min-w-0 flex-1">
          <div className="font-display text-[14px] font-bold text-text">{member.fullName}</div>
          <div className="mt-0.5 truncate text-[12px] text-faint">{member.email}</div>
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-[10px] border border-line bg-elev px-2.5 py-[7px]">
          <Icon name="ticket" size={14} className="text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
            inputMode="numeric"
            placeholder={String(defaultQuota)}
            aria-label={t.events.crew.quotaInputAria}
            className="w-[40px] bg-transparent text-[13.5px] text-text outline-none placeholder:text-faint"
          />
          <span className="text-[12px] text-faint">{t.events.crew.quotaUnit}</span>
        </div>
        <Btn kind="primary" sm icon="plus" className="flex-1" onClick={add} disabled={assign.isPending}>
          {assign.isPending ? t.events.crew.assigning : t.events.crew.assignCta}
        </Btn>
      </div>
      <CrewError show={assign.isError} text={t.events.crew.assignError} />
    </div>
  );
}

export function Crew({ eventId }: { eventId?: string }): JSX.Element {
  const nav = useNav();
  const id = eventId ?? '';
  const { event } = usePoEvent(id);
  const { roles } = usePoIdentity();
  const isAdmin = roles.includes('admin');

  const crewQ = usePoCrew(id);
  // The returning-crew pool is only needed for the admin "add" path.
  const poolQ = usePoAssignableCrew(isAdmin ? id : '');
  const venueSettings = usePoVenueSettings();
  const defaultQuota = venueSettings.data?.defaultPersonalQuota ?? 5;
  const invite = usePoInviteExternalCrew();

  const [addOpen, setAddOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [inviteQuota, setInviteQuota] = useState('');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Prefill the invite quota with the venue default once it loads.
  useEffect(() => {
    if (venueSettings.data) setInviteQuota((q) => (q === '' ? String(defaultQuota) : q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueSettings.data]);

  const crew = crewQ.data ?? [];
  const pool = (poolQ.data ?? []).filter((m) => {
    const q = search.trim().toLowerCase();
    return !q || m.fullName.toLowerCase().includes(q) || m.email.toLowerCase().includes(q);
  });
  const canInvite = /.+@.+\..+/.test(email) && !invite.isPending;

  const doInvite = (): void => {
    setErr(null);
    setNotice(null);
    invite.mutate(
      { email: email.trim(), eventIds: [id], quota: inviteQuota === '' ? undefined : Number(inviteQuota) },
      {
        onSuccess: () => {
          setEmail('');
          setAddOpen(false);
          setNotice(t.events.crew.inviteDone);
        },
        onError: (e) => setErr(e instanceof Error ? e.message : t.events.crew.inviteError),
      },
    );
  };

  return (
    <div className={col}>
      <Top onBack={nav.back} title={t.events.crew.title} sub={event?.name} />
      <Scroll bottom={28}>
        <Note icon="users">{t.events.crew.explainer}</Note>

        <Label className="mb-[10px]">{t.events.crew.listLabel}</Label>
        {crewQ.isLoading ? (
          <Empty text={t.events.crew.loading} />
        ) : crewQ.isError ? (
          <Empty text={t.events.crew.loadError} />
        ) : crew.length === 0 ? (
          <Empty text={t.events.crew.empty} />
        ) : (
          <div className="mb-5 flex flex-col gap-[9px] lg:grid lg:grid-cols-2 lg:gap-[10px]">
            {crew.map((m) => (
              <CrewMemberRow key={m.userId} eventId={id} member={m} canManage={isAdmin} />
            ))}
          </div>
        )}

        {!isAdmin ? (
          <Note icon="shield">{t.events.crew.adminOnly}</Note>
        ) : (
          <Btn
            kind="primary"
            full
            icon="plus"
            className="mt-[18px]"
            onClick={() => {
              setErr(null);
              setNotice(null);
              setSearch('');
              setAddOpen(true);
            }}
          >
            {t.events.crew.addHeading}
          </Btn>
        )}

        {notice && (
          <p className="mt-3 text-[12.5px] text-acc-soft" role="status">
            {notice}
          </p>
        )}
      </Scroll>

      {/* Add flow in a sheet (keeps the screen to "list + one button", S6 feedback). */}
      {addOpen && isAdmin && (
        <Sheet onClose={() => setAddOpen(false)} center={false}>
          <div className="mb-1 font-display text-[17px] font-bold text-text">{t.events.crew.addHeading}</div>
          <p className="mb-4 text-[12.5px] leading-[1.45] text-faint">{t.events.crew.addExplainer}</p>

          {/* Way 1: invite a brand-new external person by email, with a quota. */}
          <Label className="mb-2">{t.events.crew.inviteLabel}</Label>
          <p className="mb-2.5 text-[12.5px] leading-[1.45] text-faint">{t.events.crew.inviteHint}</p>
          <Field icon="mail" placeholder={t.events.crew.invitePlaceholder} value={email} onChange={setEmail} inputMode="email" className="mb-2.5" />
          <Field
            icon="ticket"
            placeholder={String(defaultQuota)}
            value={inviteQuota}
            onChange={(v) => setInviteQuota(v.replace(/[^0-9]/g, '').slice(0, 4))}
            inputMode="numeric"
            className="mb-1.5"
          />
          <div className="mb-2.5 pl-0.5 text-[12px] leading-[1.4] text-faint">{t.events.crew.quotaHelp}</div>
          <Btn kind="primary" full icon="plus" disabled={!canInvite} className={canInvite ? '' : 'opacity-[0.45]'} onClick={doInvite}>
            {invite.isPending ? t.events.crew.inviting : t.events.crew.inviteCta}
          </Btn>
          {err && (
            <p className="mt-2 text-[12px] text-red-300" role="alert">
              {err}
            </p>
          )}

          <div className="my-4 border-t border-line2" />

          {/* Way 2: add a returning external person (searchable pool), with a quota. */}
          <Label className="mb-2">{t.events.crew.assignLabel}</Label>
          <p className="mb-2.5 text-[12.5px] leading-[1.45] text-faint">{t.events.crew.assignHint}</p>
          {poolQ.isLoading ? (
            <div className="py-2 text-[12.5px] text-faint">{t.events.crew.loading}</div>
          ) : (poolQ.data ?? []).length === 0 ? (
            <div className="rounded-[13px] border border-dashed border-line bg-elev2 px-[14px] py-[12px] text-[12.5px] text-faint">
              {t.events.crew.assignEmpty}
            </div>
          ) : (
            <>
              <Field icon="search" placeholder={t.events.crew.searchPlaceholder} value={search} onChange={setSearch} className="mb-3" />
              {pool.length === 0 ? (
                <div className="py-2 text-[12.5px] text-faint">{t.events.crew.searchEmpty}</div>
              ) : (
                <div className="flex max-h-[40vh] flex-col gap-[9px] overflow-y-auto">
                  {pool.map((m) => (
                    <CrewPoolRow key={m.userId} eventId={id} member={m} defaultQuota={defaultQuota} />
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

// ── PAST EVENT recap (pushed) ────────────────────────────────────────────────────
const RECAP_CAP = 8;

export function PastEvent({ id }: { id?: string }): JSX.Element {
  const nav = useNav();
  const { event, isLoading: evLoading, isError: evError, notFound } = usePoEvent(id ?? '');
  const { data: r, isLoading: rLoading, isError: rError } = usePoEventRecap(id ?? '');
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
                    <RoleChip role={g.role} />
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

function EventActivitySection({
  eventId,
  isLive,
}: {
  eventId: string;
  isLive?: boolean;
}): JSX.Element | null {
  const { roles } = usePoIdentity();
  const canAudit = venueCapabilities(roles).viewAudit;
  const interval = isLive ? 15_000 : undefined;
  const { data: activity, isLoading: statsLoading } = usePoEventActivity(eventId, {
    enabled: canAudit,
    refetchInterval: canAudit ? interval : undefined,
  });
  const { data: feed, isLoading: feedLoading } = usePoAuditFeed(
    { eventId, limit: 50 },
    { enabled: canAudit, refetchInterval: canAudit ? interval : undefined }
  );

  if (!canAudit) return null;

  const tiers = activity?.tiers ?? [];
  const members = activity?.members ?? [];
  const lines = feed ?? [];

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
        <ul className="divide-y divide-line2">
          {lines.map((line) => (
            <EventAuditEntry key={line.id} line={line} />
          ))}
        </ul>
      )}
    </div>
  );
}

// ── EVENTS & TIERS hub (pushed) ──────────────────────────────────────────────────
export function EventBeheer(): JSX.Element {
  const nav = useNav();
  const { data, isLoading, isError } = usePoEvents();
  const upcoming = (data ?? []).filter((e) => e.when === 'upcoming');
  const past = (data ?? []).filter((e) => e.when === 'past');
  const evRow = (e: PoEvent, dim: boolean): JSX.Element => (
    <button
      key={e.id}
      type="button"
      onClick={() => nav.push(dim ? 'pastevent' : 'eventedit', { id: e.id })}
      className={cn('flex w-full items-center gap-[13px] rounded-[16px] border border-line bg-elev p-[13px] text-left', cardPress, dim && 'opacity-[0.72]')}
    >
      <span className="w-[44px] shrink-0 text-center">
        <span className={cn('block font-display text-[20px] font-extrabold leading-none', e.accent ? 'text-acc' : 'text-text')}>{e.date}</span>
        <span className="mt-0.5 block text-[9.5px] font-bold tracking-[0.05em] text-faint">{e.mon}</span>
      </span>
      <span className="w-px self-stretch bg-line2" />
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[15.5px] font-bold text-text">{e.name}</span>
        <span className="mt-px block text-[12.5px] text-faint">
          {fmt(t.events.hubCardSub, { venue: e.venue, n: e.guests })}
        </span>
      </span>
      <Icon name="chev" size={18} className="text-ghost" />
    </button>
  );
  return (
    <div className={col}>
      <Top onBack={nav.back} title={t.events.hubTitle} sub={t.events.hubSub} />
      <Scroll bottom={24}>
        <button type="button" onClick={() => nav.push('eventedit', { isNew: true })} className={cn('mb-5 flex w-full items-center gap-[13px] rounded-[16px] bg-acc p-4 text-left', press)}>
          <span className="flex h-[40px] w-[40px] items-center justify-center rounded-[12px] bg-on-acc/[0.14] text-on-acc">
            <Icon name="plus" size={22} sw={2.4} />
          </span>
          <span className="flex-1">
            <span className="block font-display text-[16px] font-extrabold text-on-acc">{t.events.hubNewEvent}</span>
            <span className="mt-px block text-[12.5px] text-on-acc/70">{t.events.hubNewEventSub}</span>
          </span>
          <span className="text-on-acc">
            <Icon name="arrowR" size={20} />
          </span>
        </button>
        {isLoading ? (
          <Empty text={t.events.loadingEvents} />
        ) : isError ? (
          <Empty text={t.events.loadEventsError} />
        ) : (
          <>
            <Label className="mb-[10px]">{fmt(t.events.upcomingCount, { n: upcoming.length })}</Label>
            {upcoming.length === 0 ? (
              <div className="mb-5">
                <Empty text={t.events.emptyUpcoming} />
              </div>
            ) : (
              <div className="mb-5 flex flex-col gap-[9px] lg:grid lg:grid-cols-2 lg:gap-[10px]">{upcoming.map((e) => evRow(e, false))}</div>
            )}
            <Label className="mb-[10px]">{t.events.past}</Label>
            {past.length === 0 ? (
              <Empty text={t.events.emptyPast} />
            ) : (
              <div className="flex flex-col gap-[9px] lg:grid lg:grid-cols-2 lg:gap-[10px]">{past.map((e) => evRow(e, true))}</div>
            )}
          </>
        )}
      </Scroll>
    </div>
  );
}
