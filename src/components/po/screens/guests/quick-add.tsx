'use client';

import { useState, useMemo } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { cn } from '@/lib/utils';
import { indexGuestsByName, planBulkAdd, type DupeMode, type BulkRowInput } from '@/features/guests/bulk-dedupe';
import {
  parseQuickAdd,
  resolveAmbiguity,
  type QuickAddTier,
  type AmbiguityChoice,
} from '@/features/guests/quick-add-parser';
import { resolveDefaultTierId } from '@/features/guests/tiers';
import { usePoEvents, usePoEventForEdit, usePoGuests, usePoTiers, usePoQuota } from '@/features/po/hooks';
import { usePoAddGuest, usePoUpdateGuest, usePoRequestExtraSlots } from '@/features/po/mutations';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { canManageGuests } from '@/features/auth/roles';
import { t, fmt } from '@/lib/i18n';
import { useNav } from '../../context';
import { Icon } from '../../icon';
import PhoneInput from 'react-phone-number-input/input';
import { isValidPhoneNumber } from 'react-phone-number-input';
import { Avatar, Btn, Empty, IconBtn, Label, MiniChip, Top, Scroll } from '../../kit';
import { BottomBar, Sheet } from '../../shell';
import { CountrySelect, type CountryCode } from '../../country-select';
import { AddTierInline, DupeOption, NoTiersBlock, press, col } from './_shared';

// ── QUICK-ADD (#33) ──────────────────────────────────────────────────────────
interface JustAdded {
  id: string;
  name: string;
  plus: number;
  tierShort: string;
  vip: boolean;
  /** True when this row updated an existing guest's plekken (dupe add/replace) rather than inserting. */
  updated?: boolean;
}

/** The fields that reset together whenever the user types a new name. */
interface QuickAddForm {
  choice: AmbiguityChoice | null;
  dupeMode: DupeMode | null;
  reqOpen: boolean;
  contactEmail: string;
  contactPhone: string | undefined;
  contactCountry: CountryCode;
  contactPhoneErr: string | null;
}

const FORM_RESET: QuickAddForm = {
  choice: null,
  dupeMode: null,
  reqOpen: false,
  contactEmail: '',
  contactPhone: undefined,
  contactCountry: 'NL',
  contactPhoneErr: null,
};

function PreviewChip({ icon, dot, label }: { icon?: Parameters<typeof Icon>[0]['name']; dot?: string; label: string }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[9px] border border-line bg-elev2 px-[11px] py-1.5 font-display text-[13px] font-bold text-text">
      {dot && <span className="h-[9px] w-[9px] rounded-full" style={{ background: dot }} />}
      {icon && <Icon name={icon} size={13} className="text-faint" />}
      {label}
    </span>
  );
}

