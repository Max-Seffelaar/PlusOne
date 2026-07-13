'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { usePoEvents, usePoContacts, usePoPersonProfile, usePoTiers } from '@/features/po/hooks';
import { usePoToggleContactPermanent, usePoChangeGuestTier } from '@/features/po/mutations';
import type { PoContact, PoProfileEvent, PoProfileTimelineItem, ContactTimelineKind } from '@/features/po/adapters';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { isDoorOnlyRole } from '@/features/auth/roles';
import { t, fmt } from '@/lib/i18n';
import { useNav } from '../../context';
import { Icon, type IconName } from '../../icon';
import { Avatar, Btn, Empty, Field, IconBtn, Label, Loading, MiniChip, Note, Scroll, Top } from '../../kit';
import { Sheet, Toast } from '../../shell';
import { TierPill, press, col } from './_shared';
import { useGuestSelection, BulkAddToEventSheet, type BulkAddCandidate } from './bulk-add';
import {
  PromoteSheet,
  ContactEditSheet,
  ForgetConfirmSheet,
  PermanentConfirmSheet,
  AddToEventSheet,
} from './profile-sheets';

// ── GUEST detail / check-in log row ─────────────────────────────────────────
function LogRow({ icon, label, who, when, accent, last }: { icon: IconName; label: string; who: string; when?: string; accent?: boolean; last?: boolean }): JSX.Element {
  return (
    <div className={cn('flex items-center gap-[12px] py-[12px]', last ? '' : 'border-b border-line2')}>
      <span className={cn('flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px]', accent ? 'bg-acc-dim text-acc' : 'bg-elev2 text-dim')}>
        <Icon name={icon} size={15} sw={2} />
      </span>
      <span className="flex-1 text-[13.5px] text-faint">{label}</span>
      <span className="text-right">
        <span className={cn('text-[13.5px] font-semibold', accent ? 'text-acc' : 'text-text')}>{who}</span>
        {when && <span className="ml-[7px] font-display text-[12px] text-faint">{when}</span>}
      </span>
    </div>
  );
}

