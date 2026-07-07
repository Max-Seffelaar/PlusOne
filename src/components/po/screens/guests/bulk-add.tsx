'use client';

// Shared multi-select + bulk-action pieces for the guest surfaces (T11):
// the selection hook, the action bar, and the "add N people to an event" sheet
// with its per-row result view. Lives in its own module so the Guests tab, the
// event Lijst (index.tsx) AND the Contacts screen (profile.tsx) can all use it
// without an index↔profile circular import.
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { PoEvent } from '@/lib/po/types';
import { resolveDefaultTierId } from '@/features/guests/tiers';
import { usePoTiers, usePoQuota, usePoGuests, usePoEventForEdit } from '@/features/po/hooks';
import { usePoBulkAddToEvent, type BulkAddPerson } from '@/features/po/mutations';
import { summarizeBulkAdd, type BulkAddOutcome, type BulkAddRowResult } from '@/features/po/bulk';
import { t, fmt } from '@/lib/i18n';
import { Icon } from '../../icon';
import { Btn, Empty, Label } from '../../kit';
import { Sheet } from '../../shell';
import { NoTiersBlock, press } from './_shared';

/** Selection state shared by the guest surfaces (venue-wide Guests tab + the
 *  event-scoped Lijst). */
export function useGuestSelection() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (id: string): void =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const clear = (): void => setSelected(new Set());
  const selectAll = (ids: string[]): void => setSelected(new Set(ids));
  return { selected, toggle, clear, selectAll };
}

/** The action bar shown while ≥1 guest is selected. Change-tier is only offered
 *  when the selection is scoped to ONE event (tiers are per-event); "all events"
 *  mode passes null and shows the reason elsewhere. */
export function GuestBulkBar({
  count,
  onSelectAll,
  onChangeTier,
  onMarkRegular,
  onAddToEvent,
  onCancel,
  markBusy,
}: {
  count: number;
  onSelectAll: () => void;
  onChangeTier: (() => void) | null;
  /** Null hides the action for roles that can't manage regulars (staff/finance). */
  onMarkRegular: (() => void) | null;
  onAddToEvent: () => void;
  onCancel: () => void;
  markBusy: boolean;
}): JSX.Element {
  const ms = t.guests.multiSelect;
  return (
    <div className="flex w-full flex-wrap items-center gap-2 pb-3 lg:pb-0">
      <span className="flex-1 whitespace-nowrap font-display text-[14px] font-bold text-text">
        {fmt(ms.selectionBar, { n: count })}
      </span>
      <Btn sm kind="quiet" onClick={onSelectAll}>
        {ms.selectAll}
      </Btn>
      {onMarkRegular && (
        <Btn sm kind="quiet" icon="star" onClick={onMarkRegular} disabled={markBusy}>
          {markBusy ? ms.markRegularBusy : ms.markRegular}
        </Btn>
      )}
      {onChangeTier && (
        <Btn sm kind="quiet" icon="ticket" onClick={onChangeTier}>
          {ms.changeTier}
        </Btn>
      )}
      <Btn sm kind="primary" icon="plus" onClick={onAddToEvent}>
        {ms.addToEvent}
      </Btn>
      <Btn sm kind="ghost" onClick={onCancel}>
        {ms.cancelSelection}
      </Btn>
    </div>
  );
}

/** A person queued for a bulk add-to-event (guest row or contact row). */
export interface BulkAddCandidate {
  key: string;
  name: string;
  contactId: string | null;
  plus: number;
}

/** Pick a target event + tier, add every selected person, and show a per-row
 *  result (added / already on the list / quota / tier full / locked). Used by the
 *  Guests tab, the event Lijst and the Contacts screen. */
