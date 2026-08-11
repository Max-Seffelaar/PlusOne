'use client';

import { type JSX, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import {
  parseCsv,
  parsePastedList,
  dedupeWithin,
  normalizeEmail,
  normalizePhoneToDigits,
  normalizeImportPhone,
  normalizeImportBirthdate,
  csvFirstRowIsHeader,
  type ParsedContact,
} from '@/features/contacts/import/parse';
import { usePoContactKeys, usePoEvents, usePoTiers } from '@/features/po/hooks';
import { usePoImportContacts, usePoAddContactsToEvent } from '@/features/po/mutations';
import { useNav } from '../../context';
import { Icon, type IconName } from '../../icon';
import { Avatar, Btn, Field, Label, MiniChip, Note, Scroll, Top, press } from '../../kit';
import { BottomBar } from '../../shell';
import { col, FormError } from './_shared';

// ── IMPORTEREN (pushed) — S3 Import, live ────────────────────────────────────
// Paste a list or a CSV → parse + coerce (phone to E.164, plausible birthdate) →
// dedupe within the file → preview each row as NIEUW or BESTAAT AL against the
// venue's existing contacts (same email-first-else-phone match as upsert_contacts)
// → commit via the idempotent RPC. Manager-only (the action self-guards). Phone
// contacts / "vorig event" sources come later.
type ImportSource = 'paste' | 'csv';

export function Import(): JSX.Element {
  const nav = useNav();
  const { venueId } = usePoIdentity();
  const importMut = usePoImportContacts();
  const keysQ = usePoContactKeys();

  const [source, setSource] = useState<ImportSource>('paste');
  const [text, setText] = useState('');
  // CSV header handling (Q12): auto-detect a recognised header, but let the user
  // override per file (null = follow auto-detect). Only relevant for CSV.
  const [headerOverride, setHeaderOverride] = useState<boolean | null>(null);
  // Inline corrections + deliberate drops applied to the parsed preview (keyed
  // by row index in `rows`). Reset whenever the parsed set changes so a stale
  // index can never bind to a different row.
  const [edits, setEdits] = useState<Record<number, RowEdit>>({});
  const [removed, setRemoved] = useState<Record<number, boolean>>({});
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const autoHeader = source === 'csv' && csvFirstRowIsHeader(text);
  const firstRowIsHeader = headerOverride ?? autoHeader;

  // Parse → coerce to what the import accepts (so the preview's dedup decision
  // matches the real import) → dedupe within the file.
  const { rows, intraSkipped } = useMemo(() => {
    const parsed = source === 'csv' ? parseCsv(text, { firstRowIsHeader }) : parsePastedList(text);
    const coerced = parsed.map((r) => ({
      ...r,
      phone: normalizeImportPhone(r.phone),
      birthdate: normalizeImportBirthdate(r.birthdate),
    }));
    const { rows: deduped, skipped } = dedupeWithin(coerced);
    return { rows: deduped, intraSkipped: skipped };
  }, [text, source, firstRowIsHeader]);

  // A fresh parse invalidates every stale inline edit / removal / open state.
  useEffect(() => {
    setEdits({});
    setRemoved({});
    setOpen({});
  }, [rows]);

  // Build each row (applying the user's inline edit), validate it exactly like
  // importContactsSchema, and classify it against existing contacts like the RPC
  // (e-mail first, else phone digits). While the keys load, nothing is a dup yet.
  const emails = keysQ.data?.emails;
  const phones = keysQ.data?.phones;
  const items = rows.map((base, idx) => {
    const built = buildImportRow(base, edits[idx]);
    const e = normalizeEmail(built.importRow.email);
    const p = normalizePhoneToDigits(built.importRow.phone);
    const exists = (!!e && !!emails?.has(e)) || (!!p && !!phones?.has(p));
    return { idx, exists, removed: !!removed[idx], ...built };
  });

  const active = items.filter((it) => !it.removed);
  const invalid = active.filter((it) => it.error);
  const valid = active.filter((it) => !it.error);
  const total = active.length;
  const invalidCount = invalid.length;
  const removedCount = items.length - active.length;
  const dupCount = valid.filter((it) => it.exists).length;
  const newCount = valid.length - dupCount;

  const result = importMut.data && importMut.data.ok ? importMut.data : null;
  const canImport = !!venueId && total > 0 && invalidCount === 0 && !importMut.isPending;

  const editRow = (idx: number, field: keyof RowEdit, value: string): void => {
    setEdits((e) => ({ ...e, [idx]: { ...e[idx], [field]: value } }));
    setOpen((o) => (o[idx] ? o : { ...o, [idx]: true })); // keep the editor open while fixing
  };
  const toggleRow = (idx: number): void => setOpen((o) => ({ ...o, [idx]: !o[idx] }));
  const removeRow = (idx: number): void => setRemoved((r) => ({ ...r, [idx]: true }));

  const onPickFile = (file: File | undefined): void => {
    if (!file) return;
    setSource('csv');
    setHeaderOverride(null); // re-auto-detect for the new file
    void file.text().then(setText);
  };

  const commit = (): void => {
    if (!canImport || !venueId) return;
    importMut.mutate({ venueId, rows: active.map((it) => it.importRow) });
  };

  // Success state — the per-row outcome from the RPC.
  if (result) {
    return (
      <div className={col}>
        <Top onBack={nav.back} title={t.settings.import.title} />
        <Scroll bottom={100}>
          <div className="mb-4 flex flex-col items-center gap-3 rounded-[18px] bg-acc-dim p-6 text-center">
            <span className="flex h-[52px] w-[52px] items-center justify-center rounded-[16px] bg-acc">
              <Icon name="check2" size={28} stroke="#16132B" sw={2.4} />
            </span>
            <div className="font-display text-[22px] font-extrabold text-text">{t.settings.import.doneTitle}</div>
            <div className="text-[13.5px] leading-[1.5] text-text">
              {fmt(t.settings.import.doneSummary, { inserted: result.inserted, updated: result.updated, skipped: result.skipped })}
            </div>
          </div>
          <Note icon="contact">
            {t.settings.import.doneNote}
          </Note>
          {result.ids.length > 0 && <AddImportedToEvent contactIds={result.ids} />}
        </Scroll>
        <BottomBar>
          <Btn
            kind="primary"
            full
            icon="contact"
            onClick={() => {
              importMut.reset();
              nav.back();
            }}
          >
            {t.settings.import.toContacts}
          </Btn>
        </BottomBar>
      </div>
    );
  }

  const sources: [ImportSource | 'soon', IconName, string][] = [
    ['paste', 'paste', t.settings.import.sourcePaste],
    ['csv', 'upload', t.settings.import.sourceCsv],
    ['soon', 'contact', t.settings.import.sourcePhone],
    ['soon', 'ticket', t.settings.import.sourceLastEvent],
  ];

  return (
    <div className={col}>
      <Top onBack={nav.back} title={t.settings.import.title} />
      <Scroll bottom={total > 0 ? 110 : 40}>
        <div className="mb-[14px] text-[13.5px] leading-[1.5] text-faint">
          {t.settings.import.intro}
        </div>
        <div className="po-scroll mb-4 flex gap-2 overflow-x-auto">
          {sources.map(([key, ic, l]) => {
            const on = key === source;
            const soon = key === 'soon';
            return (
              <button
                key={l}
                type="button"
                disabled={soon}
                onClick={() => {
                  if (soon) return;
                  setSource(key as ImportSource);
                  setHeaderOverride(null);
                }}
                className={cn(
                  'inline-flex shrink-0 items-center gap-[7px] rounded-full border px-[14px] py-[9px] font-display text-[13px] font-bold',
                  press,
                  on ? 'border-transparent bg-acc text-on-acc' : 'border-line text-dim',
                  soon && 'opacity-40',
                )}
              >
                <Icon name={ic} size={15} sw={2.1} />
                {l}
                {soon && <span className="text-[10px] font-bold text-faint">{t.settings.import.sourceSoon}</span>}
              </button>
            );
          })}
        </div>

        {source === 'csv' && (
          <>
            <label className={cn('mb-3 flex cursor-pointer items-center justify-center gap-2 rounded-[14px] border border-dashed border-line bg-elev py-[14px] font-display text-[14px] font-bold text-text', press)}>
              <Icon name="upload" size={17} />
              {t.settings.import.pickCsv}
              <input type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={(e) => onPickFile(e.target.files?.[0])} />
            </label>
            {text.trim() !== '' && (
              <button
                type="button"
                onClick={() => setHeaderOverride(!firstRowIsHeader)}
                className={cn('mb-3 flex w-full items-center gap-[11px] rounded-[13px] border border-line bg-elev px-[13px] py-[11px] text-left', press)}
              >
                <span className={cn('flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] border-2', firstRowIsHeader ? 'border-acc bg-acc' : 'border-ghost bg-transparent')}>
                  {firstRowIsHeader && <Icon name="check" size={13} stroke="#16132B" sw={3} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-[13.5px] font-bold text-text">{t.settings.import.headerTitle}</span>
                  <span className="block text-[11.5px] text-faint">{t.settings.import.headerSub}</span>
                </span>
              </button>
            )}
          </>
        )}

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder={
            source === 'csv'
              ? t.settings.import.csvPlaceholder
              : t.settings.import.pastePlaceholder
          }
          className="mb-4 w-full resize-y rounded-[14px] border border-line bg-elev p-[14px] font-body text-[14.5px] leading-[1.5] text-text outline-none placeholder:text-faint"
        />

        {total > 0 && (
          <>
            <div className="mb-[10px] flex items-center justify-between gap-2">
              <Label>
                {fmt(total === 1 ? t.settings.import.recognizedOne : t.settings.import.recognizedMany, { n: total })}
              </Label>
              <div className="flex flex-wrap justify-end gap-1.5">
                {invalidCount > 0 && (
                  <MiniChip className="border-transparent bg-red-300/15 text-red-300">{fmt(t.settings.import.needsFixCount, { n: invalidCount })}</MiniChip>
                )}
                <MiniChip className="border-transparent bg-acc-dim text-acc">{fmt(t.settings.import.newCount, { n: newCount })}</MiniChip>
                {dupCount > 0 && <MiniChip>{fmt(t.settings.import.existsCount, { n: dupCount })}</MiniChip>}
              </div>
            </div>
            {invalidCount > 0 && (
              <div className="mb-3 flex gap-[11px] rounded-[13px] border border-red-300/40 bg-red-300/10 p-[13px]">
                <span className="mt-px shrink-0 text-red-300"><Icon name="warn" size={17} /></span>
                <div className="text-[12.5px] leading-[1.45] text-text">
                  <span className="font-semibold">{t.settings.import.needsFixTitle}</span>
                  <div className="mt-0.5 text-faint">
                    {fmt(invalidCount === 1 ? t.settings.import.needsFixOne : t.settings.import.needsFixMany, { n: invalidCount })}
                  </div>
                </div>
              </div>
            )}
            {keysQ.isLoading && <div className="mb-2 text-[12px] text-faint">{t.settings.import.checkingDuplicates}</div>}
            {/* Flagged rows first (always shown so nothing blocks the import off-screen), then valid rows capped at 50. */}
            <div className="flex flex-col gap-2">
              {invalid.map((it) => (
                <ImportRowCard key={it.idx} item={it} open onToggle={() => toggleRow(it.idx)} onEdit={(f, v) => editRow(it.idx, f, v)} onRemove={() => removeRow(it.idx)} />
              ))}
              {valid.slice(0, 50).map((it) => (
                <ImportRowCard key={it.idx} item={it} open={!!open[it.idx]} onToggle={() => toggleRow(it.idx)} onEdit={(f, v) => editRow(it.idx, f, v)} onRemove={() => removeRow(it.idx)} />
              ))}
            </div>
            {valid.length > 50 && <div className="mt-2 text-center text-[12px] text-faint">{fmt(t.settings.import.moreImported, { n: valid.length - 50 })}</div>}
            {removedCount > 0 && (
              <div className="mt-2 flex items-center justify-center gap-2 text-[12px] text-faint">
                <span>{fmt(t.settings.import.removedLine, { n: removedCount })}</span>
                <button type="button" onClick={() => setRemoved({})} className={cn('font-semibold text-acc', press)}>{t.settings.import.undo}</button>
              </div>
            )}
            {intraSkipped > 0 && <div className="mt-2 text-[12px] text-faint">{fmt(t.settings.import.intraSkipped, { n: intraSkipped })}</div>}
          </>
        )}

        {importMut.isError && (
          <div className="mt-3 flex items-center gap-[9px] rounded-[13px] border border-acc bg-acc-dim px-[14px] py-[11px] text-[13px] text-text">
            <Icon name="warn" size={16} stroke="#B5A6FF" />
            <span className="flex-1">{importMut.error?.message ?? t.settings.import.importError}</span>
          </div>
        )}
      </Scroll>
      {total > 0 && (
        <BottomBar>
          <Btn kind="primary" full icon={invalidCount > 0 ? 'warn' : 'check'} disabled={!canImport} className={canImport ? '' : 'opacity-[0.45]'} onClick={commit}>
            {importMut.isPending
              ? t.settings.import.importing
              : invalidCount > 0
                ? fmt(invalidCount === 1 ? t.settings.import.fixFirstOne : t.settings.import.fixFirstMany, { n: invalidCount })
                : fmt(total === 1 ? t.settings.import.importOne : t.settings.import.importMany, { n: total })}
          </Btn>
        </BottomBar>
      )}
    </div>
  );
}

// ── Import → add to an event (#3) ────────────────────────────────────────────
// After importing, offer to put the whole batch on an event in one step — the
// "which event do you want to add these people to?" flow. Tier = "Auto (by each
// person's role)" by default (the RPC resolves per contact), or a single tier for
// everyone. Reuses the venue-scoped add_contacts_to_event RPC (admin/organizer).
function AddImportedToEvent({ contactIds }: { contactIds: string[] }): JSX.Element | null {
  const { data: events = [] } = usePoEvents();
  const upcoming = events.filter((e) => e.when === 'upcoming');
  const [evId, setEvId] = useState<string>('');
  const curEv = upcoming.find((e) => e.id === evId) ?? upcoming[0];
  const effEvId = curEv?.id ?? '';
  const { data: tiers = [] } = usePoTiers(effEvId);
  // '' = Auto (omit tierId → per-contact role resolution); else an override tier.
  const [tierId, setTierId] = useState<string>('');
  const add = usePoAddContactsToEvent();
  const done = add.data && add.data.ok ? add.data : null;

  if (upcoming.length === 0) return null; // nothing to add to

  if (done) {
    return (
      <div className="mt-4 flex items-center gap-[11px] rounded-[16px] border border-line bg-elev p-4">
        <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[12px] bg-acc-dim text-acc">
          <Icon name="check2" size={20} stroke="#B5A6FF" sw={2.4} />
        </span>
        <div className="min-w-0">
          <div className="font-display text-[14.5px] font-bold text-text">{fmt(t.settings.import.toEventDoneTitle, { event: curEv?.name ?? '' })}</div>
          <div className="mt-0.5 text-[12.5px] text-faint">{fmt(t.settings.import.toEventDoneSummary, { added: done.added, already: done.already, skipped: done.skipped })}</div>
        </div>
      </div>
    );
  }

  const commit = (): void => {
    if (!effEvId || add.isPending) return;
    add.mutate({ eventId: effEvId, contactIds, tierId: tierId || undefined });
  };

  return (
    <div className="mt-5 rounded-[18px] border border-line bg-elev p-4">
      <div className="mb-1 font-display text-[16px] font-extrabold text-text">{t.settings.import.toEventTitle}</div>
      <div className="mb-3 text-[12.5px] leading-[1.45] text-faint">
        {fmt(contactIds.length === 1 ? t.settings.import.toEventSubOne : t.settings.import.toEventSubMany, { n: contactIds.length })}
      </div>

      <Label className="mb-[7px]">{t.settings.import.toEventEventLabel}</Label>
      <div className="po-scroll mb-3 flex gap-2 overflow-x-auto">
        {upcoming.map((e) => {
          const on = e.id === effEvId;
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => setEvId(e.id)}
              className={cn('inline-flex shrink-0 items-center gap-[9px] rounded-[12px] border px-[12px] py-[9px] text-left', press, on ? 'border-transparent bg-acc-dim' : 'border-line bg-bg')}
            >
              <span className="w-[30px] shrink-0 text-center">
                <span className="block font-display text-[15px] font-extrabold leading-none text-text">{e.date}</span>
                <span className="block text-[8.5px] font-bold tracking-[0.05em] text-faint">{e.mon}</span>
              </span>
              <span className="font-display text-[13.5px] font-bold text-text">{e.name}</span>
              {on && <Icon name="check2" size={15} stroke="#B5A6FF" sw={2.4} />}
            </button>
          );
        })}
      </div>

      <Label className="mb-[7px]">{t.settings.import.toEventTierLabel}</Label>
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setTierId('')}
          className={cn('inline-flex items-center gap-[7px] rounded-full border px-[13px] py-[8px] font-display text-[12.5px] font-bold', press, tierId === '' ? 'border-transparent bg-acc text-on-acc' : 'border-line text-dim')}
        >
          <Icon name="spark" size={14} />
          {t.settings.import.toEventTierAuto}
        </button>
        {tiers.map((tier) => {
          const on = tier.id === tierId;
          return (
            <button
              key={tier.id}
              type="button"
              onClick={() => setTierId(tier.id)}
              className={cn('inline-flex items-center gap-[7px] rounded-full border px-[13px] py-[8px] font-display text-[12.5px] font-bold', press, on ? 'border-transparent bg-acc text-on-acc' : 'border-line text-dim')}
            >
              <span className="h-[9px] w-[9px] rounded-full" style={{ background: tier.color }} />
              {tier.name}
            </button>
          );
        })}
      </div>

      {add.isError && <FormError error={add.error} />}
      <Btn kind="primary" full icon="check" disabled={!effEvId || add.isPending} className={!effEvId || add.isPending ? 'opacity-[0.45]' : ''} onClick={commit}>
        {add.isPending ? t.settings.import.toEventAdding : fmt(t.settings.import.toEventAdd, { event: curEv?.name ?? '' })}
      </Btn>
    </div>
  );
}

