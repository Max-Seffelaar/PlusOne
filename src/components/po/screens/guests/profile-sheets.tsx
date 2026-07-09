'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import type { ContactRole } from '@/features/contacts/schemas';
import { resolveDefaultTierId } from '@/features/guests/tiers';
import { usePoEvents, usePoTiers, usePoQuota, usePoGuests } from '@/features/po/hooks';
import {
  usePoToggleContactPermanent,
  usePoAddContactToEvent,
  usePoUpsertContact,
  usePoForgetContact,
  usePoChangeGuestTier,
  usePoUpdateGuest,
  usePoPromoteGuestToContact,
} from '@/features/po/mutations';
import type { PoContact } from '@/features/po/adapters';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { venueCapabilities } from '@/features/venues/access';
import { t, fmt } from '@/lib/i18n';
import { Icon } from '../../icon';
import PhoneInput from 'react-phone-number-input/input';
import { isValidPhoneNumber, parsePhoneNumber } from 'react-phone-number-input';
import { Avatar, Btn, Empty, Field, Label, Note, Stepper } from '../../kit';
import { ConfirmSheet, Sheet } from '../../shell';
import { CountrySelect, type CountryCode } from '../../country-select';
import { NoTiersBlock, press } from './_shared';

// ── Shared sub-sheets + helpers for the guests profile screens ──────────────
// (Contacten / ContactProfile in ./profile.tsx). Split out of profile.tsx to
// keep that file under the 800-LOC guidance (FE-5) — no behavior change.

const CONTACT_ROLE_OPTIONS: { value: ContactRole; label: string }[] = [
  { value: 'vip', label: t.guests.contacts.roleVip },
  { value: 'all_access', label: t.guests.contacts.roleAllAccess },
  { value: 'artist', label: t.guests.contacts.roleArtist },
  { value: 'press', label: t.guests.contacts.rolePress },
  { value: 'crew', label: t.guests.contacts.roleCrew },
  { value: 'guest', label: t.guests.contacts.roleGuest },
];

/** Derive the CountryCode from a stored E.164 phone string; falls back to NL. */
function countryFromE164(phone: string | null | undefined): CountryCode {
  if (!phone) return 'NL';
  try { return (parsePhoneNumber(phone)?.country as CountryCode | undefined) ?? 'NL'; }
  catch { return 'NL'; }
}

/** Promote a name-only guest into a contact: add an e-mail/phone (the dedup key)
 *  and the widened auto-link trigger (20260624170000) creates + links the contact
 *  on the guest update. Editing just the name is allowed too (no promote). */
