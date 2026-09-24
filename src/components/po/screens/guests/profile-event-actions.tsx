'use client';

import { type JSX, useState } from 'react';
import { cn } from '@/lib/utils';
import { usePoTiers } from '@/features/po/hooks';
import { usePoChangeGuestTier, usePoRemoveGuest } from '@/features/po/mutations';
import type { PoProfileEvent } from '@/features/po/adapters';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { profileRowActions } from '@/features/guests/permissions';
import { t, fmt } from '@/lib/i18n';
import { useNav } from '../../context';
import { Icon } from '../../icon';
import { ActionItem, Btn, Note } from '../../kit';
import { ConfirmSheet, Sheet } from '../../shell';
import { press } from './_shared';
import { PlusOnesSheet } from './profile-sheets';

// ── Per-event row actions on the person profile (Joeri walkthrough, z8uq9m0hw5) ──
// Each event card on the profile gets a "…" that opens this sheet, from ANY entry
// point (a guest list, the Guests tab, or Contacts where there is no origin
// event). What it offers comes from `profileRowActions`, a mirror of the guests
// RLS: the database still decides, and every refusal it returns (quota, tier full,
// capacity, list locked) is shown as-is. Online-only writes through the shared
// server actions; nothing here touches the door outbox (#25).

/** What a finished write tells the profile: the toast, and whether the row left the list. */
export interface RowActionDone {
  toast: string;
  removed: boolean;
}

type Step = 'menu' | 'plus' | 'tier' | 'remove';

export function EventRowActions({
  event,
  guestName,
  isOrganizer,
  onClose,
  onDone,
}: {
  event: PoProfileEvent;
  guestName: string;
  /** The viewer organizes THIS event (event_organizers). */
  isOrganizer: boolean;
  onClose: () => void;
  onDone: (done: RowActionDone) => void;
}): JSX.Element {
  const nav = useNav();
  const { roles, userId } = usePoIdentity();
  const [step, setStep] = useState<Step>('menu');
  // Lazy: only the event whose sheet is open pays for its tier list.
  const { data: tiers = [], isLoading: tiersLoading } = usePoTiers(event.eventId);
  const cp = t.guests.contactProfile;
  const po = t.guests.plusOnes;

  const actions = profileRowActions({
    viewer: { roles, userId, isOrganizer },
    event: { cancelled: event.cancelled, listLocked: event.listLocked, autoLockAt: event.autoLockAt },
    row: { addedBy: event.addedById, anonymized: event.anonymized },
    tierCount: tiersLoading ? null : tiers.length,
    nowMs: Date.now(),
  });
  // editPlusOnes is exactly "may update this row": the tier choice only adds
  // "the event has more than one tier" on top, unknown while tiers load.
  const canEdit = actions.editPlusOnes;
  const saved = (): void => onDone({ toast: t.guests.contacts.saveSuccess, removed: false });

  if (step === 'plus') {
    return (
      <PlusOnesSheet
        guestId={event.guestId}
        eventId={event.eventId}
        name={guestName}
        current={event.plusOnes}
        onClose={onClose}
        onSaved={saved}
      />
    );
  }
  if (step === 'tier') {
    return (
      <ProfileTierSheet
        eventId={event.eventId}
        guestId={event.guestId}
        currentTierId={event.tierId}
        onClose={onClose}
        onSaved={saved}
      />
    );
  }
  if (step === 'remove') {
    return (
      <RemoveGuestSheet
        event={event}
        guestName={guestName}
        onClose={onClose}
        onRemoved={() => onDone({ toast: fmt(cp.removed, { event: event.name }), removed: true })}
      />
    );
  }

  return (
    <Sheet onClose={onClose} center={false}>
      <div className="mb-1 font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">{event.name}</div>
      <div className="mb-4 text-[13px] text-faint">
        {event.dateLabel} · {guestName}
      </div>
      {actions.blockedBy === 'locked' && <Note icon="lock">{cp.lockedNote}</Note>}
      <div className="flex flex-col gap-2">
        {actions.openEvent && (
          <ActionItem
            icon="cal"
            label={cp.openEvent}
            onClick={() => nav.push(event.phase === 'past' ? 'pastevent' : 'event', { id: event.eventId })}
          />
        )}
        {actions.editPlusOnes && (
          <ActionItem
            icon="users"
            label={event.plusOnes > 0 ? fmt(po.edit, { n: event.plusOnes }) : po.add}
            onClick={() => setStep('plus')}
          />
        )}
        {actions.changeTier ? (
          <ActionItem icon="ticket" label={cp.changeTier} sub={event.tier ?? cp.tierNone} onClick={() => setStep('tier')} />
        ) : (
          // Hold the slot while the tiers load, so "Remove" doesn't jump under a finger.
          canEdit && tiersLoading && <ActionItem icon="ticket" label={cp.changeTier} sub={cp.tiersLoading} disabled onClick={() => undefined} />
        )}
        {actions.remove && <ActionItem icon="close" danger label={cp.removeFromList} onClick={() => setStep('remove')} />}
      </div>
      <Btn kind="ghost" full className="mt-3" onClick={onClose}>
        {t.guests.contacts.cancel}
      </Btn>
    </Sheet>
  );
}