// ── Import preview: per-row build + card ─────────────────────────────────────
// One import row's editable state (raw strings the user typed in the preview).
interface RowEdit {
  fullName?: string;
  email?: string;
  phone?: string;
}

interface BuiltImportRow {
  /** Display strings (raw, so a controlled input never fights the typist). */
  name: string;
  email: string;
  phone: string;
  /** null = valid; else the reason it can't be imported yet. */
  error: string | null;
  /** What actually goes to the RPC (coerced: E.164 phone, trimmed, blanks→undef). */
  importRow: ParsedContact;
}

const IMPORT_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const IMPORT_NAME_MAX = 500;

/** Apply the user's inline edit to a parsed row, then validate + coerce it the
 *  same way importContactsSchema does — so the preview's verdict matches commit. */
function buildImportRow(base: ParsedContact, ed: RowEdit | undefined): BuiltImportRow {
  const name = ed?.fullName ?? base.fullName;
  const email = ed?.email ?? base.email ?? '';
  const phone = ed?.phone ?? base.phone ?? '';

  const nameT = name.trim();
  const emailT = email.trim();
  const phoneT = phone.trim();
  const coercedPhone = phoneT === '' ? undefined : normalizeImportPhone(phoneT);

  let error: string | null = null;
  if (nameT === '') error = t.settings.import.errNameEmpty;
  else if (nameT.length > IMPORT_NAME_MAX) error = fmt(t.settings.import.errNameLong, { n: nameT.length });
  else if (emailT !== '' && !IMPORT_EMAIL_RE.test(emailT)) error = t.settings.import.errEmail;
  else if (phoneT !== '' && coercedPhone === undefined) error = t.settings.import.errPhone;

  const importRow: ParsedContact = {
    ...base,
    fullName: nameT,
    email: emailT === '' ? undefined : emailT,
    phone: coercedPhone,
  };
  return { name, email, phone, error, importRow };
}

