'use client';

/** Events tab + event detail, event CRUD, tier/alias beheer, past-event recap. */
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import {
  usePoCrew,
  usePoAssignableCrew,
  usePoCanManageTemplates,
  usePoEvent,
  usePoEventDetail,
  usePoEventForEdit,
  usePoEventRecap,
  usePoEvents,
  useBillingBlocked,
  usePoTemplates,
  usePoTiers,
  usePoEventActivity,
  usePoAuditFeed,
  usePoRequestLinks,
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
  usePoSetEventDefaultMemberQuota,
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
import { TIER_COLORS, nextAvailableColor, allColorsUsed } from '@/lib/po/tier-colors';
import { useNav } from '../context';
import { DateField, TimeField } from '../datetime-field';
import { Icon } from '../icon';
import { Avatar, Btn, Empty, Field, IconBtn, Label, MiniChip, Note, Scroll, ToggleRow, Top } from '../kit';
import { BottomBar, Sheet } from '../shell';
import { TierPill } from './guests/_shared';

const cardPress = 'transition-[border-color,transform] hover:border-white/[0.24] active:scale-[0.99]';
const press = 'transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]';
const col = 'flex h-full flex-col';
const iconSm = 'flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] border border-line text-faint';

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
  // Creating events is admin-only (T7 regression check on PR #100): hide the
  // CTA for other roles instead of sending them into a read-only editor.
  const isAdmin = usePoIdentity().roles.includes('admin');
  // Soft-block (#32 refinement): hide the growth CTA; the note explains why.
  const billingLock = useBillingBlocked();
  // Card-level edit affordance (M7 — replaces the deleted "Events & tiers" More
  // hub): same screen-level gate the old hub used (admin OR organizes any event
  // at this venue); EventEdit itself still enforces true per-event write rights.
  const canManageTemplates = usePoCanManageTemplates();
  const canEditEvents = isAdmin || canManageTemplates;
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
        {isAdmin && !billingLock.blocked && (
          <Btn sm kind="ghost" icon="cal" onClick={() => nav.push('eventedit', { isNew: true })}>
            {t.events.newEvent}
          </Btn>
        )}
      </div>
      {isAdmin && billingLock.blocked && (
        <div className="flex-none px-5">
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
        </div>
      )}
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
                    <div key={e.id} className={cn('flex items-center gap-2 rounded-[18px] border border-line bg-elev p-[14px]', cardPress)}>
                      <button
                        type="button"
                        onClick={() => nav.push(e.when === 'past' ? 'pastevent' : 'event', { id: e.id })}
                        className="flex min-w-0 flex-1 items-center gap-[14px] text-left"
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
                      {canEditEvents && e.when !== 'past' && (
                        <button
                          type="button"
                          title={t.home.aEdit}
                          aria-label={t.home.aEdit}
                          onClick={() => nav.push('eventedit', { id: e.id })}
                          className={cn('flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] border border-line text-faint', press)}
                        >
                          <Icon name="cog" size={17} />
                        </button>
                      )}
                    </div>
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
  // Request-links count for the admin-only links row (F1) — same disable pattern.
  const linksQ = usePoRequestLinks(isAdmin ? id ?? '' : '');
  // Setup nudge (T2, 1/7): a fresh event has no tiers, so lead the people who can
  // fix that (admin/organizer) to the setup instead of a wall of zeroed stats.
  const tiersQ = usePoTiers(id ?? '');
  const { canManage } = usePoEventForEdit(id ?? '');

  if (isLoading) return <ScreenState onBack={nav.back} title={t.events.detailTitle} text={t.events.loading} />;
  if (isError || notFound || !event) {
    return <ScreenState onBack={nav.back} title={t.events.detailTitle} text={t.events.eventUnavailable} />;
  }

  const ev = event;
  const onweg = Math.max(0, ev.guests - ev.inside);
  const pct = ev.guests > 0 ? ev.inside / ev.guests : 0;
  const recent = detail?.recent ?? [];
  const openRequests = detail?.openRequests ?? 0;
  const needsSetup = canManage && !ev.cancelled && tiersQ.data?.length === 0;
  // Desktop (S3.3): the headline numbers/actions go left, the "needs attention"
  // + "laatst binnen" feed go right. When there's no secondary content the left
  // column reads as a normal centered column instead of a wide thin strip.
  const hasSecondary = openRequests > 0 || showDoor || recent.length > 0;

  return (
    <div className={col}>
      {/* Feedback Joeri: the "dots" icon was unreadable — use a clear settings/edit cog. */}
      <Top onBack={nav.back} title={ev.name} sub={`${ev.venue} · ${ev.date} ${ev.mon}`} right={<IconBtn name="cog" onClick={() => nav.push('eventedit', { id: ev.id })} />} />
      <Scroll bottom={28}>
        {needsSetup && (
          <div className="mb-3 rounded-[18px] border bg-elev p-4" style={{ borderColor: 'rgba(181,166,255,0.4)' }}>
            <div className="flex gap-[11px]">
              <span className="mt-px shrink-0 text-acc">
                <Icon name="spark" size={19} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-display text-[15.5px] font-bold text-text">{t.events.setup.title}</div>
                <p className="mt-1 text-[12.5px] leading-[1.45] text-faint">{t.events.setup.noTiers}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-[10px]">
              <Btn kind="primary" sm icon="ticket" onClick={() => nav.push('tiers', { id: ev.id })}>
                {t.events.setup.addTiers}
              </Btn>
              <Btn kind="ghost" sm icon="cog" onClick={() => nav.push('eventedit', { id: ev.id })}>
                {t.events.setup.settings}
              </Btn>
            </div>
          </div>
        )}
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
            {/* Request links (F1) — admin-only quick entry, mirrors the crew row. */}
            {isAdmin && (
              <button
                type="button"
                onClick={() => nav.push('links', { id: ev.id })}
                className={cn('mt-3 flex w-full items-center gap-[12px] rounded-[16px] border border-line bg-elev p-[13px] text-left', cardPress)}
              >
                <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] border border-line bg-elev2 text-acc">
                  <Icon name="link" size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-body text-[15px] font-semibold text-text">{t.events.linksRowTitle}</span>
                  <span className="mt-px block text-[12.5px] text-faint">
                    {(() => {
                      const n = (linksQ.data ?? []).filter((l) => l.active).length;
                      return fmt(n === 1 ? t.events.linksRowSubOne : t.events.linksRowSubMany, { n });
                    })()}
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

/** Save an existing event's setup (tiers + capacity + settings) as a reusable template.
 *  Reports a typed-but-unsaved name via onDraftChange so the parent's leave-guard can
 *  catch it — "Save event" does NOT save the template (T4, 1/7). */
function SaveAsTemplate({
  eventId,
  onDraftChange,
}: {
  eventId: string;
  onDraftChange?: (dirty: boolean) => void;
}): JSX.Element {
  const createTpl = usePoCreateTemplateFromEvent();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [savedName, setSavedName] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const draft = open && !!name.trim();
  useEffect(() => {
    onDraftChange?.(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const submit = async (): Promise<void> => {
    if (!name.trim() || createTpl.isPending) return;
    setErr(null);
    setSavedName(null);
    try {
      const tplName = name.trim();
      await createTpl.mutateAsync({ eventId, name: tplName });
      setSavedName(tplName);
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
              setSavedName(null);
            }}
          >
            {t.events.saveTemplateCta}
          </Btn>
          {/* Unmissable saved-state: a card with the template's name + where to
              find it, not a one-line footnote (T4, 1/7 — "felt saved, couldn't
              find it back"). */}
          {savedName && (
            <div
              className="mt-2 flex items-start gap-[10px] rounded-[14px] border bg-acc-dim p-[13px]"
              style={{ borderColor: 'rgba(181,166,255,0.4)' }}
            >
              <span className="mt-px text-acc">
                <Icon name="check" size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-body text-[14px] font-bold text-text">
                  {fmt(t.events.saveTemplateDoneTitle, { name: savedName })}
                </div>
                <div className="mt-0.5 text-[12.5px] leading-[1.45] text-faint">{t.events.saveTemplateDoneBody}</div>
              </div>
            </div>
          )}
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
  const setDefaultQuota = usePoSetEventDefaultMemberQuota(editId);
  // Request links (F1): the row under the block shows the live active count.
  // editId is '' on create, which keeps the hook disabled (no fetch).
  const linksQ = usePoRequestLinks(editId);

  const [name, setName] = useState('');
  // Create-from-template (86exyp8gn): null = blank event (the existing path).
  const [templateId, setTemplateId] = useState<string | null>(null);
  // Collapse the template chips past 4 — a venue with 10+ templates would drown
  // the form otherwise (retest T4, Q4).
  const [tplListExpanded, setTplListExpanded] = useState(false);
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
  // Per-event default member quota (T10) — seeds the add-crew prefill. Immediate
  // save like the lock/check-out controls, so it never counts toward form-dirty.
  const [quotaDefault, setQuotaDefault] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Leaving with unsaved edits asks first (retest 3/7, Q6). Immediate controls
  // (lock, check-out, cancel) commit on toggle, so they never count as dirty.
  const [confirmLeave, setConfirmLeave] = useState(false);
  // A typed-but-unsaved template name (SaveAsTemplate) — "Save event" and back
  // must not silently discard it (T4, 1/7).
  const [tplDraft, setTplDraft] = useState(false);

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
    setQuotaDefault(ev.defaultMemberQuota);
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

  // Anything the Save button would commit that differs from the loaded state.
  const fieldsDirty = ((): boolean => {
    if (!writable || saving) return false;
    if (isNew) return !!(name.trim() || dateStr || timeStr || endDateStr || endTimeStr);
    if (!ev) return false;
    const [d0, t0] = splitLocal(ev.startsAt);
    const [ed0, et0] = splitLocal(ev.endsAt);
    const [ad0, at0] = splitLocal(ev.autoLockAt);
    return (
      name !== ev.name ||
      dateStr !== d0 ||
      timeStr !== t0 ||
      endDateStr !== ed0 ||
      endTimeStr !== et0 ||
      landingOn !== ev.landingActive ||
      autoOn !== !!ev.autoLockAt ||
      (autoOn && (autoDate !== ad0 || autoTime !== at0))
    );
  })();
  // The template draft is dirty too — it has its OWN save button, which "Save
  // event" does not press for you.
  const dirty = fieldsDirty || (!isNew && writable && tplDraft);

  const onBack = (): void => {
    if (dirty) setConfirmLeave(true);
    else nav.back();
  };
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
        // Continue the flow on the new event's settings (share the link, add
        // tiers) instead of bouncing back to the list (T2, feedback 1/7).
        const newId = templateId
          ? await createFromTemplate.mutateAsync({ templateId, name: name.trim(), startsAt, endsAt })
          : await createEvent.mutateAsync({ venueId, name: name.trim(), startsAt, endsAt, landingActive: landingOn });
        nav.replace('eventedit', { id: newId });
        return;
      } else {
        await updateEvent.mutateAsync({ eventId: editId, name: name.trim(), startsAt, endsAt });
        if (ev && landingOn !== ev.landingActive) {
          await setLandingActive.mutateAsync({ eventId: editId, active: landingOn });
        }
        // Compare through splitLocal, not the raw ISO strings: `autoIso` comes
        // from toISOString() ("…Z") while `ev.autoLockAt` comes back from
        // PostgREST ("…+00:00") — same instant, different string, so a naive
        // !== was always true and fired a redundant write on every save (C22).
        const [autoDate0, autoTime0] = splitLocal(ev?.autoLockAt ?? null);
        const [autoDateNew, autoTimeNew] = splitLocal(autoIso);
        if (autoDateNew !== autoDate0 || autoTimeNew !== autoTime0) {
          await setAutoLock.mutateAsync({ eventId: editId, autoLockAt: autoIso });
        }
      }
      // Event fields are saved, but a typed template name is not — hold the
      // screen and ask instead of silently dropping it (T4, 1/7).
      if (tplDraft) setConfirmLeave(true);
      else nav.back();
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

  // Per-event default member quota — immediate save with optimistic local state,
  // clamped at 0. Reverts on failure like the lock/check-out controls (T10).
  const changeQuota = async (next: number): Promise<void> => {
    const clamped = Math.max(0, next);
    const prev = quotaDefault;
    if (clamped === prev) return;
    setQuotaDefault(clamped);
    setErr(null);
    try {
      await setDefaultQuota.mutateAsync({ eventId: editId, quota: clamped });
    } catch (e) {
      setQuotaDefault(prev);
      setErr(e instanceof Error ? e.message : t.events.errQuotaFailed);
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
      <Top onBack={onBack} title={isNew ? t.events.newEvent : t.events.editTitle} sub={isNew ? undefined : ev?.name} />
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

        {isNew &&
          isAdmin &&
          (templates.data?.length ?? 0) > 0 &&
          ((): JSX.Element => {
            const all = templates.data ?? [];
            // Collapsed = first 4 (name-sorted), plus the selection if it lives
            // further down so the active chip never disappears.
            const shown = tplListExpanded ? all : all.slice(0, 4);
            const selected = templateId ? all.find((tpl) => tpl.id === templateId) : undefined;
            if (selected && !shown.some((tpl) => tpl.id === selected.id)) shown.push(selected);
            const hidden = all.length - shown.length;
            return (
              <>
                <Label className="mb-2">{t.events.fieldTemplate}</Label>
                <div className="mb-[14px] flex flex-wrap gap-2">
                  <TemplateChip label={t.events.templateBlank} active={!templateId} onClick={() => setTemplateId(null)} />
                  {shown.map((tpl) => (
                    <TemplateChip
                      key={tpl.id}
                      label={tpl.name}
                      active={templateId === tpl.id}
                      onClick={() => setTemplateId(tpl.id)}
                    />
                  ))}
                  {hidden > 0 && (
                    <button
                      type="button"
                      onClick={() => setTplListExpanded(true)}
                      className="rounded-full border border-dashed border-line px-[13px] py-[7px] font-display text-[12.5px] font-bold text-faint transition-colors hover:brightness-110"
                    >
                      {fmt(t.events.templateShowAll, { n: all.length })}
                    </button>
                  )}
                </div>
                {templateId && (
                  <div className="mb-[14px]">
                    <Note icon="spark">{t.events.templateNote}</Note>
                  </div>
                )}
              </>
            );
          })()}

        <Label className="mb-2">{t.events.fieldName}</Label>
        <Field placeholder={t.events.namePlaceholder} value={name} onChange={writable ? setName : undefined} className="mb-[14px]" />

        <Label className="mb-2">{t.events.fieldVenue}</Label>
        <Field icon="building" value={venueLabel} placeholder={t.events.venuePlaceholder} className="mb-[14px]" />

        {/* min-w-0 lets both columns shrink inside narrow viewports (flex default
            min-width:auto made the date column push the time field off-screen);
            the date gets the wider share, the time needs little. */}
        <div className="mb-[14px] flex gap-[10px]">
          <div className="min-w-0 flex-[1.35]">
            <Label className="mb-2">{t.events.fieldDate}</Label>
            <DateField value={dateStr} onChange={writable ? setDateStr : undefined} />
          </div>
          <div className="min-w-0 flex-1">
            <Label className="mb-2">{t.events.fieldDoors}</Label>
            <TimeField value={timeStr} onChange={writable ? setTimeStr : undefined} />
          </div>
        </div>

        {/* End time (optional). Drives the Upcoming/Live/Past phase — a night with
            an end stays "Live" until it actually ends, then rolls to "Past". */}
        <div className="mb-[14px] flex gap-[10px]">
          <div className="min-w-0 flex-[1.35]">
            <Label className="mb-2">{t.events.fieldEndDate}</Label>
            <DateField value={endDateStr} onChange={writable ? setEndDateStr : undefined} />
          </div>
          <div className="min-w-0 flex-1">
            <Label className="mb-2">{t.events.fieldEnd}</Label>
            <TimeField value={endTimeStr} onChange={writable ? setEndTimeStr : undefined} />
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

        {/* Per-event default member quota (T10). Seeded from the venue default at
            creation; editable here per event. Immediate-save stepper. */}
        {!isNew && (
          <>
            <Label className="mb-[10px]">{t.events.quotaLabel}</Label>
            <div className="mb-[18px] rounded-[16px] border border-line bg-elev px-[14px] py-1">
              <div className="flex items-center gap-[12px] py-[14px]">
                <div className="flex-1">
                  <div className="text-[14.5px] font-semibold text-text">{t.events.quotaTitle}</div>
                  <div className="mt-0.5 text-[12px] text-faint">{t.events.quotaSub}</div>
                </div>
                {writable ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void changeQuota(quotaDefault - 1)}
                      disabled={setDefaultQuota.isPending || quotaDefault <= 0}
                      className={cn(iconSm, press, quotaDefault <= 0 && 'opacity-40')}
                      aria-label={t.events.quotaLess}
                    >
                      <Icon name="minus" size={16} />
                    </button>
                    <span className="min-w-[22px] text-center font-display text-[18px] font-extrabold text-text">{quotaDefault}</span>
                    <button
                      type="button"
                      onClick={() => void changeQuota(quotaDefault + 1)}
                      disabled={setDefaultQuota.isPending}
                      className={cn(iconSm, press, 'text-acc')}
                      aria-label={t.events.quotaMore}
                    >
                      <Icon name="plus" size={16} />
                    </button>
                  </div>
                ) : (
                  <span className="font-display text-[18px] font-extrabold text-text">{quotaDefault}</span>
                )}
              </div>
            </div>
          </>
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
                  <div className="min-w-0 flex-[1.35]">
                    <Label className="mb-2">{t.events.closesOn}</Label>
                    <DateField value={autoDate} onChange={writable ? setAutoDate : undefined} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <Label className="mb-2">{t.events.closesAt}</Label>
                    <TimeField value={autoTime} onChange={writable ? setAutoTime : undefined} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Per-influencer request links (F1) — directly under the block, Tiers/Crew
            row pattern. The default link's own toggle stays the master above. */}
        {!isNew && (
          <button
            type="button"
            onClick={() => nav.push('links', { id: editId })}
            className="-mt-1 mb-[18px] flex w-full items-center gap-[13px] rounded-[14px] border border-line bg-elev px-[14px] py-[15px] text-left transition-colors hover:bg-white/[0.03]"
          >
            <span className="flex h-[38px] w-[38px] items-center justify-center rounded-[11px] border border-line bg-elev2 text-acc">
              <Icon name="link" size={18} />
            </span>
            <span className="flex-1">
              <span className="block font-body text-[15px] font-semibold text-text">{t.events.linksRowTitle}</span>
              <span className="mt-px block text-[12.5px] text-faint">
                {(() => {
                  const n = (linksQ.data ?? []).filter((l) => (l.isDefault ? landingOn : l.active)).length;
                  return fmt(n === 1 ? t.events.linksRowSubOne : t.events.linksRowSubMany, { n });
                })()}
              </span>
            </span>
            <Icon name="chev" size={18} className="text-ghost" />
          </button>
        )}

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
        {!isNew && writable && <SaveAsTemplate eventId={editId} onDraftChange={setTplDraft} />}

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
      {confirmLeave && (
        <Sheet onClose={() => setConfirmLeave(false)} center={false}>
          <div className="mb-1 font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">{t.events.unsaved.title}</div>
          <div className="mb-4 text-[13.5px] leading-[1.45] text-faint">
            {tplDraft && !fieldsDirty ? t.events.unsaved.bodyTemplate : t.events.unsaved.body}
          </div>
          <div className="flex flex-col gap-2">
            <Btn kind="primary" full icon="check" onClick={() => setConfirmLeave(false)}>
              {t.events.unsaved.stay}
            </Btn>
            <Btn
              kind="dark"
              full
              onClick={() => {
                setConfirmLeave(false);
                nav.back();
              }}
            >
              {t.events.unsaved.discard}
            </Btn>
          </div>
        </Sheet>
      )}
    </div>
  );
}

// ── TIERS & aliases (pushed) ─────────────────────────────────────────────────────

export function Tiers({ eventId }: { eventId?: string }): JSX.Element {
  const nav = useNav();
  const id = eventId ?? '';
  const { event } = usePoEvent(id);
  const { data: tierList, isLoading, isError } = usePoTiers(id);
  const createTier = usePoCreateTier(id);
  const updateTier = usePoUpdateTier(id);

  const usedColors = tierList?.map((tr) => tr.color) ?? [];

  const [adding, setAdding] = useState(false);
  const [nm, setNm] = useState('');
  const [color, setColor] = useState(() => nextAvailableColor(usedColors));
  const [kind, setKind] = useState<'free' | 'paid'>('free');
  const [max, setMax] = useState('');
  const [price, setPrice] = useState('');
  const [vat, setVat] = useState('9');
  const [aliasText, setAliasText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [aliasFor, setAliasFor] = useState<string | null>(null);
  const [newAlias, setNewAlias] = useState('');
  // Colors used by tiers created this session, before the tiers query refetches
  // (Save & add another must not immediately re-offer the color just taken).
  const [justAddedColors, setJustAddedColors] = useState<string[]>([]);

  const usedColorsForPicker = [...usedColors, ...justAddedColors];
  const allUsed = allColorsUsed(usedColorsForPicker);

  const resetForm = (extraUsed: string[] = []): void => {
    setNm('');
    setColor(nextAvailableColor([...usedColors, ...extraUsed]));
    setKind('free');
    setMax('');
    setPrice('');
    setVat('9');
    setAliasText('');
  };

  const openAdd = (): void => {
    setErr(null);
    resetForm(justAddedColors);
    setAdding(true);
  };

  const closeAdd = (): void => {
    setErr(null);
    setJustAddedColors([]);
    setAdding(false);
  };

  // Arriving on a tier-less event (setup nudge, "Guest tiers" row) opens the
  // create form directly — no extra tap on the + first (retest 3/7, Q10). Once
  // only, so deliberately closing the form doesn't bounce it back open.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || isLoading || isError) return;
    if ((tierList ?? []).length === 0) {
      autoOpened.current = true;
      setAdding(true);
    }
  }, [isLoading, isError, tierList]);

  const submit = async (stayOpen: boolean): Promise<void> => {
    if (!nm.trim() || createTier.isPending) return;
    setErr(null);
    const maxNum = Number.parseInt(max, 10);
    // Door price in euros → cents (#34, display only). Free tiers stay null.
    const priceNum = Number.parseFloat(price.replace(',', '.'));
    const doorPriceCents =
      kind === 'paid' && price.trim() && Number.isFinite(priceNum) && priceNum > 0 ? Math.round(priceNum * 100) : null;
    if (kind === 'paid' && doorPriceCents == null) {
      setErr(t.events.errPaidNeedsPrice);
      return;
    }
    const vatNum = Number.parseFloat(vat.replace(',', '.'));
    const vatPercent = kind === 'paid' && Number.isFinite(vatNum) ? vatNum : null;
    const usedColor = color;
    try {
      await createTier.mutateAsync({
        eventId: id,
        name: nm.trim(),
        color,
        maxGuests: Number.isFinite(maxNum) && maxNum > 0 ? maxNum : null,
        doorPriceCents,
        vatPercent,
        aliases: aliasText.split(',').map((a) => a.trim()).filter(Boolean),
      });
      if (stayOpen) {
        const nextJustAdded = [...justAddedColors, usedColor];
        setJustAddedColors(nextJustAdded);
        resetForm(nextJustAdded);
      } else {
        resetForm();
        setJustAddedColors([]);
        setAdding(false);
      }
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
        right={<IconBtn name={adding ? 'close' : 'plus'} onClick={() => (adding ? closeAdd() : openAdd())} />}
      />
      <Scroll bottom={adding ? 160 : 24}>
        {err && <div className="mb-3 text-[13px] font-semibold text-[#E89AC0]">{err}</div>}
        {adding && (
          <div className="mb-[14px] rounded-[18px] border border-acc bg-elev p-4">
            <Label className="mb-[10px]">{t.events.newTier}</Label>
            <Field placeholder={t.events.tierNamePlaceholder} value={nm} onChange={setNm} autoFocus className="mb-3" />
            <Label className="mb-2">{t.events.tierKindLabel}</Label>
            <div className="mb-[14px] flex gap-2">
              {(['free', 'paid'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={cn(
                    'rounded-full px-[14px] py-[6px] font-display text-[13px] font-bold transition-[filter] hover:brightness-110',
                    kind === k ? 'bg-acc text-on-acc' : 'border border-line bg-elev text-dim',
                  )}
                >
                  {k === 'free' ? t.events.tierKindFree : t.events.tierKindPaid}
                </button>
              ))}
            </div>
            <Label className="mb-2">{t.events.color}</Label>
            <div className="mb-[14px] flex flex-wrap gap-[9px]">
              {TIER_COLORS.map((c) => {
                const disabled = usedColorsForPicker.includes(c) && !allUsed && c !== color;
                return (
                  <button
                    key={c}
                    type="button"
                    disabled={disabled}
                    aria-disabled={disabled}
                    onClick={() => !disabled && setColor(c)}
                    className={cn(
                      'h-[34px] w-[34px] rounded-full transition-[filter]',
                      disabled ? 'cursor-not-allowed opacity-30' : 'cursor-pointer hover:brightness-[1.1]',
                    )}
                    style={{ background: c, border: '2px solid ' + (color === c ? '#FFFFFF' : 'transparent') }}
                    aria-label={fmt(t.events.colorAria, { color: c })}
                  />
                );
              })}
            </div>
            {allUsed && <div className="mb-[14px] text-[12px] text-faint">{t.events.colorAllUsedWarning}</div>}
            <Label className="mb-2">{t.events.maxOptional}</Label>
            <Field placeholder={t.events.maxPlaceholder} value={max} onChange={setMax} inputMode="numeric" className="mb-[14px]" />
            {kind === 'paid' && (
              <>
                <Label className="mb-2">{t.events.priceLabel}</Label>
                <Field placeholder={t.events.pricePlaceholder} value={price} onChange={setPrice} inputMode="numeric" className="mb-[14px]" />
                <Label className="mb-2">{t.events.vatLabel}</Label>
                <Field placeholder={t.events.vatPlaceholder} value={vat} onChange={setVat} inputMode="numeric" className="mb-[14px]" />
              </>
            )}
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
          !adding && (
            <button
              type="button"
              onClick={openAdd}
              className="flex w-full flex-col items-center gap-2 rounded-[18px] border border-dashed border-line bg-elev/40 py-[30px] text-center transition-[filter] hover:brightness-110"
            >
              <span className="text-[14px] text-faint">{t.events.emptyTiers}</span>
              <span className="font-display text-[14px] font-bold text-acc">{t.events.emptyTiersCta}</span>
            </button>
          )
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
                  {tier.doorPrice > 0 && tier.vatPercent != null && (
                    <span className="shrink-0 rounded-[7px] border border-line2 bg-transparent px-2 py-[3px] font-display text-[10.5px] font-semibold text-faint">
                      {fmt(t.events.tierVatChip, { pct: tier.vatPercent % 1 === 0 ? tier.vatPercent : tier.vatPercent.toFixed(1) })}
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
          <div className="flex flex-col gap-2">
            <Btn
              kind="primary"
              full
              icon="check"
              onClick={() => void submit(false)}
              disabled={!nm.trim() || createTier.isPending}
              className={nm.trim() && !createTier.isPending ? '' : 'opacity-50'}
            >
              {createTier.isPending ? t.events.saving : t.events.saveTier}
            </Btn>
            <div className="flex gap-2">
              <Btn
                kind="dark"
                className={cn('flex-1', nm.trim() && !createTier.isPending ? '' : 'opacity-50')}
                onClick={() => void submit(true)}
                disabled={!nm.trim() || createTier.isPending}
              >
                {t.events.saveTierAndNew}
              </Btn>
              <Btn kind="ghost" className="flex-1" onClick={closeAdd}>
                {t.events.cancelTier}
              </Btn>
            </div>
          </div>
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
  // Prefill new crew quotas from THIS event's default (T10) — not the venue
  // default. The event value is seeded from the venue default at creation and
  // then editable per event, so two events can carry different defaults.
  const edit = usePoEventForEdit(id);
  const defaultQuota = edit.data?.defaultMemberQuota ?? 0;
  const invite = usePoInviteExternalCrew();

  const [addOpen, setAddOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [inviteQuota, setInviteQuota] = useState('');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Prefill the invite quota with the event's default once it loads.
  useEffect(() => {
    if (edit.data) setInviteQuota((q) => (q === '' ? String(defaultQuota) : q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit.data]);

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

