'use client';

/** Event CRUD (create/edit) — split from events.tsx (FE-5). */
import { type JSX, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import {
  usePoEventForEdit,
  usePoTemplates,
  usePoRequestLinks,
} from '@/features/po/hooks';
import {
  usePoSetCancelled,
  usePoCreateEvent,
  usePoCreateEventFromTemplate,
  usePoSetAllowUncheck,
  usePoSetAutoLock,
  usePoSetEventDefaultMemberQuota,
  usePoSetLandingActive,
  usePoSetListLock,
  usePoUpdateEvent,
} from '@/features/po/mutations';
import { resolveAllowUncheck } from '@/features/events/allow-uncheck';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { isoToLocalInput, localInputToIso } from '@/features/events/datetime';
import { useNav } from '../../context';
import { DateField, TimeField } from '../../datetime-field';
import { Icon } from '../../icon';
import { Btn, Field, InfoTip, Label, Note, Scroll, ToggleRow, Top, copyStateLabel, press, useCopyText } from '../../kit';
import { BottomBar, Sheet } from '../../shell';
import { SaveAsTemplate } from './save-as-template';
import { ScheduleFields } from './schedule-fields';
import { TemplatePicker } from './template-picker';
import { col, ScreenState } from './shared';

// 34px quota stepper; the ring reaches 5px past its 1px border (44x44). Minus and
// plus sit 38px apart (the count between them), so the rings never meet.
const iconSm = "flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] border border-line text-faint relative before:absolute before:-inset-[6px] before:content-['']";

// ── EVENT edit / create (pushed) ─────────────────────────────────────────────────
/** ISO instant → [date, time] local strings for the date/time inputs. */
function splitLocal(iso: string | null): [string, string] {
  const [d = '', t = ''] = isoToLocalInput(iso).split('T');
  return [d, t];
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
  const [dateStr, setDateStr] = useState('');
  const [timeStr, setTimeStr] = useState('');
  const [endDateStr, setEndDateStr] = useState('');
  const [endTimeStr, setEndTimeStr] = useState('');
  // While false, the end fields follow the start (doors + 6 h — item C1). The
  // first manual end edit claims them; an event loaded WITH an end starts
  // claimed, so a stored end is never silently rewritten.
  const [endTouched, setEndTouched] = useState(false);
  // A NEW event starts with its sign-up link on (z8uq9m0hw3, item 6): most
  // nights want requests, and an off link was the step people forgot. Edit mode
  // overwrites this with the stored value on hydrate.
  const [landingOn, setLandingOn] = useState(true);
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
  const [copyState, copy] = useCopyText();
  const copied = copyState === 'copied';
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
    setEndTouched(!!ev.endsAt);
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
  // Create-from-template: the template's own settings apply (the RPC copies
  // them), so the form shows the template's values read-only.
  const fromTemplate = isNew && !!templateId;
  const pickedTemplate = fromTemplate ? templates.data?.find((tpl) => tpl.id === templateId) : undefined;
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
        const newId = templateId
          ? await createFromTemplate.mutateAsync({ templateId, name: name.trim(), startsAt, endsAt })
          : await createEvent.mutateAsync({ venueId, name: name.trim(), startsAt, endsAt, landingActive: landingOn });
        // Save the event first, then the tiers (Max, z8uq9m0hw3 item 7): a
        // tier-less event goes straight to its guided tiers step, which ends on
        // the event detail. A template that seeded tiers skips the step and
        // lands on that same event detail (Max, PR #305 review), so both paths
        // finish in one place. `replace`, never push: Back from either lands
        // where the create flow started, not on the stale form.
        if ((pickedTemplate?.tierCount ?? 0) > 0) nav.replace('event', { id: newId });
        else nav.replace('tiers', { id: newId, setup: true });
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
    await copy(`${window.location.origin}/e/${ev.landingSlug}`);
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

        {isNew && isAdmin && (templates.data?.length ?? 0) > 0 && (
          <TemplatePicker templates={templates.data ?? []} templateId={templateId} onChange={setTemplateId} />
        )}

        {/* Venue above Name (ADE UX round, item B): the venue is the context you
            read first; the name is what you then type. Name keeps autofocus. */}
        <Label className="mb-2">{t.events.fieldVenue}</Label>
        <Field icon="building" value={venueLabel} placeholder={t.events.venuePlaceholder} className="mb-[14px]" />

        <Label className="mb-2">{t.events.fieldName}</Label>
        <Field placeholder={t.events.namePlaceholder} value={name} onChange={writable ? setName : undefined} className="mb-[14px]" />

        <ScheduleFields
          writable={writable}
          value={{ date: dateStr, time: timeStr, endDate: endDateStr, endTime: endTimeStr }}
          endTouched={endTouched}
          onEndTouchedChange={setEndTouched}
          onChange={(next) => {
            setDateStr(next.date);
            setTimeStr(next.time);
            setEndDateStr(next.endDate);
            setEndTimeStr(next.endTime);
          }}
        />

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

        {/* The label carries an "i" explainer (item D): the sign-up link is the
            one control on this screen whose consequences live on another page.
            -my-[11px] keeps the 44px button from stretching the label row. */}
        <div className="mb-[10px] flex items-center gap-1">
          <Label>{t.events.landingPage}</Label>
          <InfoTip
            className="-my-[11px]"
            label={t.events.landingInfo.aria}
            title={t.events.landingInfo.title}
            body={t.events.landingInfo.body}
            closeLabel={t.events.landingInfo.close}
          />
        </div>
        <div className="mb-[18px] rounded-[16px] border border-line bg-elev px-[14px] py-1">
          <ToggleRow
            title={t.events.landingActiveTitle}
            sub={t.events.landingActiveSub}
            // From a template: show what the new event will actually get (the
            // template's setting), still read-only (z8uq9m0hw3, item 6).
            on={fromTemplate ? pickedTemplate?.landing_active ?? false : landingOn}
            set={(v) => writable && !fromTemplate && setLandingOn(v)}
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
                  // Invisible 5px ring → 45px tap area inside the row's own padding (T1, touch).
                  "relative flex shrink-0 items-center gap-1.5 rounded-[10px] border px-3 py-[7px] font-display text-[12.5px] font-bold transition-[filter] before:absolute before:-inset-y-[5px] before:inset-x-0 before:content-[''] hover:brightness-[1.2]",
                  copied ? 'border-acc/40 bg-acc-dim text-acc' : 'border-line text-dim',
                )}
              >
                <Icon name={copied ? 'check' : 'link'} size={15} />
                {copyStateLabel(copyState, t.events.copyLinkLabel, t.events.copyLinkDone)}
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
                    {/* Anchored to the event date (item C2): an empty close date
                        opens on the night's month, not on today. */}
                    <DateField value={autoDate} anchor={dateStr} onChange={writable ? setAutoDate : undefined} />
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
