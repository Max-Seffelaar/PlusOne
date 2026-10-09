'use client';

// Paste a list (#33) — and, with `share`, the landing of share-import S2: text
// shared from WhatsApp/Mail/Notes/Excel arrives here pre-filled, with an event
// and tier picker on top. One parser (quick-add-parser), one import path
// (usePoAddGuestsBulk) — the share route adds nothing beside them.
import { type JSX, useState, useMemo } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { cn } from '@/lib/utils';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import {
  indexGuestsByName,
  suspectedDuplicates,
  planBulkAdd,
  type DupeMode,
  type BulkRowInput,
} from '@/features/guests/bulk-dedupe';
import {
  parseBulk,
  totalSlots,
  pasteSummary,
  type QuickAddTier,
  type AmbiguityChoice,
} from '@/features/guests/quick-add-parser';
import { resolveDefaultTierId } from '@/features/guests/tiers';
import { normalizeContactName } from '@/features/guests/contact-match';
import { usePoContactNameMatches, usePoEvents, usePoGuests, usePoTiers, usePoQuota } from '@/features/po/hooks';
import { usePoAddGuestsBulk, usePoUpdateGuest } from '@/features/po/mutations';
import { findEventGuestsByNames } from '@/features/po/queries';
import { createClient } from '@/lib/supabase/client';
import { captureUnexpectedError } from '@/lib/observability/capture';
import { t, fmt } from '@/lib/i18n';
import { useNav } from '../../context';
import { Icon } from '../../icon';
import { Avatar, Btn, Empty, Field, Label, MiniChip, Scroll, Select, Top } from '../../kit';
import { BottomBar } from '../../shell';
import { DupeOption, NoTiersBlock, press, col } from './_shared';
import { ContactLinkAmbiguous, ContactLinkOffer } from './contact-link';
import { buildBulkRow, resolveRow, type RowFix } from './bulk-row';

// ── BULK PASTE (#33) ─────────────────────────────────────────────────────────
// Row folding + the per-row inline-fix validation live in ./bulk-row.

/**
 * `share` (share-import S2): the landing of `/app/share`. The text arrives as
 * `initialText`, and the screen gets an event picker (default: the next
 * upcoming event) and a tier picker (the tier for every line that names none).
 * Without it this is the event-scoped Paste a list, unchanged.
 */