function ImportRowCard({
  item,
  open,
  onToggle,
  onEdit,
  onRemove,
}: {
  item: BuiltImportRow & { exists: boolean };
  open: boolean;
  onToggle: () => void;
  onEdit: (field: keyof RowEdit, value: string) => void;
  onRemove: () => void;
}): JSX.Element {
  const { name, email, phone, error, exists } = item;
  const showEditor = !!error || open;
  const chip = error
    ? { cls: 'bg-red-300/15 text-red-300', label: t.settings.import.rowInvalid }
    : exists
      ? { cls: 'bg-acc-dim text-acc', label: t.settings.import.rowExists }
      : { cls: 'border border-line text-text', label: t.settings.import.rowNew };
  return (
    <div className={cn('rounded-[13px] border bg-elev', error ? 'border-red-300/45' : 'border-line')}>
      <div className="flex items-center gap-[11px] px-[12px] py-[10px]">
        {/* Tapping the identity area opens/closes the inline editor. */}
        <button type="button" onClick={onToggle} className={cn('flex min-w-0 flex-1 items-center gap-[11px] text-left', press)}>
          <Avatar name={name || '?'} size={34} accent={exists} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold text-text">{name.trim() || '—'}</div>
            {(email || phone) && <div className="truncate text-[11.5px] text-faint">{email || phone}</div>}
          </div>
        </button>
        <span className={cn('shrink-0 rounded-[7px] px-2 py-[3px] text-[10.5px] font-bold', chip.cls)}>{chip.label}</span>
        <button
          type="button"
          onClick={onRemove}
          aria-label={t.settings.import.removeRow}
          className={cn('-mr-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-[9px] text-faint', press)}
        >
          <Icon name="close" size={15} />
        </button>
      </div>
      {showEditor && (
        <div className="flex flex-col gap-2 border-t border-line px-[12px] pb-[12px] pt-[11px]">
          {error && (
            <div className="flex items-center gap-[7px] text-[12px] font-semibold text-red-300">
              <Icon name="warn" size={14} />
              <span>{error}</span>
            </div>
          )}
          <Field icon="user" placeholder={t.settings.import.fieldName} value={name} onChange={(v) => onEdit('fullName', v)} />
          <Field icon="mail" placeholder={t.settings.import.fieldEmail} value={email} onChange={(v) => onEdit('email', v)} type="email" inputMode="email" />
          <Field icon="phone" placeholder={t.settings.import.fieldPhone} value={phone} onChange={(v) => onEdit('phone', v)} type="tel" inputMode="tel" />
        </div>
      )}
    </div>
  );
}