export function PromoteSheet({
  guestId,
  eventId,
  defaultName,
  defaultEmail,
  defaultPhone,
  onClose,
  onSaved,
}: {
  guestId: string;
  eventId: string;
  defaultName: string;
  defaultEmail: string | null;
  defaultPhone: string | null;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const update = usePoUpdateGuest(eventId);
  const promote = usePoPromoteGuestToContact(eventId);
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail ?? '');
  const [phone, setPhone] = useState<string | undefined>(defaultPhone ?? undefined);
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>(() => countryFromE164(defaultPhone));
  const [err, setErr] = useState<string | null>(null);

  const canSave = name.trim() !== '';
  const busy = update.isPending || promote.isPending;
  const save = (): void => {
    setErr(null);
    if (name.trim() === '') return setErr(t.guests.contacts.nameRequired);
    const hasContact = email.trim() !== '' || !!phone;
    if (hasContact) {
      // Has a dedup key — updateGuest triggers the auto-link (20260624170000).
      let phoneVal: string | undefined;
      if (phone) {
        if (!isValidPhoneNumber(phone)) return setErr(t.guests.contacts.phoneInvalid);
        phoneVal = phone; // PhoneInput gives E.164 directly
      }
      update.mutate(
        { guestId, fullName: name.trim(), email: email.trim() || undefined, phone: phoneVal },
        { onSuccess: onSaved, onError: (e) => setErr(e instanceof Error ? e.message : t.guests.contacts.saveFailed) },
      );
    } else {
      // Name-only: use the SECURITY DEFINER RPC that creates a name-only contact.
      promote.mutate(
        { guestId },
        { onSuccess: onSaved, onError: (e) => setErr(e instanceof Error ? e.message : t.guests.contacts.saveFailed) },
      );
    }
  };

  return (
    <Sheet onClose={onClose} center={false}>
      <div className="mb-1 font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">{t.guests.contactProfile.promoteTitle}</div>
      <div className="mb-4 text-[13px] text-faint">{t.guests.contactProfile.promoteSub}</div>
      <Label className="mb-2">{t.guests.contacts.nameLabel}</Label>
      <Field icon="user" value={name} onChange={setName} placeholder={t.guests.contacts.namePlaceholder} className="mb-[14px]" />
      <Label className="mb-2">{t.guests.contacts.emailLabel}</Label>
      <Field icon="mail" value={email} onChange={setEmail} inputMode="email" placeholder={t.guests.contacts.emailPlaceholder} className="mb-[14px]" />
      <Label className="mb-2">{t.guests.contacts.phoneLabel}</Label>
      <div className="mb-[14px] flex items-center gap-[11px] rounded-[14px] border border-line bg-elev px-[11px] py-[13px] transition-colors focus-within:border-acc">
        <CountrySelect value={phoneCountry} onChange={(c) => { setPhoneCountry(c); setPhone(undefined); }} />
        <span className="h-5 w-px shrink-0 bg-line" />
        <PhoneInput country={phoneCountry} value={phone} onChange={setPhone} placeholder={t.guests.contacts.phonePlaceholder} className="min-w-0 flex-1 border-none bg-transparent font-body text-[16px] text-text outline-none placeholder:text-faint" />
      </div>
      <Note icon="contact">{t.guests.contactProfile.promoteHint}</Note>
      {err && (
        <p className="mt-1 text-[12.5px] text-red-300" role="alert">
          {err}
        </p>
      )}
      <Btn kind="primary" full icon="check" className="mt-2" disabled={busy || !canSave} onClick={save}>
        {busy ? t.guests.contacts.saving : t.guests.contactProfile.promoteSave}
      </Btn>
      <Btn kind="ghost" full className="mt-2" onClick={onClose}>
        {t.guests.contacts.cancel}
      </Btn>
    </Sheet>
  );
}

/** A pill toggle for the role picker in the edit sheet. */
function RolePill({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('rounded-[10px] border px-[13px] py-[8px] font-display text-[13px] font-bold', press, on ? 'border-transparent bg-acc text-on-acc' : 'border-line bg-elev text-dim')}
    >
      {label}
    </button>
  );
}

/** Edit a contact's name / e-mail / phone / preferred tier by hand (#8). The
 *  upsert is a full overwrite, so birthdate + note are carried through unchanged. */