// ── ADRESBOEK (pushed) ───────────────────────────────────────────────────────
// Live venue contacts (RLS: admin/finance/organizer). Tap a row to edit it; star
// = is_permanent (#11, with a confirm); "+" opens an event+tier picker and adds
// via add_contact_to_event (a deliberate add clears any "respect the removal"
// exclusion). Staff/doorhost have no contacts access → an explicit permission note.
export function Contacten({ eventId }: { eventId?: string }): JSX.Element {
  const nav = useNav();
  const { roles } = usePoIdentity();
  // We can't see event-organizer scope in the role array, so we only *positively*
  // know admin/finance can view. A non-manager with an empty list is almost
  // certainly RLS-blocked (staff/doorhost) — say so instead of "no contacts yet".
  const canView = roles.includes('admin') || roles.includes('finance');
  const { data: contacts = [], isLoading, isError } = usePoContacts();
  const toggleVast = usePoToggleContactPermanent();
  const { data: liveEvents = [] } = usePoEvents();
  const upcoming = liveEvents.filter((e) => e.when === 'upcoming');

  const [q, setQ] = useState('');
  const [addingFor, setAddingFor] = useState<PoContact | null>(null);
  const [confirmStar, setConfirmStar] = useState<PoContact | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const { selected, toggle: toggleSel, clear: clearSel, selectAll: selectAllSel } = useGuestSelection();
  const [bulkAddOpen, setBulkAddOpen] = useState(false);

  const term = q.trim().toLowerCase();
  const cs = term
    ? contacts.filter((c) => c.name.toLowerCase().includes(term) || (c.phoneLast4 ?? '').includes(term))
    : contacts;

  const hasSel = selected.size > 0;
  const selectedPeople: BulkAddCandidate[] = cs
    .filter((c) => selected.has(c.id))
    .map((c) => ({ key: c.id, name: c.name, contactId: c.id, plus: 0 }));

  const onStarClick = (c: PoContact): void => {
    if (c.vast) toggleVast.mutate({ contactId: c.id, isPermanent: false });
    else setConfirmStar(c);
  };

  const noRights = !isLoading && !isError && !canView && contacts.length === 0;

  return (
    <div className={col}>
      <Top
        onBack={nav.back}
        title={t.guests.contacts.title}
        sub={fmt(t.guests.contacts.sub, { n: contacts.length, contacts: contacts.length === 1 ? t.guests.contacts.contactOne : t.guests.contacts.contactMany })}
        right={<IconBtn name="upload" onClick={() => nav.push('import')} />}
      />
      <div className="flex-none px-4 pb-3">
        {hasSel ? (
          <div className="flex w-full flex-wrap items-center gap-2">
            <span className="flex-1 whitespace-nowrap font-display text-[14px] font-bold text-text">
              {fmt(t.guests.multiSelect.selectionBar, { n: selected.size })}
            </span>
            <Btn sm kind="quiet" onClick={() => selectAllSel(cs.map((c) => c.id))}>
              {t.guests.multiSelect.selectAll}
            </Btn>
            <Btn sm kind="primary" icon="plus" onClick={() => setBulkAddOpen(true)}>
              {t.guests.multiSelect.addToEvent}
            </Btn>
            <Btn sm kind="ghost" onClick={clearSel}>
              {t.guests.multiSelect.cancelSelection}
            </Btn>
          </div>
        ) : (
          <Field icon="search" placeholder={t.guests.contacts.searchPlaceholder} value={q} onChange={setQ} inputMode="text" />
        )}
      </div>
      <Scroll pad={16} bottom={24}>
        {isLoading ? (
          <Empty text={t.guests.contacts.loading} />
        ) : noRights ? (
          <Note icon="shield">
            {t.guests.contacts.noRights}
          </Note>
        ) : isError ? (
          <Empty text={t.guests.contacts.loadError} />
        ) : cs.length === 0 ? (
          <Empty text={term ? t.guests.contacts.emptyFiltered : t.guests.contacts.empty} />
        ) : (
          <div className="flex flex-col gap-[9px]">
            {cs.map((c) => {
              const isAdded = added.has(c.id);
              const isSel = selected.has(c.id);
              const starring = toggleVast.isPending && toggleVast.variables?.contactId === c.id;
              return (
                <div key={c.id} className={cn('flex items-center gap-[10px] rounded-[16px] border p-[12px]', isSel ? 'border-acc bg-acc-dim' : 'border-line bg-elev')}>
                  <button
                    type="button"
                    onClick={() => toggleSel(c.id)}
                    aria-pressed={isSel}
                    aria-label={fmt(t.guests.contacts.openAria, { name: c.name })}
                    className={cn('flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 transition-colors', isSel ? 'border-acc bg-acc' : 'border-ghost bg-transparent')}
                  >
                    {isSel && <Icon name="check2" size={12} stroke="#0B0B0D" sw={2.8} />}
                  </button>
                  <Avatar name={c.name} size={42} accent={c.vast} />
                  <button type="button" onClick={() => nav.push('contactprofile', { id: c.id })} aria-label={fmt(t.guests.contacts.openAria, { name: c.name })} className={cn('min-w-0 flex-1 text-left', press)}>
                    <div className="font-display text-[15.5px] font-bold text-text">{c.name}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="text-[11.5px] text-faint">
                        {fmt(t.guests.contacts.onListCount, { n: c.events })}{c.phoneLast4 ? ` · ••${c.phoneLast4}` : ''}
                      </span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onStarClick(c)}
                    disabled={starring}
                    aria-pressed={c.vast}
                    title={c.vast ? t.guests.contacts.unmakeRegular : t.guests.contacts.makeRegular}
                    className={cn('flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] border', press, c.vast ? 'border-transparent bg-acc-dim text-acc' : 'border-line text-ghost')}
                  >
                    <Icon name="star" size={17} fill={c.vast ? '#B5A6FF' : 'none'} stroke={c.vast ? '#B5A6FF' : 'rgba(255,255,255,0.26)'} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddingFor(c)}
                    aria-label={fmt(t.guests.contacts.addToEventAria, { name: c.name })}
                    className={cn('flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] border-none', press, isAdded ? 'bg-acc-dim text-acc' : 'bg-text text-bg')}
                  >
                    <Icon name={isAdded ? 'check2' : 'plus'} size={18} sw={2.4} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Scroll>

      {confirmStar && <PermanentConfirmSheet contact={confirmStar} onClose={() => setConfirmStar(null)} />}
      {addingFor && (
        <AddToEventSheet
          contact={addingFor}
          eventId={eventId}
          upcoming={upcoming}
          onClose={() => setAddingFor(null)}
          onAdded={(id) => {
            setAdded((s) => new Set(s).add(id));
            setAddingFor(null);
          }}
        />
      )}
      {bulkAddOpen && (
        <BulkAddToEventSheet
          people={selectedPeople}
          upcoming={upcoming}
          defaultEventId={eventId}
          onClose={() => setBulkAddOpen(false)}
          onDone={clearSel}
        />
      )}
    </div>
  );
}

// ── PERSON PROFILE (pushed) ──────────────────────────────────────────────────
// The unified read-first profile for one person, opened from EITHER the address
// book (a contact) OR the guest list (a guest). A linked guest shows the full
// cross-event profile; a name-only guest shows just its one event plus a "Save as
// contact" promote (add email/phone → the auto-link trigger creates the contact).
// Header + contact info, a 4-stat strip, the events they're on (tier + +N + present
// heads, the event you came from pinned on top with its door note), and a derived
// activity timeline (added / checked in / reversed / refused, newest first).
// Derived-only: no audit log, so it works for anyone who can open the person (RLS
// slices what they see); field-edit history lives in the Audit screen.
const TIMELINE_ICON: Record<ContactTimelineKind, IconName> = {
  added: 'user',
  checkin: 'check2',
  void: 'clock',
  refusal: 'close',
};

function timelineLabel(it: PoProfileTimelineItem): string {
  const cp = t.guests.contactProfile;
  if (it.kind === 'added') return fmt(cp.tAdded, { event: it.event });
  if (it.kind === 'checkin')
    return it.arrived > 0 ? fmt(cp.tCheckinHeads, { event: it.event, n: it.arrived }) : fmt(cp.tCheckin, { event: it.event });
  if (it.kind === 'void') return fmt(cp.tVoid, { event: it.event });
  return it.reason ? fmt(cp.tRefusalReason, { event: it.event, reason: it.reason }) : fmt(cp.tRefusal, { event: it.event });
}

/** One contact-info line (phone / email / birthday / note) in the header card. */
function InfoRow({ icon, label, value, last }: { icon: IconName; label?: string; value: string; last?: boolean }): JSX.Element {
  return (
    <div className={cn('flex items-center gap-[12px] py-[11px]', last ? '' : 'border-b border-line2')}>
      <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-elev2 text-dim">
        <Icon name={icon} size={15} sw={2} />
      </span>
      <div className="min-w-0 flex-1">
        {label && <div className="text-[10.5px] font-bold uppercase tracking-[0.04em] text-faint">{label}</div>}
        <div className="truncate text-[13.5px] text-text">{value}</div>
      </div>
    </div>
  );
}

/** One stat tile in the profile's 4-up strip. */
function Stat({ n, label, accent }: { n: number; label: string; accent?: boolean }): JSX.Element {
  return (
    <div className="rounded-[12px] border border-line bg-elev px-1 py-[11px] text-center">
      <div className={cn('font-display text-[20px] font-extrabold leading-none', accent ? 'text-acc' : 'text-text')}>{n}</div>
      <div className="mt-[5px] text-[10px] font-bold uppercase tracking-[0.02em] text-faint">{label}</div>
    </div>
  );
}

/** Trailing status pill for an event row (inside · on the way · refused). */
function EventStatusPill({ e }: { e: PoProfileEvent }): JSX.Element {
  if (e.status === 'refused') {
    return <span className="shrink-0 rounded-[7px] border border-line2 px-2 py-[3px] font-body text-[11px] font-bold text-faint">{t.guests.contactProfile.statusRefused}</span>;
  }
  if (e.status === 'inside') {
    return (
      <span className="inline-flex shrink-0 items-center gap-[5px] rounded-[7px] bg-acc-dim px-2 py-[4px] font-body text-[11px] font-bold text-acc">
        <Icon name="check2" size={12} stroke="#B5A6FF" sw={2.4} />
        {fmt(t.guests.contactProfile.statusInside, { n: e.presentHeads ?? 1 })}
      </span>
    );
  }
  return <span className="shrink-0 font-body text-[11px] font-bold text-faint">{t.guests.contactProfile.statusOnTheWay}</span>;
}

export function ContactProfile({
  contactId,
  guestId,
  originEventId,
}: {
  contactId?: string;
  guestId?: string;
  originEventId?: string;
}): JSX.Element {
  const nav = useNav();
  const { roles } = usePoIdentity();
  // G4/K-8: a door-only viewer gets the full view (header/stats/events/
  // timeline) but no contact-management action — computed up front, not
  // reactively from an RLS-hidden field, so it also covers a not-yet-linked
  // guest (which today still showed a "Save as contact" CTA to a doorhost).
  const doorOnly = isDoorOnlyRole(roles);
  const { data: profile, isLoading, isError } = usePoPersonProfile({ contactId, guestId, originEventId });
  const { data: liveEvents = [] } = usePoEvents();
  const upcoming = liveEvents.filter((e) => e.when === 'upcoming');
  const toggleVast = usePoToggleContactPermanent();
  const { data: tierOptions = [] } = usePoTiers(originEventId ?? '');
  const changeTier = usePoChangeGuestTier(originEventId ?? '');
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [confirmStar, setConfirmStar] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [tierPicking, setTierPicking] = useState(false);
  const [tierGuestId, setTierGuestId] = useState<string | null>(null);
  const [tierErr, setTierErr] = useState<string | null>(null);
  // A successful contact save (edit or promote) previously closed the sheet with
  // no confirmation — the user couldn't tell it actually happened.
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(id);
  }, [toast]);

  if (isLoading) {
    return (
      <div className={col}>
        <Top onBack={nav.back} title={t.guests.contactProfile.title} />
        <Loading text={t.guests.contactProfile.loading} />
      </div>
    );
  }
  if (isError || !profile) {
    return (
      <div className={col}>
        <Top onBack={nav.back} title={t.guests.contactProfile.title} />
        <Scroll pad={16} bottom={24}>
          <Empty text={t.guests.contactProfile.notFound} />
        </Scroll>
      </div>
    );
  }

  const p = profile;
  // The PoContact the contact sheets expect — only ever passed when p.isContact,
  // where p.id is the real contact id.
  const contact: PoContact = {
    id: p.id,
    name: p.name,
    role: p.role,
    events: p.eventsCount,
    vast: p.vast,
    phoneLast4: p.phoneLast4,
    email: p.email,
    phone: p.phone,
    birthdate: p.birthdate,
    note: p.note,
    preferredRole: p.preferredRole,
  };
  const onStar = (): void => {
    if (p.vast) toggleVast.mutate({ contactId: p.id, isPermanent: false });
    else setConfirmStar(true);
  };
  const hasInfo = !!(p.phone || p.email || p.birthday || p.note);
  // The event a promote is charged against: the one we opened from, else its only one.
  const promoteEventId = originEventId || p.events[0]?.eventId || '';

  return (
    <div className={cn(col, 'relative')}>
      <Top
        onBack={nav.back}
        title={t.guests.contactProfile.title}
        right={
          // Only a saved contact can be made "Regular" (the flag lives on the
          // contact) — and never for a door-only viewer (G4).
          p.isContact && !doorOnly ? (
            <button
              type="button"
              onClick={onStar}
              disabled={toggleVast.isPending}
              aria-pressed={p.vast}
              title={p.vast ? t.guests.contactProfile.unmakeRegular : t.guests.contactProfile.makeRegular}
              className={cn('flex h-[40px] w-[40px] items-center justify-center rounded-[12px] border', press, p.vast ? 'border-transparent bg-acc-dim text-acc' : 'border-line bg-elev text-ghost')}
            >
              <Icon name="star" size={18} fill={p.vast ? '#B5A6FF' : 'none'} stroke={p.vast ? '#B5A6FF' : 'rgba(255,255,255,0.4)'} />
            </button>
          ) : undefined
        }
      />
      <Scroll bottom={24}>
        {/* Header */}
        <div className="flex flex-col items-center px-0 pb-[16px] pt-1.5 text-center">
          <Avatar name={p.name} size={84} accent={p.vast} />
          <h2 className="mb-0 mt-4 font-display text-[26px] font-extrabold tracking-[-0.02em] text-text">{p.name}</h2>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-[7px]">
            {/* A saved contact isn't scoped to one event's tier, and G4 dropped
                the standalone preferred_role vocabulary chip — its real tier(s)
                still show per-event below. A name-only guest shows the real tier
                of its (single) appearance instead. */}
            {!p.isContact && (
              <TierPill name={p.events[0]?.tier ?? undefined} color={p.events[0]?.tierColor} fallback={p.role} />
            )}
            {p.vast && (
              <span className="inline-flex items-center gap-[5px] rounded-[7px] border border-transparent bg-acc-dim px-2 py-[3px] font-body text-[11px] font-bold uppercase tracking-[0.04em] text-acc">
                <Icon name="star" size={11} fill="#B5A6FF" stroke="#B5A6FF" />
                {t.guests.contactProfile.regular}
              </span>
            )}
          </div>
          <div className="mt-2 text-[12px] text-faint">{fmt(t.guests.contactProfile.since, { date: p.since })}</div>
        </div>

        {/* Actions: a saved contact edits / adds-to-event / stars; a name-only guest
            gets a "Save as contact" promote (add email/phone) instead; a
            RESTRICTED guest (already a contact, just unreadable to this role —
            M3, K-8) gets neither: no promote CTA (it's already a contact), no
            edit/add (those need the contacts row too), just a plain note. A
            door-only viewer (G4) skips all of this — checked first, ahead of
            isContact/restricted, so it applies uniformly regardless of the
            person's contact-link state; the stat strip/events/timeline below
            already carry what's useful at the door. */}
        {doorOnly ? null : p.isContact ? (
          <>
            <div className="mb-4 flex gap-2">
              <Btn kind="ghost" full onClick={() => setEditing(true)}>
                {t.guests.contactProfile.edit}
              </Btn>
              <Btn kind="primary" full icon="plus" onClick={() => setAdding(true)}>
                {t.guests.contactProfile.addToEvent}
              </Btn>
            </div>
            {hasInfo && (
              <div className="mb-4 rounded-[14px] border border-line bg-elev px-[14px] py-1">
                {p.phone && <InfoRow icon="phone" value={p.phone} last={!p.email && !p.birthday && !p.note} />}
                {p.email && <InfoRow icon="mail" value={p.email} last={!p.birthday && !p.note} />}
                {p.birthday && <InfoRow icon="spark" label={t.guests.contactProfile.birthday} value={p.birthday} last={!p.note} />}
                {p.note && <InfoRow icon="note" value={p.note} last />}
              </div>
            )}
          </>
        ) : p.restricted ? (
          <Note icon="shield">{t.guests.contactProfile.restrictedNote}</Note>
        ) : (
          <>
            <div className="mb-3">
              <Btn kind="primary" full icon="contact" onClick={() => setPromoting(true)}>
                {t.guests.contactProfile.saveAsContact}
              </Btn>
            </div>
            <Note icon="contact">{t.guests.contactProfile.guestOnlyNote}</Note>
          </>
        )}

        {/* Stat strip */}
        <div className="mb-5 grid grid-cols-4 gap-2">
          <Stat n={p.eventsCount} label={t.guests.contactProfile.statEvents} />
          <Stat n={p.attendedCount} label={t.guests.contactProfile.statAttended} accent />
          <Stat n={p.refusedCount} label={t.guests.contactProfile.statRefused} />
          <Stat n={p.plusOnesTotal} label={t.guests.contactProfile.statPlusOnes} />
        </div>

        {/* Events — the one you came from is pinned on top with its door note. */}
        <Label className="mx-0.5 mb-[10px]">{t.guests.contactProfile.eventsTitle}</Label>
        {p.events.length === 0 ? (
          <div className="mb-5">
            <Empty text={t.guests.contactProfile.eventsEmpty} />
          </div>
        ) : (
          <div className="mb-5 flex flex-col gap-2">
            {p.events.map((e) => (
              <div key={e.eventId} className={cn('rounded-[14px] border bg-elev p-[13px]', e.isOrigin ? 'border-acc' : 'border-line')}>
                <div className="flex items-start gap-[10px]">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-[14.5px] font-bold text-text">{e.name}</span>
                      {e.isOrigin && <MiniChip className="border-acc text-acc">{t.guests.contactProfile.thisEvent}</MiniChip>}
                    </div>
                    <div className="mt-0.5 text-[12px] text-faint">{e.dateLabel}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex items-center gap-[6px] rounded-[7px] border border-line bg-elev2 px-2 py-[3px] font-body text-[11px] font-bold text-text">
                        <span className="h-[8px] w-[8px] rounded-full" style={{ background: e.tierColor }} />
                        {e.tier ?? t.guests.contactProfile.tierNone}
                      </span>
                      {e.isOrigin && tierOptions.length > 1 && (
                        <button
                          type="button"
                          onClick={() => { setTierErr(null); setTierGuestId(e.guestId); setTierPicking(true); }}
                          className="rounded-[7px] border border-line2 bg-transparent px-2 py-[3px] font-body text-[11px] font-bold text-faint transition-colors hover:border-acc hover:text-acc"
                        >
                          {t.guests.contactProfile.changeTier}
                        </button>
                      )}
                      {e.plusOnes > 0 && <MiniChip className="border-line2 text-faint">{fmt(t.guests.contactProfile.plusChip, { n: e.plusOnes })}</MiniChip>}
                    </div>
                  </div>
                  <EventStatusPill e={e} />
                </div>
                {e.note && (
                  <div className={cn('mt-[11px] flex items-start gap-[8px] rounded-[10px] p-[10px]', e.noteFlag === 'high' ? 'bg-acc-dim' : 'bg-elev2')}>
                    <span className="mt-px shrink-0">
                      <Icon name="flag" size={13} stroke={e.noteFlag === 'high' ? '#B5A6FF' : 'rgba(255,255,255,0.40)'} fill={e.noteFlag === 'high' ? '#B5A6FF' : 'none'} />
                    </span>
                    <div className={cn('text-[12.5px] leading-[1.4]', e.noteFlag === 'high' ? 'text-text' : 'text-faint')}>{e.note}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Activity timeline (history) */}
        <Label className="mx-0.5 mb-[6px]">{t.guests.contactProfile.timelineTitle}</Label>
        <p className="mx-0.5 mb-[10px] text-[12px] leading-[1.45] text-faint">{t.guests.contactProfile.timelineNote}</p>
        {p.timeline.length === 0 ? (
          <Empty text={t.guests.contactProfile.timelineEmpty} />
        ) : (
          <div className="rounded-[14px] border border-line bg-elev px-[14px] py-1">
            {p.timeline.map((it, i) => (
              <LogRow
                key={it.key}
                icon={TIMELINE_ICON[it.kind]}
                label={timelineLabel(it)}
                who={it.who || t.guests.contactProfile.actorDoor}
                when={it.when}
                accent={it.kind === 'checkin'}
                last={i === p.timeline.length - 1}
              />
            ))}
          </div>
        )}
      </Scroll>

      {editing && (
        <ContactEditSheet
          contact={contact}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setToast(t.guests.contacts.saveSuccess);
          }}
          onForget={() => {
            setEditing(false);
            setForgetting(true);
          }}
        />
      )}
      {forgetting && <ForgetConfirmSheet contact={contact} onClose={() => setForgetting(false)} />}
      {confirmStar && <PermanentConfirmSheet contact={contact} onClose={() => setConfirmStar(false)} />}
      {adding && (
        <AddToEventSheet
          contact={contact}
          upcoming={upcoming}
          onClose={() => setAdding(false)}
          onAdded={() => setAdding(false)}
        />
      )}
      {promoting && p.promoteGuestId && (
        <PromoteSheet
          guestId={p.promoteGuestId}
          eventId={promoteEventId}
          defaultName={p.name}
          defaultEmail={p.email}
          defaultPhone={p.phone}
          onClose={() => setPromoting(false)}
          onSaved={() => {
            setPromoting(false);
            setToast(t.guests.contactProfile.promoteSuccess);
          }}
        />
      )}
      {tierPicking && tierGuestId && (
        <Sheet onClose={() => setTierPicking(false)} center={false}>
          <div className="mb-1 font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">{t.guests.contactProfile.changeTier}</div>
          <div className="mb-4 text-[13px] text-faint">{t.guests.contactProfile.changeTierSub}</div>
          <div className="flex flex-col gap-2">
            {tierOptions.map((tier) => (
              <button
                key={tier.id}
                type="button"
                disabled={changeTier.isPending}
                onClick={() => {
                  setTierErr(null);
                  changeTier.mutate(
                    { guestId: tierGuestId, tierId: tier.id },
                    {
                      onSuccess: () => setTierPicking(false),
                      onError: (e) => setTierErr(e instanceof Error ? e.message : t.guests.multiSelect.tierFailed),
                    },
                  );
                }}
                className={cn('flex items-center gap-[10px] rounded-[12px] border border-line bg-bg px-[13px] py-[12px] text-text', press, changeTier.isPending && 'opacity-50')}
              >
                <span className="h-[10px] w-[10px] rounded-full shrink-0" style={{ background: tier.color }} />
                <span className="flex-1 text-left font-display text-[14.5px] font-bold">{tier.name}</span>
              </button>
            ))}
          </div>
          {tierErr && <p className="mt-2 text-[12.5px] text-red-300" role="alert">{tierErr}</p>}
          <Btn kind="ghost" full className="mt-3" onClick={() => setTierPicking(false)}>
            {t.guests.contacts.cancel}
          </Btn>
        </Sheet>
      )}
      {toast && <Toast>{toast}</Toast>}
    </div>
  );
}