export function BulkPaste({
  eventId,
  initialText,
  share = false,
  onImported,
}: {
  eventId?: string;
  initialText?: string;
  share?: boolean;
  /** After a successful import (the share screen forgets its text here). */
  onImported?: () => void;
}): JSX.Element {
  const nav = useNav();
  const { data: liveEvents = [] } = usePoEvents();
  const upcoming = liveEvents.filter((e) => e.when === 'upcoming');
  // `liveEvents` is newest-first, so the NEXT upcoming event is the last one.
  const soonest = upcoming[upcoming.length - 1];
  const [pickedEventId, setPickedEventId] = useState<string | undefined>(undefined);
  const curEv = share
    ? liveEvents.find((e) => e.id === pickedEventId && e.when === 'upcoming') ?? soonest
    : liveEvents.find((e) => e.id === eventId) ?? upcoming[0] ?? liveEvents[0];
  const evId = curEv?.id ?? '';

  const { data: tiers = [] } = usePoTiers(evId);
  const { data: quota } = usePoQuota(evId);
  const { data: evGuests = [] } = usePoGuests(evId);
  const addBulk = usePoAddGuestsBulk(evId);
  const update = usePoUpdateGuest(evId);

  const qaTiers: QuickAddTier[] = tiers.map((t) => ({ id: t.id, name: t.name, aliases: t.aliases }));
  // Share mode lets the user pick the tier a bare name gets; a line that names a
  // tier keeps its own either way (the parser resolves it).
  const [pickedTierId, setPickedTierId] = useState<string | null>(null);
  const defaultTierId =
    share && pickedTierId && tiers.some((tr) => tr.id === pickedTierId) ? pickedTierId : resolveDefaultTierId(qaTiers);

  const [text, setText] = useState(initialText ?? '');
  const [choices, setChoices] = useState<Record<number, AmbiguityChoice>>({});
  const [edits, setEdits] = useState<Record<number, RowFix>>({});
  const [removed, setRemoved] = useState<Record<number, boolean>>({});
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [dupeMode, setDupeMode] = useState<DupeMode>('add');
  const [busy, setBusy] = useState(false);
  const [orchErr, setOrchErr] = useState<string | null>(null);
  // Rows where the user tapped "Not the same" on the offered contact match (K3),
  // keyed by the NORMALIZED name — the offer is per name, not per line, so
  // undoing it on one line undoes it for every line with that name.
  const [contactLinkOff, setContactLinkOff] = useState<Record<string, boolean>>({});

  // A fresh paste clears every stale per-row choice / inline edit / removal.
  const resetRows = (): void => {
    setChoices({});
    setEdits({});
    setRemoved({});
    setOpen({});
    setContactLinkOff({});
  };

  const rows = defaultTierId ? parseBulk(text, qaTiers, defaultTierId) : [];
  const resolvedRows = rows.map((r, i) => resolveRow(r, choices[i], defaultTierId ?? ''));
  // Per-row editable view: recovers a broken e-mail/phone from the raw line and
  // validates name/e-mail/phone (parity with the contacts import, T12).
  const views = rows.map((r, i) => buildBulkRow(r, resolvedRows[i].name, edits[i]));
  const activeIdx = rows.map((_, i) => i).filter((i) => !removed[i]);
  const flaggedCount = activeIdx.filter((i) => views[i].error).length;
  const doubtful = activeIdx.filter((i) => resolvedRows[i].needsChoice).length;
  const removedCount = rows.length - activeIdx.length;
  const total = totalSlots(activeIdx.map((i) => ({ plusOnes: resolvedRows[i].plusOnes })));
  // "6 entries · 9 guests total · 2 with e-mail" — a flagged e-mail isn't one yet.
  const summary = pasteSummary(
    activeIdx.map((i) => ({ plusOnes: resolvedRows[i].plusOnes, email: views[i].error ? null : views[i].email })),
  );
  const ready = activeIdx.filter((i) => !views[i].error && !resolvedRows[i].needsChoice).length;

  const editRow = (i: number, field: keyof RowFix, value: string): void => {
    setEdits((e) => ({ ...e, [i]: { ...e[i], [field]: value } }));
    setOpen((o) => (o[i] ? o : { ...o, [i]: true }));
  };
  const toggleRow = (i: number): void => setOpen((o) => ({ ...o, [i]: !o[i] }));
  const removeRow = (i: number): void => setRemoved((r) => ({ ...r, [i]: true }));

  const byName = useMemo(
    () => indexGuestsByName(evGuests.map((g) => ({ id: g.id, name: g.name, plusOnes: g.plus }))),
    [evGuests],
  );
  const plannable: BulkRowInput[] = activeIdx
    .filter((i) => !views[i].error && !resolvedRows[i].needsChoice && views[i].name !== '')
    .map((i) => ({ name: views[i].name, plusOnes: resolvedRows[i].plusOnes, tierId: resolvedRows[i].tierId, email: views[i].email || undefined, phone: views[i].phone || undefined }));
  const dupNames = suspectedDuplicates(plannable, byName);

  // ── Name-only rows -> an existing contact (K3) ──────────────────────────────
  // Same offer as quick-add, one lookup per DISTINCT name (batched, capped,
  // max 6 in flight). Rows that already carry an e-mail or phone are left to the
  // autolink trigger, and a name that hits 2+ contacts stays unlinked.
  // Debounced: the textarea is typeable, not paste-only, and each keystroke
  // re-parses every row — without this the batch would re-run per character.
  const nameOnlyKey = plannable.filter((r) => !r.email && !r.phone).map((r) => r.name).join('\n');
  const dNames = useDebouncedValue(nameOnlyKey, 250);
  const { data: contactMatches } = usePoContactNameMatches(dNames ? dNames.split('\n') : []);
  /** The contact this row links to, or null (no match / ambiguous / undone). */
  const contactFor = (name: string, email: string, phone: string) => {
    if (email || phone) return null;
    const hits = contactMatches?.get(normalizeContactName(name)) ?? [];
    return hits.length === 1 ? hits[0] : null;
  };
  const ambiguousFor = (name: string, email: string, phone: string): number => {
    if (email || phone) return 0;
    const hits = contactMatches?.get(normalizeContactName(name)) ?? [];
    return hits.length > 1 ? hits.length : 0;
  };
  const linkedContactFor = (name: string, email: string, phone: string): string | undefined => {
    const hit = contactFor(name, email, phone);
    return hit && !contactLinkOff[normalizeContactName(name)] ? hit.id : undefined;
  };
  const toggleContactLink = (name: string): void => {
    const key = normalizeContactName(name);
    setContactLinkOff((s) => ({ ...s, [key]: !s[key] }));
  };

  const exempt = quota?.exempt ?? false;
  const remaining = exempt ? null : quota?.remaining ?? null;
  const overQuota = remaining !== null && total > remaining;
  const canConfirm = !busy && activeIdx.length > 0 && doubtful === 0 && flaggedCount === 0 && !overQuota && !!defaultTierId && !!evId;

  const confirm = async (): Promise<void> => {
    if (!canConfirm) return;
    setOrchErr(null);
    setBusy(true);
    // Authoritative server-side duplicate check AT CONFIRM (86ey8xg4p, follow-up
    // to 86ey8w7ek): `byName` above is only a HINT built from whatever page of
    // evGuests has loaded — on a big/not-yet-loaded event it can miss real
    // duplicates and let the same guest get inserted 3-5x. One batched, indexed
    // RPC call resolves every pasted name against the full RLS-scoped list right
    // before the plan executes. A failure (offline / deploy skew) falls back to
    // the client hint — offline stays quiet, but a missing RPC must reach Sentry
    // or the safeguard would be silently inert in prod.
    let authByName = byName;
    try {
      const names = plannable.map((r) => r.name);
      if (names.length > 0) {
        const matches = await findEventGuestsByNames(createClient(), evId, names);
        authByName = indexGuestsByName(matches);
      }
    } catch (e) {
      captureUnexpectedError(e, { source: 'query', key: 'find_event_guests_by_names' });
    }
    const plan = planBulkAdd(plannable, authByName, dupeMode);
    try {
      if (plan.inserts.length > 0) {
        await addBulk.mutateAsync({
          eventId: evId,
          source: 'app',
          guests: plan.inserts.map((r) => {
            // 'again' inserts a same-name row as a DIFFERENT person, so it must
            // not inherit the contact link the preview offered for that name.
            const contactId = dupeMode === 'again' && authByName.has(r.name.trim().toLowerCase())
              ? undefined
              : linkedContactFor(r.name, r.email ?? '', r.phone ?? '');
            return {
              id: uuidv7(),
              fullName: r.name,
              plusOnes: r.plusOnes,
              tierId: r.tierId,
              email: r.email,
              phone: r.phone,
              ...(contactId ? { contactId } : {}),
            };
          }),
        });
      }
      for (const u of plan.updates) {
        await update.mutateAsync({ guestId: u.guestId, plusOnes: u.plusOnes });
      }
      setText('');
      resetRows();
      onImported?.();
      // A share lands cold (no in-app history): show the list it just filled.
      if (share) nav.replace('lijst', { id: evId });
      else nav.back();
    } catch (e) {
      setOrchErr(e instanceof Error ? e.message : t.guests.bulk.addFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={col}>
      <Top onBack={nav.back} title={t.guests.bulk.title} sub={curEv ? fmt(t.guests.bulk.subTo, { event: curEv.name }) : t.guests.bulk.subFallback} />
      <Scroll bottom={120}>
        {share && curEv && (
          <div className="mb-4 grid gap-3 md:grid-cols-2">
            <div>
              <Label className="mb-2">{t.guests.bulkAdd.eventLabel}</Label>
              <Select
                value={evId}
                ariaLabel={t.guests.bulkAdd.eventLabel}
                icon="cal"
                options={[...upcoming].reverse().map((e) => ({ value: e.id, label: `${e.name} · ${e.date} ${e.mon}` }))}
                onChange={(id) => {
                  setPickedEventId(id);
                  setPickedTierId(null);
                  resetRows();
                }}
              />
            </div>
            {defaultTierId && (
              <div>
                <Label className="mb-2">{t.guests.bulkAdd.ticketLabel}</Label>
                <Select
                  value={defaultTierId}
                  ariaLabel={t.guests.bulkAdd.ticketLabel}
                  icon="ticket"
                  options={tiers.map((tr) => ({ value: tr.id, label: tr.short }))}
                  onChange={(id) => setPickedTierId(id)}
                />
                <div className="mt-1.5 text-[11.5px] text-faint">{t.guests.bulk.shareTierHint}</div>
              </div>
            )}
          </div>
        )}
        {!curEv ? (
          <Empty text={t.guests.bulk.noUpcoming} />
        ) : !defaultTierId ? (
          <NoTiersBlock eventId={evId} canCreate={exempt} />
        ) : (
          <>
            {share && text.trim() === '' && (
              <p className="mb-2 text-[12.5px] text-faint" data-testid="share-empty-hint">
                {t.guests.bulk.shareEmptyHint}
              </p>
            )}
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                resetRows();
              }}
              rows={5}
              placeholder={t.guests.bulk.placeholder}
              className="mb-4 w-full resize-y rounded-[14px] border border-line bg-elev p-[14px] font-body text-[14.5px] leading-[1.5] text-text outline-none placeholder:text-faint"
            />
            {rows.length > 0 && (
              <>
                <div className="mb-[10px] flex items-center justify-between gap-2">
                  <Label>{fmt(t.guests.bulk.preview, { n: activeIdx.length })}</Label>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {flaggedCount > 0 && <MiniChip className="border-transparent bg-red-300/15 text-red-300">{fmt(t.guests.bulk.needsFixCount, { n: flaggedCount })}</MiniChip>}
                    {doubtful > 0 && <MiniChip className="border-acc text-acc">{fmt(t.guests.bulk.toCheck, { n: doubtful })}</MiniChip>}
                  </div>
                </div>
                <div className="mb-3 text-[12.5px] text-faint" data-testid="paste-summary">
                  {fmt(t.guests.bulk.countLine, {
                    entries: summary.entries,
                    entryWord: summary.entries === 1 ? t.guests.bulk.entryOne : t.guests.bulk.entryMany,
                    guests: summary.guests,
                    guestWord: summary.guests === 1 ? t.guests.bulk.guestOne : t.guests.bulk.guestMany,
                    email: summary.withEmail,
                  })}
                </div>
                {flaggedCount > 0 && (
                  <div className="mb-3 flex gap-[11px] rounded-[13px] border border-red-300/40 bg-red-300/10 p-[13px]">
                    <span className="mt-px shrink-0 text-red-300"><Icon name="warn" size={17} /></span>
                    <div className="text-[12.5px] leading-[1.45] text-text">
                      <span className="font-semibold">{t.guests.bulk.needsFixTitle}</span>
                      <div className="mt-0.5 text-faint">{fmt(flaggedCount === 1 ? t.guests.bulk.needsFixOne : t.guests.bulk.needsFixMany, { n: flaggedCount })}</div>
                    </div>
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  {rows.map((r, i) => {
                    if (removed[i]) return null;
                    const res = resolvedRows[i];
                    const view = views[i];
                    const ask = res.needsChoice;
                    const err = view.error;
                    const showEditor = !!err || !!open[i];
                    const tier = tiers.find((tt) => tt.id === res.tierId);
                    const onList = !ask && !err && byName.has(view.name.trim().toLowerCase());
                    const showContact = !ask && !err && view.name !== '';
                    const contactHit = showContact ? contactFor(view.name, view.email, view.phone) : null;
                    const contactMany = showContact ? ambiguousFor(view.name, view.email, view.phone) : 0;
                    return (
                      <div key={i} className={cn('rounded-[14px] border bg-elev', err ? 'border-red-300/45' : ask ? 'border-acc' : 'border-line')}>
                        <div className="flex items-center gap-[11px] p-[12px]">
                          <button type="button" onClick={() => toggleRow(i)} className={cn('flex min-h-[44px] min-w-0 flex-1 items-center gap-[11px] text-left', press)}>
                            {/* Item I: the row's real tier colour, not "lavender
                                if the tier looks VIP-ish". */}
                            <Avatar name={view.name || r.raw} size={34} color={tier?.color} />
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-display text-[14.5px] font-bold text-text">
                                {view.name || r.raw}
                                {res.plusOnes > 0 && <span className="text-faint"> +{res.plusOnes}</span>}
                              </div>
                              <div className={cn('mt-0.5 truncate text-[11.5px]', err ? 'text-red-300' : ask ? 'text-acc' : 'text-faint')}>
                                {err ? err : ask ? fmt(t.guests.bulk.rowUnknown, { x: r.ambiguous?.text ?? '' }) : tier?.short ?? '—'}
                              </div>
                              {!err && (view.email || view.phone) && (
                                <div className="mt-0.5 flex items-center gap-[5px] text-[11px] text-faint">
                                  <Icon name={view.email ? 'mail' : 'phone'} size={11} className="shrink-0" />
                                  <span className="truncate">{[view.email, view.phone].filter(Boolean).join(' · ')}</span>
                                </div>
                              )}
                            </div>
                          </button>
                          {err ? (
                            <span className="shrink-0 rounded-[7px] bg-red-300/15 px-2 py-[3px] text-[10.5px] font-bold text-red-300">{t.guests.bulk.rowInvalid}</span>
                          ) : ask ? null : onList ? (
                            <MiniChip className="border-acc text-acc">{t.guests.bulk.rowAlreadyOnList}</MiniChip>
                          ) : (
                            <span className="text-acc"><Icon name="check2" size={17} stroke="#B5A6FF" sw={2.2} /></span>
                          )}
                          <button type="button" onClick={() => removeRow(i)} aria-label={t.guests.bulk.removeRow} className={cn('-mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-[9px] text-faint', press)}>
                            <Icon name="close" size={15} />
                          </button>
                        </div>
                        {/* K3: this pasted name already exists in the address book. */}
                        {contactHit && (
                          <div className="border-t border-line px-[12px] py-[6px]">
                            <ContactLinkOffer
                              contactName={contactHit.fullName}
                              linked={!contactLinkOff[normalizeContactName(view.name)]}
                              onToggle={() => toggleContactLink(view.name)}
                            />
                          </div>
                        )}
                        {contactMany > 0 && (
                          <div className="border-t border-line px-[12px] py-[8px]">
                            <ContactLinkAmbiguous count={contactMany} />
                          </div>
                        )}
                        {showEditor && (
                          <div className="flex flex-col gap-2 border-t border-line px-[12px] pb-[12px] pt-[11px]">
                            <Field icon="user" placeholder={t.guests.bulk.fieldName} value={view.name} onChange={(v) => editRow(i, 'name', v)} />
                            <Field icon="mail" placeholder={t.guests.bulk.fieldEmail} value={view.email} onChange={(v) => editRow(i, 'email', v)} type="email" inputMode="email" />
                            <Field icon="phone" placeholder={t.guests.bulk.fieldPhone} value={view.phone} onChange={(v) => editRow(i, 'phone', v)} type="tel" inputMode="tel" />
                          </div>
                        )}
                        {ask && r.ambiguous && (
                          <div className="flex flex-wrap gap-[7px] px-[12px] pb-[12px]">
                            {r.ambiguous.suggestions.map((s) => (
                              <button
                                key={s.tierId}
                                type="button"
                                onClick={() => setChoices((c) => ({ ...c, [i]: { kind: 'tier', tierId: s.tierId } }))}
                                className={cn('flex-1 rounded-[10px] border border-line bg-elev2 py-[9px] font-display text-[12.5px] font-bold text-text', press)}
                              >
                                {s.tierName}
                              </button>
                            ))}
                            <button
                              type="button"
                              onClick={() => setChoices((c) => ({ ...c, [i]: { kind: 'default' } }))}
                              className={cn('flex-1 rounded-[10px] border border-line bg-elev2 py-[9px] font-display text-[12.5px] font-bold text-text', press)}
                            >
                              {tiers.find((x) => x.id === defaultTierId)?.short ?? t.guests.bulk.rowChoiceDefault}
                            </button>
                            <button
                              type="button"
                              onClick={() => setChoices((c) => ({ ...c, [i]: { kind: 'name' } }))}
                              className={cn('flex-1 rounded-[10px] border border-line bg-elev2 py-[9px] font-display text-[12.5px] font-bold text-text', press)}
                            >
                              {t.guests.bulk.rowChoiceName}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {removedCount > 0 && (
                  <div className="mt-2 flex items-center justify-center gap-2 text-[12px] text-faint">
                    <span>{fmt(t.guests.bulk.removedLine, { n: removedCount })}</span>
                    <button type="button" onClick={() => setRemoved({})} className={cn('font-semibold text-acc', press)}>{t.guests.bulk.undo}</button>
                  </div>
                )}
                {dupNames.length > 0 && (
                  <div className="mt-4 rounded-[16px] border border-acc bg-acc-dim p-[14px]">
                    <div className="mb-1 flex items-center gap-2">
                      <Icon name="warn" size={16} stroke="#B5A6FF" />
                      <Label className="text-acc-soft">
                        {fmt(t.guests.bulk.dupeHeader, { n: dupNames.length })}
                      </Label>
                    </div>
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {dupNames.slice(0, 12).map((n) => (
                        <MiniChip key={n} className="border-transparent bg-bg text-text">
                          {n}
                        </MiniChip>
                      ))}
                      {dupNames.length > 12 && (
                        <MiniChip className="border-transparent bg-bg text-faint">+{dupNames.length - 12}</MiniChip>
                      )}
                    </div>
                    <div className="mb-2 text-[12.5px] font-semibold text-text">{t.guests.bulk.dupeWhatToDo}</div>
                    <div className="flex flex-col gap-1.5">
                      <DupeOption on={dupeMode === 'add'} onClick={() => setDupeMode('add')} title={t.guests.bulk.dupeAddTitle} sub={t.guests.bulk.dupeAddSub} />
                      <DupeOption on={dupeMode === 'replace'} onClick={() => setDupeMode('replace')} title={t.guests.bulk.dupeReplaceTitle} sub={t.guests.bulk.dupeReplaceSub} />
                      <DupeOption on={dupeMode === 'again'} onClick={() => setDupeMode('again')} title={t.guests.bulk.dupeAgainTitle} sub={t.guests.bulk.dupeAgainSub} />
                    </div>
                  </div>
                )}
                {!exempt && remaining !== null && (
                  <div className={cn('mt-3 text-[12.5px]', overQuota ? 'text-acc-soft' : 'text-faint')}>
                    {fmt(t.guests.bulk.quotaLine, { total, slots: total === 1 ? t.guests.bulk.slotOne : t.guests.bulk.slotMany, remaining })}
                    {overQuota && t.guests.bulk.quotaBlocked}
                  </div>
                )}
                {(addBulk.isError || orchErr) && (
                  <div className="mt-3 flex items-center gap-[9px] rounded-[13px] border border-acc bg-acc-dim px-[14px] py-[11px] text-[13px] text-text">
                    <Icon name="warn" size={16} stroke="#B5A6FF" />
                    <span className="flex-1">{orchErr ?? addBulk.error?.message}</span>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </Scroll>
      <BottomBar>
        <Btn kind="primary" full icon="check" onClick={() => void confirm()} className={canConfirm ? '' : 'opacity-[0.45]'}>
          {busy
            ? t.guests.bulk.busy
            : flaggedCount > 0
              ? fmt(flaggedCount === 1 ? t.guests.bulk.fixFirstOne : t.guests.bulk.fixFirstMany, { n: flaggedCount })
              : doubtful > 0
                ? fmt(t.guests.bulk.submitOpen, { ready, open: doubtful })
                : dupNames.length > 0
                  ? fmt(t.guests.bulk.submitProcess, { ready, lines: ready === 1 ? t.guests.bulk.lineOne : t.guests.bulk.lineMany })
                  : fmt(t.guests.bulk.submitAdd, { ready, guests: ready === 1 ? t.guests.bulk.guestOne : t.guests.bulk.guestMany })}
        </Btn>
      </BottomBar>
    </div>
  );
}