/** Move the guest to another tier of THEIR event. Any refusal (tier full 45002,
 *  list locked, no rights) comes back from the database and is shown verbatim. */
export function ProfileTierSheet({
  eventId,
  guestId,
  currentTierId,
  onClose,
  onSaved,
}: {
  eventId: string;
  guestId: string;
  currentTierId: string | null;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const { data: tiers = [] } = usePoTiers(eventId);
  const changeTier = usePoChangeGuestTier(eventId);
  const [err, setErr] = useState<string | null>(null);
  const cp = t.guests.contactProfile;

  return (
    <Sheet onClose={onClose} center={false}>
      <div className="mb-1 font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">{cp.changeTier}</div>
      <div className="mb-4 text-[13px] text-faint">{cp.changeTierSub}</div>
      <div className="flex flex-col gap-2">
        {tiers.map((tier) => {
          const current = tier.id === currentTierId;
          return (
            <button
              key={tier.id}
              type="button"
              aria-pressed={current}
              disabled={changeTier.isPending}
              onClick={() => {
                if (current) return onClose();
                setErr(null);
                changeTier.mutate(
                  { guestId, tierId: tier.id },
                  {
                    onSuccess: onSaved,
                    onError: (e) => setErr(e instanceof Error ? e.message : t.guests.multiSelect.tierFailed),
                  },
                );
              }}
              className={cn(
                'flex min-h-[48px] items-center gap-[10px] rounded-[12px] border px-[13px] py-[12px] text-text',
                press,
                current ? 'border-acc bg-acc-dim' : 'border-line bg-bg',
                changeTier.isPending && 'opacity-50',
              )}
            >
              <span className="h-[10px] w-[10px] shrink-0 rounded-full" style={{ background: tier.color }} />
              <span className="flex-1 text-left font-display text-[14.5px] font-bold">{tier.name}</span>
              {current && <Icon name="check2" size={16} stroke="#B5A6FF" sw={2.4} />}
            </button>
          );
        })}
      </div>
      {err && (
        <p className="mt-2 text-[12.5px] text-red-300" role="alert">
          {err}
        </p>
      )}
      <Btn kind="ghost" full className="mt-3" onClick={onClose}>
        {t.guests.contacts.cancel}
      </Btn>
    </Sheet>
  );
}

/**
 * Confirm + soft delete (#21: status 'removed', never a hard DELETE). The copy
 * says what happens to the slots (#22 as amended 24 jun 2026): they free up,
 * unless the guest is inside (an active check-in), in which case the quota and
 * the room keep counting them. The database allows removing a checked-in guest,
 * so the UI does too; it only says so.
 */
export function RemoveGuestSheet({
  event,
  guestName,
  onClose,
  onRemoved,
}: {
  event: PoProfileEvent;
  guestName: string;
  onClose: () => void;
  onRemoved: () => void;
}): JSX.Element {
  const remove = usePoRemoveGuest(event.eventId);
  const [err, setErr] = useState<string | null>(null);
  const cp = t.guests.contactProfile;
  const slots = event.registeredHeads;
  const inside = event.presentHeads !== null;

  const run = (): void => {
    setErr(null);
    remove.mutate(event.guestId, {
      onSuccess: onRemoved,
      onError: (e) => setErr(e instanceof Error ? e.message : cp.removeFailed),
    });
  };

  return (
    <ConfirmSheet
      icon="close"
      tone="danger"
      title={fmt(cp.removeTitle, { event: event.name })}
      confirmLabel={remove.isPending ? cp.removeBusy : cp.removeConfirm}
      confirmDisabled={remove.isPending}
      onConfirm={run}
      cancelLabel={t.guests.contacts.cancel}
      onClose={onClose}
    >
      <p className="text-[13px] leading-[1.5] text-dim">
        {fmt(inside ? cp.removeBodyInside : cp.removeBody, {
          name: guestName,
          n: slots,
          slots: slots === 1 ? t.guests.plusOnes.slotOne : t.guests.plusOnes.slotMany,
        })}
      </p>
      <p className="mt-3 font-display text-[13px] font-bold text-red-300">{cp.removeIrreversible}</p>
      {err && (
        <p className="mt-3 text-[12.5px] text-red-300" role="alert">
          {err}
        </p>
      )}
    </ConfirmSheet>
  );
}