export function BulkAddToEventSheet({
  people,
  upcoming,
  defaultEventId,
  onClose,
  onDone,
}: {
  people: BulkAddCandidate[];
  upcoming: PoEvent[];
  defaultEventId?: string;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const ba = t.guests.bulkAdd;
  const bulkAdd = usePoBulkAddToEvent();
  const [evId, setEvId] = useState<string>(
    defaultEventId && upcoming.some((e) => e.id === defaultEventId) ? defaultEventId : upcoming[0]?.id ?? '',
  );
  const { data: tiers = [], isLoading: tiersLoading } = usePoTiers(evId);
  const { data: quota } = usePoQuota(evId);
  const canCreateTier = quota?.exempt ?? false;
  const { data: evGuests = [] } = usePoGuests(evId);
  const evEdit = usePoEventForEdit(evId);
  const [tierId, setTierId] = useState<string>('');
  const [results, setResults] = useState<BulkAddRowResult[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (tiers.length === 0) {
      setTierId('');
      return;
    }
    if (!tiers.some((tr) => tr.id === tierId)) {
      const def = resolveDefaultTierId(tiers.map((tr) => ({ id: tr.id, name: tr.name, aliases: tr.aliases })));
      setTierId(def ?? tiers[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiers]);

  const scopeEvent = upcoming.find((e) => e.id === evId) ?? null;
  // Pre-check who is already on the target event (skip a wasted round-trip): match
  // linked people by contact id, name-only people by name.
  const existingContactIds = new Set(evGuests.map((g) => g.contactId).filter(Boolean) as string[]);
  const existingNames = new Set(evGuests.map((g) => g.name.trim().toLowerCase()));
  const planned: BulkAddPerson[] = people.map((p) => ({
    key: p.key,
    name: p.name,
    contactId: p.contactId,
    plusOnes: p.plus,
    alreadyOn: p.contactId ? existingContactIds.has(p.contactId) : existingNames.has(p.name.trim().toLowerCase()),
  }));

  const submit = (): void => {
    if (!evId || !tierId) return;
    setErr(null);
    bulkAdd.mutate(
      { targetEventId: evId, tierId, targetLocked: evEdit.data?.listLocked ?? false, people: planned },
      {
        onSuccess: (res) => setResults(res),
        onError: (e) => setErr(e instanceof Error ? e.message : ba.error),
      },
    );
  };

  if (results) {
    return (
      <Sheet onClose={() => { onDone(); onClose(); }} center={false}>
        <BulkResultView results={results} onClose={() => { onDone(); onClose(); }} />
      </Sheet>
    );
  }

  return (
    <Sheet onClose={onClose} center={false}>
      <div className="mb-1 font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">
        {fmt(ba.title, { n: people.length })}
      </div>
      <div className="mb-4 text-[13px] text-faint">{ba.pickEvent}</div>
      {upcoming.length === 0 ? (
        <Empty text={ba.noUpcoming} />
      ) : (
        <>
          <Label className="mb-2">{ba.eventLabel}</Label>
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
          <Label className="mb-2">{ba.ticketLabel}</Label>
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
          {err && <p className="mt-1 text-[12.5px] text-red-300" role="alert">{err}</p>}
          <Btn
            kind="primary"
            full
            icon="plus"
            className={cn('mt-2', (!evId || !tierId || bulkAdd.isPending) && 'opacity-[0.45]')}
            disabled={!evId || !tierId || bulkAdd.isPending}
            onClick={submit}
          >
            {bulkAdd.isPending ? ba.busy : fmt(ba.submit, { n: people.length, event: scopeEvent?.name ?? '' })}
          </Btn>
        </>
      )}
      <Btn kind="ghost" full className="mt-2" onClick={onClose}>
        {t.guests.contacts.cancel}
      </Btn>
    </Sheet>
  );
}

const OUTCOME_LABEL: Record<BulkAddOutcome, () => string> = {
  added: () => t.guests.bulkAdd.outcomeAdded,
  already: () => t.guests.bulkAdd.outcomeAlready,
  quota: () => t.guests.bulkAdd.outcomeQuota,
  tierFull: () => t.guests.bulkAdd.outcomeTierFull,
  locked: () => t.guests.bulkAdd.outcomeLocked,
  error: () => t.guests.bulkAdd.outcomeError,
};

/** Per-row result of a bulk add: a summary line + one chip per person. */
function BulkResultView({ results, onClose }: { results: BulkAddRowResult[]; onClose: () => void }): JSX.Element {
  const ba = t.guests.bulkAdd;
  const counts = summarizeBulkAdd(results);
  const blocked = counts.quota + counts.tierFull + counts.locked + counts.error;
  return (
    <>
      <div className="mb-1 font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">{ba.resultTitle}</div>
      <div className="mb-4 text-[13px] text-faint">
        {fmt(ba.summaryAdded, { n: counts.added })}
        {counts.already > 0 && ` · ${fmt(ba.summaryAlready, { n: counts.already })}`}
        {blocked > 0 && ` · ${fmt(ba.summaryBlocked, { n: blocked })}`}
      </div>
      <div className="flex max-h-[46vh] flex-col gap-1.5 overflow-y-auto">
        {results.map((r) => (
          <div key={r.key} className="flex items-center gap-2 rounded-[11px] border border-line bg-elev px-[12px] py-[9px]">
            <span className="min-w-0 flex-1 truncate font-display text-[13.5px] font-bold text-text">{r.name}</span>
            <span
              className={cn(
                'shrink-0 rounded-[7px] px-2 py-[3px] font-body text-[11px] font-bold',
                r.outcome === 'added'
                  ? 'bg-acc-dim text-acc'
                  : r.outcome === 'already'
                    ? 'border border-line2 text-faint'
                    : 'border border-red-500/30 text-red-300',
              )}
            >
              {OUTCOME_LABEL[r.outcome]()}
            </span>
          </div>
        ))}
      </div>
      <Btn kind="primary" full className="mt-4" onClick={onClose}>
        {ba.close}
      </Btn>
    </>
  );
}