export function ContactEditSheet({
  contact,
  onClose,
  onSaved,
  onForget,
}: {
  contact: PoContact;
  onClose: () => void;
  onSaved: () => void;
  onForget: (c: PoContact) => void;
}): JSX.Element {
  const { venueId, roles } = usePoIdentity();
  const canForget = venueCapabilities(roles).forgetContact;
  const upsert = usePoUpsertContact();
  const [name, setName] = useState(contact.name);
  const [email, setEmail] = useState(contact.email ?? '');
  const [phone, setPhone] = useState<string | undefined>(contact.phone ?? undefined);
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>(() => countryFromE164(contact.phone));
  const [role, setRole] = useState<ContactRole | ''>(contact.preferredRole ?? '');
  const [err, setErr] = useState<string | null>(null);

  const save = (): void => {
    setErr(null);
    if (!venueId) return setErr(t.guests.contacts.noVenue);
    if (name.trim() === '') return setErr(t.guests.contacts.nameRequired);
    let phoneVal: string | undefined;
    if (phone) {
      if (!isValidPhoneNumber(phone)) return setErr(t.guests.contacts.phoneInvalid);
      phoneVal = phone; // PhoneInput gives E.164 directly
    }
    upsert.mutate(
      {
        id: contact.id,
        venueId,
        fullName: name.trim(),
        email: email.trim() || undefined,
        phone: phoneVal,
        birthdate: contact.birthdate ?? undefined,
        note: contact.note ?? undefined,
        preferredRole: role || undefined,
      },
      { onSuccess: onSaved, onError: (e) => setErr(e instanceof Error ? e.message : t.guests.contacts.saveFailed) },
    );
  };

  return (
    <Sheet onClose={onClose} center={false}>
      <div className="mb-4 flex items-center gap-[12px]">
        <Avatar name={name || contact.name} size={44} accent={contact.vast} />
        <div className="min-w-0 flex-1">
          <div className="font-display text-[17px] font-bold text-text">{t.guests.contacts.editTitle}</div>
          <div className="text-[12px] text-faint">{fmt(t.guests.contacts.onListCount, { n: contact.events })}</div>
        </div>
      </div>
      <Label className="mb-2">{t.guests.contacts.nameLabel}</Label>
      <Field icon="user" value={name} onChange={setName} placeholder={t.guests.contacts.namePlaceholder} className="mb-[14px]" />
      <Label className="mb-2">{t.guests.contacts.emailLabel}</Label>
      <Field icon="mail" value={email} onChange={setEmail} inputMode="email" placeholder={t.guests.contacts.emailPlaceholder} className="mb-[14px]" />
      <Label className="mb-2">{t.guests.contacts.phoneLabel}</Label>
      <div className="mb-[14px] flex items-center gap-[11px] rounded-[14px] border border-line bg-elev px-[11px] py-[13px] transition-colors focus-within:border-acc">
        <CountrySelect value={phoneCountry} onChange={(c) => { setPhoneCountry(c); setPhone(undefined); }} />
        <span className="h-5 w-px shrink-0 bg-line" />
        <PhoneInput country={phoneCountry} value={phone} onChange={setPhone} placeholder={t.guests.contacts.phonePlaceholder} className="min-w-0 flex-1 border-none bg-transparent font-body text-[16px] text-text outline-none placeholder:text-faint" />
      </div>
      <Label className="mb-2">{t.guests.contacts.tierLabel}</Label>
      <div className="flex flex-wrap gap-2">
        <RolePill label={t.guests.contacts.tierNone} on={role === ''} onClick={() => setRole('')} />
        {CONTACT_ROLE_OPTIONS.map((o) => (
          <RolePill key={o.value} label={o.label} on={role === o.value} onClick={() => setRole(o.value)} />
        ))}
      </div>
      {err && (
        <p className="mt-3 text-[12.5px] text-red-300" role="alert">
          {err}
        </p>
      )}
      <Btn kind="primary" full icon="check" className="mt-4" disabled={upsert.isPending || name.trim() === ''} onClick={save}>
        {upsert.isPending ? t.guests.contacts.saving : t.guests.contacts.save}
      </Btn>
      {canForget && (
        <button
          type="button"
          onClick={() => onForget(contact)}
          className={cn(
            'mt-[10px] flex w-full items-center justify-center gap-2 rounded-[13px] border border-red-500/25 bg-red-500/[0.05] py-[11px] font-display text-[13px] font-bold text-red-300',
            press,
          )}
        >
          <Icon name="shield" size={15} stroke="currentColor" />
          {t.guests.contacts.forget}
        </button>
      )}
      <Btn kind="ghost" full className="mt-2" onClick={onClose}>
        {t.guests.contacts.cancel}
      </Btn>
    </Sheet>
  );
}

/** Confirm + execute an on-request erasure ("vergeet mij", AVG art. 17 / #29).
 *  Admin-only (the entry button is capability-gated). No MFA step-up — admin is an
 *  MFA-mandatory role, so the action stays frictionless. Irreversible, so the
 *  destructive confirm spells it out. forget_contact re-checks admin server-side. */
export function ForgetConfirmSheet({ contact, onClose }: { contact: PoContact; onClose: () => void }): JSX.Element {
  const forget = usePoForgetContact();
  const [err, setErr] = useState<string | null>(null);

  const run = (): void => {
    setErr(null);
    forget.mutate(
      { contactId: contact.id },
      {
        onSuccess: onClose,
        onError: (e) => setErr(e instanceof Error ? e.message : t.guests.contacts.forgetFailed),
      },
    );
  };

  return (
    <ConfirmSheet
      icon="warn"
      tone="danger"
      title={fmt(t.guests.contacts.forgetTitle, { name: contact.name })}
      confirmIcon="shield"
      confirmLabel={forget.isPending ? t.guests.contacts.forgetBusy : t.guests.contacts.forgetConfirm}
      confirmDisabled={forget.isPending}
      onConfirm={run}
      cancelLabel={t.guests.contacts.cancel}
      onClose={onClose}
    >
      <p className="text-[13px] leading-[1.5] text-dim">
        {fmt(t.guests.contacts.forgetBody, { name: contact.name })}
      </p>
      {contact.vast && <Note icon="star">{t.guests.contacts.forgetPermanentWarn}</Note>}
      <p className="mt-3 font-display text-[13px] font-bold text-red-300">{t.guests.contacts.forgetIrreversible}</p>
      {err && (
        <p className="mt-3 text-[12.5px] text-red-300" role="alert">
          {err}
        </p>
      )}
    </ConfirmSheet>
  );
}