export function QuickAdd({ eventId }: { eventId?: string }): JSX.Element {
  const nav = useNav();
  const { data: liveEvents = [] } = usePoEvents();
  const upcoming = liveEvents.filter((e) => e.when === 'upcoming');

  // Derive curEv from the user's optional override + the prop, not from a
  // state value that shadows the prop (avoids stale-init on re-navigation).
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const curEv = liveEvents.find((e) => e.id === (selectedId ?? eventId)) ?? upcoming[0] ?? liveEvents[0];
  const evId = curEv?.id ?? '';

  const { data: tiers = [] } = usePoTiers(evId);
  const { data: quota } = usePoQuota(evId);
  const add = usePoAddGuest(evId);
  const update = usePoUpdateGuest(evId);
  // The event's existing guests drive duplicate detection (S2.2). RLS-scoped, so
  // staff only match against their own guests — exactly the rows they may update.
  const { data: liveGuests = [] } = usePoGuests(evId);
  const reqExtra = usePoRequestExtraSlots(evId);
  const { roles } = usePoIdentity();
  // An external crew member (event organizer, roles:[]) may add guests to their own
  // event — they're no longer quota-exempt (86ey21vre), so the old exempt-based gate
  // missed them. canManage = admin or organizer of THIS event (RLS can_write_guests).
  const { canManage } = usePoEventForEdit(evId);

  const [val, setVal] = useState('');
  const [form, setForm] = useState<QuickAddForm>(FORM_RESET);
  const [added, setAdded] = useState<JustAdded[]>([]);
  const [evPick, setEvPick] = useState(false);
  const [reqMotiv, setReqMotiv] = useState('');

  // Destructure for ergonomic use in the render body below.
  const { choice, dupeMode, reqOpen, contactEmail, contactPhone, contactCountry, contactPhoneErr } = form;

  // Per-field setters that keep the rest of the form intact.
  const setChoice = (v: AmbiguityChoice | null) => setForm((f) => ({ ...f, choice: v }));
  const setDupeMode = (v: DupeMode | null) => setForm((f) => ({ ...f, dupeMode: v }));
  const setReqOpen = (v: boolean) => setForm((f) => ({ ...f, reqOpen: v }));
  const setContactEmail = (v: string) => setForm((f) => ({ ...f, contactEmail: v }));
  const setContactPhone = (v: string | undefined) => setForm((f) => ({ ...f, contactPhone: v }));
  const setContactCountry = (v: CountryCode) => setForm((f) => ({ ...f, contactCountry: v }));
  const setContactPhoneErr = (v: string | null) => setForm((f) => ({ ...f, contactPhoneErr: v }));

  const qaTiers: QuickAddTier[] = tiers.map((t) => ({ id: t.id, name: t.name, aliases: t.aliases }));
  const defaultTierId = resolveDefaultTierId(qaTiers);

  // Parse against the LIVE tiers with the shared #33 parser (same one the desktop
  // quick-add uses), so behaviour — fuzzy match, NL +N, ambiguity — is identical.
  const parsed = defaultTierId && val.trim() ? parseQuickAdd(val, qaTiers, defaultTierId) : null;
  const isAmbiguous = parsed?.status === 'ambiguous';
  const resolved =
    isAmbiguous && choice && parsed && defaultTierId ? resolveAmbiguity(parsed, choice, defaultTierId) : null;

  const effName = (resolved ? resolved.name : parsed?.name ?? '').trim();
  const effPlus = resolved ? resolved.plusOnes : parsed?.plusOnes ?? 0;
  // When needsTierPick fires, `choice` is set to the user's pick — so we also
  // check choice.tierId for non-ambiguous parses (bare name + multi-tier event).
  const effTierId = resolved?.tierId ?? (choice?.kind === 'tier' ? choice.tierId : undefined) ?? parsed?.tierId ?? defaultTierId ?? '';
  const effTier = tiers.find((t) => t.id === effTierId);
  const cost = 1 + effPlus;

  // Duplicate detection (S2.2): does the typed name already match a guest on this
  // event? Same name-only match + 3-choice as bulk-paste (planBulkAdd), so the
  // pattern is identical across quick + bulk. (The address book keeps its own
  // 2-choice — a known contact has no "different person, same name" case.)
  const byName = useMemo(
    () => indexGuestsByName(liveGuests.map((g) => ({ id: g.id, name: g.name, plusOnes: g.plus }))),
    [liveGuests],
  );
  const dupe = effName ? byName.get(effName.trim().toLowerCase()) ?? null : null;
  // A dupe forces an explicit choice before submit; 'again' (insert) vs add/replace (update).
  const needsDupeChoice = !!dupe && dupeMode === null;
  const willInsert = !dupe || dupeMode === 'again';

  const exempt = quota?.exempt ?? false;
  const remaining = exempt ? null : quota?.remaining ?? null;
  const overQuota = remaining !== null && cost > remaining;
  // Hide the quick-add for roles that can't create guests (user_manager/finance):
  // RLS would reject the insert with a confusing 42501, so gate the UI instead.
  // admin/staff/doorhost qualify via venue role; an event organizer (external crew)
  // via canManage (they add up to their quota — quota still gates the insert below).
  const canAdd = canManageGuests(roles) || canManage;
  const reqShortfall = remaining !== null ? Math.max(1, cost - remaining) : 1;
  const needsAsk = !!isAmbiguous && !choice;
  // Bare name on a multi-tier event: don't silently assign the default — ask which tier.
  const needsTierPick = parsed?.status === 'ok' && parsed.matchedVia === 'default' && tiers.length > 1 && !choice && !dupe;
  // Quota only gates the INSERT path; an add/replace on an existing guest is a
  // delta the DB enforces, so don't block it on the new-guest cost.
  const blockForQuota = overQuota && willInsert;

  const canSubmit = ((): boolean => {
    if (add.isPending || update.isPending) return false;
    if (!defaultTierId || !evId) return false;
    if (!effName) return false;
    if (needsAsk || needsTierPick || needsDupeChoice) return false;
    return !blockForQuota;
  })();

  const onInput = (v: string): void => {
    setVal(v);
    setForm(FORM_RESET);
    reqExtra.reset();
  };

  const commit = (): void => {
    if (!canSubmit || !effTier) return;
    // Prefer parsed email/phone from the text; fall back to the optional contact fields.
    const emailVal = parsed?.email ?? (contactEmail.trim() || undefined);
    const phoneVal = parsed?.phone ?? contactPhone ?? undefined;
    if (phoneVal && !isValidPhoneNumber(phoneVal)) {
      setContactPhoneErr(t.guests.add.contactPhoneError);
      return;
    }
    setContactPhoneErr(null);
    // Reuse the bulk planner with a single row, so quick + bulk split inserts vs
    // plus-ones updates identically. mode defaults to 'again' when there's no dupe.
    const row: BulkRowInput = {
      name: effName,
      plusOnes: effPlus,
      tierId: effTierId,
      email: emailVal,
      phone: phoneVal,
    };
    const plan = planBulkAdd([row], byName, dupeMode ?? 'again');

    // Update path: erbij optellen / nieuw aantal on the matched existing guest.
    if (plan.updates.length > 0) {
      const u = plan.updates[0];
      update.mutate(
        { guestId: u.guestId, plusOnes: u.plusOnes },
        {
          onSuccess: () => {
            setAdded((a) => [
              { id: u.guestId, name: effName, plus: u.plusOnes, tierShort: effTier.short, vip: effTier.role === 'VIP', updated: true },
              ...a,
            ]);
            setVal('');
            setForm((f) => ({ ...f, choice: null, dupeMode: null }));
          },
        },
      );
      return;
    }

    // Insert path (no dupe, or "toch opnieuw toevoegen"). Client UUIDv7 so the
    // optimistic row and the inserted row share an id (#25) — the list reconciles
    // without a flash when invalidation refetches.
    const id = uuidv7();
    const snapshot: JustAdded = { id, name: effName, plus: effPlus, tierShort: effTier.short, vip: effTier.role === 'VIP' };
    add.mutate(
      {
        id,
        eventId: evId,
        tierId: effTierId,
        fullName: effName,
        plusOnes: effPlus,
        email: emailVal,
        phone: phoneVal,
        source: 'app',
      },
      {
        onSuccess: () => {
          setAdded((a) => [snapshot, ...a]);
          setVal('');
          setForm(FORM_RESET);
        },
      },
    );
  };

  const sub = !curEv
    ? t.guests.add.subNoEvent
    : exempt
      ? t.guests.add.subUnlimited
      : remaining !== null && quota
        ? fmt(t.guests.add.subQuota, { n: remaining, m: quota.quota })
        : t.guests.add.subFallback;

  return (
    <div className={col}>
      <Top onBack={nav.back} title={t.guests.add.title} sub={sub} right={<IconBtn name="paste" onClick={() => nav.push('bulk', curEv ? { id: curEv.id } : {})} />} />
      <Scroll bottom={120}>
        <Label className="mb-2">{t.guests.add.eventLabel}</Label>
        {curEv ? (
          <button type="button" onClick={() => setEvPick(true)} className={cn('mb-4 flex w-full items-center gap-[13px] rounded-[14px] border border-line bg-elev px-[14px] py-[13px] text-left', press)}>
            <span className="w-[40px] shrink-0 text-center">
              <span className="block font-display text-[18px] font-extrabold leading-none text-text">{curEv.date}</span>
              <span className="mt-0.5 block text-[9.5px] font-bold tracking-[0.05em] text-faint">{curEv.mon}</span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-[15.5px] font-bold text-text">{curEv.name}</span>
              <span className="mt-px block text-[12.5px] text-faint">
                {fmt(t.guests.add.eventDoors, { time: curEv.time, venue: curEv.venue })}
              </span>
            </span>
            <span className="text-acc">
              <Icon name="chevD" size={18} />
            </span>
          </button>
        ) : (
          <div className="mb-4">
            <Empty text={t.guests.add.noUpcoming} />
          </div>
        )}

        {curEv && !canAdd && (
          <div className="rounded-[16px] border border-line bg-elev p-[14px] text-[13.5px] leading-[1.45] text-faint">
            {t.guests.add.noRights}
          </div>
        )}

        {curEv && canAdd && !defaultTierId && <NoTiersBlock eventId={evId} canCreate={exempt} />}

        {curEv && canAdd && defaultTierId && (
          <>
            <Label className="mb-2">{t.guests.add.inputLabel}</Label>
            <div className={cn('rounded-[16px] border bg-elev px-[15px] py-[14px] transition-colors', parsed ? 'border-acc' : 'border-line')}>
              <input
                autoFocus
                value={val}
                onChange={(e) => onInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canSubmit) commit();
                }}
                placeholder={t.guests.add.inputPlaceholder}
                className="w-full border-none bg-transparent font-display text-[18px] font-bold tracking-[-0.01em] text-text outline-none placeholder:text-faint"
              />
              {parsed && (
                <div className="mt-[13px] flex flex-wrap gap-[7px]">
                  <PreviewChip icon="user" label={effName || '—'} />
                  {effPlus > 0 && <PreviewChip icon="users" label={`+${effPlus}`} />}
                  {!needsAsk && !needsTierPick && effTier && <PreviewChip dot={effTier.color} label={effTier.short} />}
                  {needsAsk && parsed.ambiguous && (
                    <MiniChip className="border-dashed border-acc text-text">{'"'}{parsed.ambiguous.text}{'"'} ?</MiniChip>
                  )}
                </div>
              )}
              {parsed && !needsAsk && !needsTierPick && !dupe && effName && !parsed.email && !parsed.phone && (
                <div className="mt-[10px] flex flex-col gap-[8px] border-t border-white/[0.08] pt-[10px]">
                  <input
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder={t.guests.add.contactEmailPlaceholder}
                    className="w-full rounded-[10px] border border-line bg-bg px-[11px] py-[8px] text-[13px] text-text outline-none placeholder:text-faint focus:border-acc"
                  />
                  <div className={cn('flex items-center gap-[8px] rounded-[10px] border bg-bg px-[9px] py-[6px] transition-colors focus-within:border-acc', contactPhoneErr ? 'border-red-400' : 'border-line')}>
                    <CountrySelect
                      value={contactCountry}
                      onChange={(c) => {
                        setContactCountry(c);
                        setContactPhone(undefined);
                        setContactPhoneErr(null);
                      }}
                    />
                    <span className="h-4 w-px shrink-0 bg-line" />
                    <PhoneInput
                      country={contactCountry}
                      value={contactPhone}
                      onChange={(v) => { setContactPhone(v); setContactPhoneErr(null); }}
                      placeholder={t.guests.add.contactPhonePlaceholder}
                      className="min-w-0 flex-1 border-none bg-transparent text-[13px] text-text outline-none placeholder:text-faint"
                    />
                  </div>
                  {contactPhoneErr && (
                    <p className="mt-[5px] text-[11.5px] text-red-400" role="alert">{contactPhoneErr}</p>
                  )}
                </div>
              )}
            </div>

            {/* Creating tiers shouldn't be a one-shot (retest 3/7, Q12): the same
                inline form stays reachable once tiers exist. Same gate as the
                first-tier block (admin/organizer via the quota exempt flag). */}
            {exempt && !parsed && <AddTierInline eventId={evId} className="mt-3" />}

            {needsAsk && parsed?.ambiguous && (
              <div className="mt-3 rounded-[16px] bg-acc-dim p-[14px]">
                <div className="mb-[11px] text-[13.5px] leading-[1.45] text-text">
                  {fmt(t.guests.add.ambiguityQuestion, { x: parsed.ambiguous.text })}
                </div>
                <div className="flex flex-col gap-2">
                  {parsed.ambiguous.suggestions.map((s) => {
                    const tier = tiers.find((x) => x.id === s.tierId);
                    return (
                      <button key={s.tierId} type="button" onClick={() => setChoice({ kind: 'tier', tierId: s.tierId })} className={cn('flex items-center gap-[10px] rounded-[12px] border border-line bg-bg px-[13px] py-[12px] text-text', press)}>
                        <span className="h-[10px] w-[10px] rounded-full" style={{ background: tier?.color ?? '#B5A6FF' }} />
                        <span className="flex-1 text-left font-display text-[14.5px] font-bold">{s.tierName}</span>
                        <Icon name="chev" size={16} className="text-ghost" />
                      </button>
                    );
                  })}
                  <button type="button" onClick={() => setChoice({ kind: 'default' })} className={cn('flex items-center gap-[10px] rounded-[12px] border border-line bg-bg px-[13px] py-[12px] text-text', press)}>
                    <Icon name="ticket" size={15} className="text-faint" />
                    <span className="flex-1 text-left font-display text-[14.5px] font-bold">{tiers.find((x) => x.id === defaultTierId)?.short ?? t.guests.add.choiceDefault}</span>
                    <Icon name="chev" size={16} className="text-ghost" />
                  </button>
                  <button type="button" onClick={() => setChoice({ kind: 'name' })} className={cn('flex items-center gap-[10px] rounded-[12px] border border-line bg-bg px-[13px] py-[12px] text-text', press)}>
                    <Icon name="user" size={15} className="text-faint" />
                    <span className="flex-1 text-left font-display text-[14.5px] font-bold">{t.guests.add.choiceName}</span>
                    <Icon name="chev" size={16} className="text-ghost" />
                  </button>
                </div>
              </div>
            )}

            {needsTierPick && (
              <div className="mt-3 rounded-[16px] bg-acc-dim p-[14px]">
                <div className="mb-[11px] text-[13.5px] leading-[1.45] text-text">
                  {t.guests.add.tierPickQuestion}
                </div>
                <div className="flex flex-col gap-2">
                  {tiers.map((tier) => (
                    <button
                      key={tier.id}
                      type="button"
                      onClick={() => setChoice({ kind: 'tier', tierId: tier.id })}
                      className={cn('flex items-center gap-[10px] rounded-[12px] border border-line bg-bg px-[13px] py-[12px] text-text', press)}
                    >
                      <span className="h-[10px] w-[10px] rounded-full" style={{ background: tier.color }} />
                      <span className="flex-1 text-left font-display text-[14.5px] font-bold">{tier.name}</span>
                      <Icon name="chev" size={16} className="text-ghost" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!needsAsk && dupe && (
              <div className="mt-3 rounded-[16px] border border-acc bg-acc-dim p-[14px]">
                <div className="mb-1 flex items-center gap-2">
                  <Icon name="warn" size={16} stroke="#B5A6FF" />
                  <Label className="text-acc-soft">{t.guests.add.dupeTitle}</Label>
                </div>
                <div className="mb-3 text-[12.5px] leading-[1.45] text-text">
                  <b>{dupe.name}</b>
                  {dupe.plusOnes > 0 ? (
                    <>
                      {t.guests.add.dupeOnListWith}
                      <b>+{dupe.plusOnes}</b>
                      {fmt(t.guests.add.dupeOnListSlots, { slots: dupe.plusOnes === 1 ? t.guests.add.slotOne : t.guests.add.slotMany })}
                    </>
                  ) : (
                    t.guests.add.dupeOnListNoExtra
                  )}
                  {t.guests.add.dupeWhatToDo}
                </div>
                <div className="flex flex-col gap-1.5">
                  <DupeOption on={dupeMode === 'add'} onClick={() => setDupeMode('add')} title={t.guests.add.dupeAddTitle} sub={fmt(t.guests.add.dupeAddSub, { total: dupe.plusOnes + effPlus, current: dupe.plusOnes })} />
                  <DupeOption on={dupeMode === 'replace'} onClick={() => setDupeMode('replace')} title={t.guests.add.dupeReplaceTitle} sub={fmt(t.guests.add.dupeReplaceSub, { n: effPlus, current: dupe.plusOnes })} />
                  <DupeOption on={dupeMode === 'again'} onClick={() => setDupeMode('again')} title={t.guests.add.dupeAgainTitle} sub={t.guests.add.dupeAgainSub} />
                </div>
              </div>
            )}

            {parsed && !needsAsk && !dupe && !exempt && remaining !== null && (
              <div className={cn('mt-3 flex items-center gap-[9px] rounded-[13px] px-[14px] py-[11px]', overQuota ? 'border border-acc bg-white/[0.04]' : 'border border-line bg-elev')}>
                <Icon name="ticket" size={17} stroke={overQuota ? '#B5A6FF' : 'rgba(255,255,255,0.40)'} />
                <span className="flex-1 text-[13.5px] text-text">
                  {fmt(t.guests.add.quotaCost, { cost, slots: cost === 1 ? t.guests.add.slotOne : t.guests.add.slotMany })}
                  {overQuota
                    ? fmt(t.guests.add.quotaOver, { remaining, over: cost - remaining })
                    : fmt(t.guests.add.quotaLeftAfter, { left: remaining - cost })}
                </span>
                {overQuota && <MiniChip className="border-acc text-acc">{t.guests.add.quotaFull}</MiniChip>}
              </div>
            )}

            {!dupe && overQuota && parsed && !needsAsk ? (
              reqExtra.isSuccess ? (
                <div className="mt-[10px] flex items-center gap-[9px] rounded-[13px] border border-acc bg-acc-dim px-[14px] py-[11px] text-[13px] text-text">
                  <Icon name="check" size={16} stroke="#B5A6FF" />
                  <span className="flex-1">{t.guests.add.requestSent}</span>
                </div>
              ) : reqOpen ? (
                <div className="mt-[10px] flex flex-col gap-[10px] rounded-[16px] border border-line bg-elev p-[14px]">
                  <Label>
                    {fmt(t.guests.add.requestExtraLabel, { n: reqShortfall, slots: reqShortfall === 1 ? t.guests.add.slotOne : t.guests.add.slotMany })}
                  </Label>
                  <textarea
                    autoFocus
                    value={reqMotiv}
                    onChange={(e) => setReqMotiv(e.target.value)}
                    maxLength={500}
                    rows={2}
                    placeholder={t.guests.add.requestMotivPlaceholder}
                    className="w-full resize-none rounded-[12px] border border-line bg-bg px-[13px] py-[11px] text-[14px] text-text outline-none placeholder:text-faint focus:border-acc"
                  />
                  {reqExtra.isError && (
                    <p className="text-[12.5px] text-acc" role="alert">
                      {reqExtra.error?.message ?? t.guests.add.requestSendFailed}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Btn
                      kind="primary"
                      icon="check"
                      className={cn((reqExtra.isPending || reqMotiv.trim() === '') && 'opacity-[0.45]')}
                      disabled={reqExtra.isPending || reqMotiv.trim() === ''}
                      onClick={() =>
                        reqExtra.mutate({
                          eventId: evId,
                          requestedExtra: reqShortfall,
                          motivation: reqMotiv.trim(),
                        })
                      }
                    >
                      {reqExtra.isPending ? t.guests.add.sending : t.guests.add.send}
                    </Btn>
                    <Btn
                      kind="ghost"
                      onClick={() => {
                        setReqOpen(false);
                        setReqMotiv('');
                      }}
                    >
                      {t.guests.add.cancel}
                    </Btn>
                  </div>
                </div>
              ) : (
                <Btn kind="ghost" full icon="plus" className="mt-[10px]" onClick={() => setReqOpen(true)}>
                  {t.guests.add.requestExtra}
                </Btn>
              )
            ) : null}

            {add.isError && (
              <div className="mt-3 flex items-center gap-[9px] rounded-[13px] border border-acc bg-acc-dim px-[14px] py-[11px] text-[13px] text-text">
                <Icon name="warn" size={16} stroke="#B5A6FF" />
                <span className="flex-1">{add.error?.message}</span>
              </div>
            )}

            {added.length > 0 && (
              <>
                <Label className="mx-0.5 mb-[10px] mt-[22px]">{fmt(t.guests.add.justAdded, { n: added.length })}</Label>
                <div className="flex flex-col gap-2">
                  {added.map((g) => (
                    <div key={g.id} className="flex items-center gap-[11px] rounded-[14px] border border-line bg-elev p-[11px]">
                      <Avatar name={g.name} size={36} accent={g.vip} />
                      <div className="min-w-0 flex-1">
                        <div className="font-display text-[14.5px] font-bold text-text">
                          {g.name}
                          {g.plus > 0 && <span className="text-faint"> +{g.plus}</span>}
                        </div>
                        <div className="mt-0.5 text-[11.5px] text-faint">{g.tierShort}</div>
                      </div>
                      <span className="inline-flex items-center gap-[5px] font-body text-[11.5px] font-bold text-acc">
                        <Icon name="check2" size={13} stroke="#B5A6FF" sw={2.4} />
                        {g.updated ? t.guests.add.chipUpdated : t.guests.add.chipOnList}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </Scroll>
      <BottomBar>
        <Btn kind="primary" full icon="plus" onClick={commit} className={canSubmit ? '' : 'opacity-[0.45]'}>
          {add.isPending || update.isPending
            ? t.guests.add.submitBusy
            : !parsed
              ? t.guests.add.submitTypeName
              : dupe && (dupeMode === 'add' || dupeMode === 'replace')
                ? fmt(t.guests.add.submitUpdate, { name: effName })
                : fmt(t.guests.add.submitAdd, { name: effName || t.guests.add.submitFallbackName, plus: effPlus ? ' +' + effPlus : '' })}
        </Btn>
      </BottomBar>

      {evPick && (
        <Sheet onClose={() => setEvPick(false)} center={false}>
          <div className="mb-1 font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">{t.guests.add.pickEventTitle}</div>
          <div className="mb-4 text-[13px] text-faint">{t.guests.add.pickEventSub}</div>
          <div className="flex flex-col gap-2">
            {upcoming.map((e) => {
              const on = e.id === curEv?.id;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(e.id);
                    setEvPick(false);
                  }}
                  className={cn('flex items-center gap-[12px] rounded-[12px] border px-[13px] py-[12px] text-left', on ? 'border-transparent bg-acc-dim' : 'border-line bg-elev', press)}
                >
                  <span className="w-[38px] shrink-0 text-center">
                    <span className="block font-display text-[16px] font-extrabold leading-none text-text">{e.date}</span>
                    <span className="block text-[9px] font-bold tracking-[0.05em] text-faint">{e.mon}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-[14.5px] font-bold text-text">{e.name}</span>
                    <span className="block text-[11.5px] text-faint">{e.venue}</span>
                  </span>
                  {on && <Icon name="check2" size={17} stroke="#B5A6FF" sw={2.4} />}
                </button>
              );
            })}
          </div>
        </Sheet>
      )}
    </div>
  );
}