/** Confirm before marking a contact permanent — they land on every NEW list (#11). */
export function PermanentConfirmSheet({ contact, onClose }: { contact: PoContact; onClose: () => void }): JSX.Element {
  const toggle = usePoToggleContactPermanent();
  return (
    <ConfirmSheet
      icon="star"
      iconFilled
      title={fmt(t.guests.contacts.makeRegularTitle, { name: contact.name })}
      confirmLabel={toggle.isPending ? t.guests.contacts.makeRegularBusy : t.guests.contacts.makeRegularConfirm}
      confirmDisabled={toggle.isPending}
      onConfirm={() => toggle.mutate({ contactId: contact.id, isPermanent: true }, { onSuccess: onClose })}
      cancelLabel={t.guests.contacts.cancel}
      onClose={onClose}
    >
      <Note icon="star">
        <b>{contact.name}</b> {fmt(t.guests.contacts.makeRegularNote, { new: t.guests.contacts.makeRegularNoteNew })}
      </Note>
    </ConfirmSheet>
  );
}

/** Pick an event + ticket (tier) and add the contact to that gastenlijst (Q9). The
 *  in-context event is pre-selected; with a single event you just pick a ticket. */
export function AddToEventSheet({
  contact,
  eventId,
  upcoming,
  onClose,
  onAdded,
}: {
  contact: PoContact;
  eventId?: string;
  upcoming: ReturnType<typeof usePoEvents>['data'] extends (infer E)[] | undefined ? E[] : never;
  onClose: () => void;
  onAdded: (id: string) => void;
}): JSX.Element {
  const add = usePoAddContactToEvent();
  const [evId, setEvId] = useState<string>(eventId && upcoming.some((e) => e.id === eventId) ? eventId : upcoming[0]?.id ?? '');
  const { data: tiers = [], isLoading: tiersLoading } = usePoTiers(evId);
  // Only an admin/organizer may create a tier (guest_tiers_insert RLS, surfaced via
  // the quota exempt flag) — finance can open the address book but not make tiers.
  const { data: quota } = usePoQuota(evId);
  const canCreateTier = quota?.exempt ?? false;
  // Is this contact already a live (non-removed) guest on the selected event? We
  // reuse the event's guest list (RLS-scoped) rather than a separate query, so the
  // existing add/update invalidations keep it fresh.
  const { data: evGuests = [], isLoading: guestsLoading } = usePoGuests(evId);
  const onList = evGuests.find((g) => g.contactId === contact.id) ?? null;
  const update = usePoUpdateGuest(evId);
  const changeTier = usePoChangeGuestTier(evId);

  const [tierId, setTierId] = useState<string>('');
  const [plus, setPlus] = useState(0); // new guest: extra plekken (total = 1 + plus)
  const [mode, setMode] = useState<'add' | 'set'>('add'); // already-on-list choice
  const [amount, setAmount] = useState(1); // already-on-list: the number for the chosen mode
  const [err, setErr] = useState<string | null>(null);

  // Default the ticket to the event's default (or first) whenever the tiers load.
  useEffect(() => {
    if (tiers.length === 0) {
      setTierId('');
      return;
    }
    if (!tiers.some((t) => t.id === tierId)) {
      const def = resolveDefaultTierId(tiers.map((t) => ({ id: t.id, name: t.name, aliases: t.aliases })));
      setTierId(def ?? tiers[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiers]);

  // Already on this event → seed the ticket picker with their CURRENT tier, so the
  // sheet can also change it (feedback 1/7: change tier straight from add-to-event).
  useEffect(() => {
    if (onList?.tierId) setTierId(onList.tierId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onList?.id]);

  const busy = add.isPending || update.isPending || changeTier.isPending;
  const finishOk = (): void => onAdded(contact.id);

  // New guest on this event: ticket + plus-ones via add_contact_to_event.
  const submitNew = (): void => {
    setErr(null);
    if (!evId) return setErr(t.guests.contacts.pickEvent);
    add.mutate(
      { contactId: contact.id, eventId: evId, tierId: tierId || undefined, plusOnes: plus || undefined },
      { onSuccess: finishOk, onError: (e) => setErr(e instanceof Error ? e.message : t.guests.contacts.addFailed) },
    );
  };

  // Already on this event: never silently no-op — set a new plus-ones total or add
  // to the existing count (the user's choice), via a plain guest update.
  const finalPlus = onList ? (mode === 'add' ? onList.plus + amount : amount) : 0;
  const tierChanged = !!onList && !!tierId && tierId !== onList.tierId;
  const submitAdjust = async (): Promise<void> => {
    if (!onList) return;
    setErr(null);
    try {
      // Change the tier first (if picked a different one), then the +N total.
      if (tierChanged) await changeTier.mutateAsync({ guestId: onList.id, tierId });
      await update.mutateAsync({ guestId: onList.id, plusOnes: finalPlus });
      finishOk();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.guests.contacts.saveFailed);
    }
  };

  const switchMode = (m: 'add' | 'set'): void => {
    setMode(m);
    setAmount(m === 'set' ? onList?.plus ?? 0 : 1);
  };

  return (
    <Sheet onClose={onClose} center={false}>
      <div className="mb-1 font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">{fmt(t.guests.contacts.addTitle, { name: contact.name })}</div>
      <div className="mb-4 text-[13px] text-faint">{onList ? t.guests.contacts.addPickEvent : t.guests.contacts.addPickEventTicket}</div>

      {upcoming.length === 0 ? (
        <Empty text={t.guests.contacts.addNoUpcoming} />
      ) : (
        <>
          <Label className="mb-2">{t.guests.contacts.eventLabel}</Label>
          <div className="mb-4 flex flex-col gap-2">
            {upcoming.map((e) => {
              const on = e.id === evId;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setEvId(e.id)}
                  className={cn('flex items-center gap-[12px] rounded-[12px] border px-[13px] py-[11px] text-left', press, on ? 'border-transparent bg-acc-dim' : 'border-line bg-elev')}
                >
                  <span className="w-[36px] shrink-0 text-center">
                    <span className="block font-display text-[16px] font-extrabold leading-none text-text">{e.date}</span>
                    <span className="block text-[9px] font-bold tracking-[0.05em] text-faint">{e.mon}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-[14px] font-bold text-text">{e.name}</span>
                    <span className="block text-[11px] text-faint">{e.venue}</span>
                  </span>
                  {on && <Icon name="check2" size={16} stroke="#B5A6FF" sw={2.4} />}
                </button>
              );
            })}
          </div>

          {guestsLoading ? (
            <div className="mb-3 text-[12.5px] text-faint">{t.guests.contacts.checkingList}</div>
          ) : onList ? (
            // Already on this event — choose: add to, or replace, the plus-ones.
            <>
              <Note icon="user">
                <b>{contact.name}</b>
                {onList.plus > 0 ? (
                  <>
                    {t.guests.contacts.dupePrefix}
                    <b>+{onList.plus}</b>
                    {fmt(t.guests.contacts.dupeSlots, { slots: onList.plus === 1 ? t.guests.contacts.slotOne : t.guests.contacts.slotMany })}
                  </>
                ) : (
                  t.guests.contacts.onListNoExtra
                )}
                {t.guests.contacts.dupeSuffix}
              </Note>
              {tiers.length > 1 && (
                <>
                  <Label className="mb-2">{t.guests.contacts.ticketLabel}</Label>
                  <div className="mb-3 flex flex-wrap gap-2">
                    {tiers.map((tier) => {
                      const on = tier.id === tierId;
                      return (
                        <button
                          key={tier.id}
                          type="button"
                          onClick={() => setTierId(tier.id)}
                          className={cn('inline-flex items-center gap-[7px] rounded-[11px] border px-[12px] py-[9px] font-display text-[13px] font-bold', press, on ? 'border-transparent bg-acc text-on-acc' : 'border-line bg-elev text-text')}
                        >
                          <span className="h-[9px] w-[9px] rounded-full" style={{ background: tier.color }} />
                          {tier.short}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
              <Label className="mb-2">{t.guests.contacts.whatToDo}</Label>
              <div className="mb-3 flex gap-2">
                <RolePill label={t.guests.contacts.modeAdd} on={mode === 'add'} onClick={() => switchMode('add')} />
                <RolePill label={t.guests.contacts.modeSet} on={mode === 'set'} onClick={() => switchMode('set')} />
              </div>
              <div className="mb-1 flex items-center justify-between gap-[14px] rounded-[16px] bg-acc-dim p-[10px]">
                <button type="button" onClick={() => setAmount((a) => Math.max(0, a - 1))} aria-label={t.guests.contacts.stepperLess} className={cn('flex h-[46px] w-[46px] items-center justify-center rounded-[14px] border border-line bg-elev2 text-text', press)}>
                  <Icon name="minus" size={20} sw={2.4} />
                </button>
                <div className="text-center">
                  <div className="font-display text-[28px] font-extrabold leading-none text-text">{amount}</div>
                  <div className="mt-0.5 text-[11px] text-dim">{mode === 'add' ? t.guests.contacts.stepperAddSuffix : t.guests.contacts.stepperTotalSuffix}</div>
                </div>
                <button type="button" onClick={() => setAmount((a) => a + 1)} aria-label={t.guests.contacts.stepperMore} className={cn('flex h-[46px] w-[46px] items-center justify-center rounded-[14px] border border-line bg-elev2 text-text', press)}>
                  <Icon name="plus" size={20} sw={2.4} stroke="#B5A6FF" />
                </button>
              </div>
              <div className="mb-3 px-1 text-[12px] text-faint">
                {t.guests.contacts.becomesPrefix}<b className="text-text">+{finalPlus}</b>{fmt(t.guests.contacts.becomesSuffix, { slots: finalPlus === 1 ? t.guests.contacts.slotOne : t.guests.contacts.slotMany })}
                {mode === 'add' && amount > 0 ? fmt(t.guests.contacts.becomesWas, { n: onList.plus }) : ''}.
              </div>
              {err && (
                <p className="mt-1 text-[12.5px] text-red-300" role="alert">
                  {err}
                </p>
              )}
              <Btn kind="primary" full icon="check" className="mt-2" disabled={busy} onClick={() => void submitAdjust()}>
                {busy ? t.guests.contacts.saving : fmt(t.guests.contacts.adjustSave, { n: finalPlus })}
              </Btn>
            </>
          ) : (
            // New on this event — pick a ticket + how many people.
            <>
              <Label className="mb-2">{t.guests.contacts.ticketLabel}</Label>
              {tiersLoading ? (
                <div className="mb-3 text-[12.5px] text-faint">{t.guests.contacts.loadingTickets}</div>
              ) : tiers.length === 0 ? (
                <NoTiersBlock eventId={evId} canCreate={canCreateTier} className="mb-3" />
              ) : (
                <div className="mb-3 flex flex-wrap gap-2">
                  {tiers.map((tier) => {
                    const on = tier.id === tierId;
                    return (
                      <button
                        key={tier.id}
                        type="button"
                        onClick={() => setTierId(tier.id)}
                        className={cn('inline-flex items-center gap-[7px] rounded-[11px] border px-[12px] py-[9px] font-display text-[13px] font-bold', press, on ? 'border-transparent bg-acc text-on-acc' : 'border-line bg-elev text-text')}
                      >
                        <span className="h-[9px] w-[9px] rounded-full" style={{ background: tier.color }} />
                        {tier.short}
                      </button>
                    );
                  })}
                </div>
              )}

              <Label className="mb-2">{t.guests.contacts.peopleLabel}</Label>
              <div className="mb-1">
                <Stepper value={1 + plus} onChange={(v) => setPlus(Math.max(0, v - 1))} />
              </div>
              <div className="mb-3 px-1 text-[12px] text-faint">
                {plus === 0 ? t.guests.contacts.peopleOnlyGuest : fmt(t.guests.contacts.peopleWithExtra, { name: contact.name, n: plus, slots: plus === 1 ? t.guests.contacts.slotOne : t.guests.contacts.slotMany, total: 1 + plus })}
              </div>

              {err && (
                <p className="mt-1 text-[12.5px] text-red-300" role="alert">
                  {err}
                </p>
              )}
              <Btn kind="primary" full icon="plus" className="mt-2" disabled={busy || !evId || tiers.length === 0} onClick={submitNew}>
                {add.isPending ? t.guests.contacts.addBusy : plus > 0 ? fmt(t.guests.contacts.addPeople, { n: 1 + plus }) : t.guests.contacts.addToGuestList}
              </Btn>
            </>
          )}
        </>
      )}
      <Btn kind="ghost" full className="mt-3" onClick={onClose}>
        {t.guests.contacts.cancel}
      </Btn>
    </Sheet>
  );
}
