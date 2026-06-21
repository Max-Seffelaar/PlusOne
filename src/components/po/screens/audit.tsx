'use client';

/** Mobile Audit-log (S10, #15) — the immutable logbook in po mobile language:
 *  chronological, translated Dutch sentences ("Max verplaatste Juri van Regular
 *  naar VIP · za 23:14"), a bottom-sheet filter (event / gebruiker / actie +
 *  zoeken), and a per-guest geschiedenis-tijdlijn. Reads the same audit_feed as
 *  the desktop /admin/audit over the browser client; the Dutch sentences come
 *  from the SHARED features/audit/translate.ts. Gated to admin/finance + AAL2 —
 *  RLS is the real boundary, this only renders the right state. Reached from the
 *  Meer hub. */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { formatWhen, type AuditLine } from '@/features/audit/translate';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { usePoAal2, usePoAuditFeed, usePoAuditFilterOptions, usePoGuestHistory } from '@/features/po/hooks';
import { venueCapabilities } from '@/features/venues/access';
import {
  AUDIT_ACTION_FILTERS,
  auditActionMeta,
  guestStatusLabel,
  isDoorDevice,
} from '@/features/po/audit-presenter';
import { useMfaGate } from '../mfa-gate';
import { useNav } from '../context';
import { Icon } from '../icon';
import { Avatar, Btn, Empty, Field, IconBtn, Label, Note, Scroll, Top } from '../kit';
import { Sheet } from '../shell';

const col = 'flex h-full flex-col';
const press = 'transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]';

interface FilterState {
  eventId?: string;
  actorId?: string;
  action: string;
  search: string;
}
const EMPTY_FILTERS: FilterState = { action: 'all', search: '' };

export function AuditLog({ eventId }: { eventId?: string }): JSX.Element {
  const nav = useNav();
  const { roles, venueName } = usePoIdentity();
  const canAudit = venueCapabilities(roles).viewAudit;
  const aal = usePoAal2();
  const mfa = useMfaGate();

  // Pre-scope to an event when arriving from the home's activity feed; the filter
  // sheet still lets the user widen back to "Alle events".
  const [filters, setFilters] = useState<FilterState>(
    eventId ? { ...EMPTY_FILTERS, eventId } : EMPTY_FILTERS
  );
  const [sheetOpen, setSheetOpen] = useState(false);
  const [guestId, setGuestId] = useState<string | null>(null);

  const feed = usePoAuditFeed(
    {
      eventId: filters.eventId,
      actorId: filters.actorId,
      action: filters.action,
      search: filters.search.trim() || undefined,
    },
    { enabled: canAudit && aal.isAal2 }
  );

  // No admin/finance role → never even attempt to read (RLS would refuse anyway).
  if (!canAudit) {
    return (
      <div className={col}>
        <Top onBack={nav.back} title="Audit log" />
        <Scroll bottom={28}>
          <Empty text="Je hebt geen rechten om het audit log in te zien." />
        </Scroll>
      </div>
    );
  }

  // Per-guest "geschiedenis" (filter op gast) — its own back goes to the feed.
  if (guestId) {
    return <GuestHistoryView guestId={guestId} onBack={() => setGuestId(null)} />;
  }

  const filtersActive =
    filters.action !== 'all' || !!filters.eventId || !!filters.actorId || !!filters.search.trim();
  const lines = feed.data ?? [];

  return (
    <div className={col}>
      <Top
        onBack={nav.back}
        title="Audit log"
        sub={venueName ?? undefined}
        right={
          aal.isAal2 ? (
            <>
              <IconBtn name="refresh" onClick={() => void feed.refetch()} />
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                aria-label="Filteren"
                className={cn(
                  'relative flex h-[40px] w-[40px] items-center justify-center rounded-[12px] border bg-elev text-text',
                  press,
                  filtersActive ? 'border-acc' : 'border-line'
                )}
              >
                <Icon name="filter" size={19} />
                {filtersActive && (
                  <span className="absolute -right-[3px] -top-[3px] h-[10px] w-[10px] rounded-full border-2 border-bg bg-acc" />
                )}
              </button>
            </>
          ) : undefined
        }
      />
      <Scroll bottom={28}>
        <Note icon="shield">
          Onveranderlijk logboek — geschreven door database-triggers, nooit door app-code (#15). Inzage
          vereist Beheerder/Financiën + MFA.
        </Note>

        {!aal.isAal2 ? (
          aal.loading ? (
            <Empty text="Laden…" />
          ) : (
            <div className="rounded-[18px] border border-acc-dim bg-acc-dim p-5">
              <div className="mb-1 flex items-center gap-[10px]">
                <Icon name="shield" size={20} stroke="#B5A6FF" />
                <span className="font-display text-[16px] font-bold text-text">MFA vereist</span>
              </div>
              <div className="mb-4 text-[13px] leading-[1.5] text-dim">
                Inzage in het onveranderlijke logboek vereist een tweestaps-geverifieerde sessie.
              </div>
              <Btn kind="primary" full icon="shield" onClick={() => mfa.start(() => aal.recheck())}>
                Verifieer met MFA
              </Btn>
            </div>
          )
        ) : feed.isLoading ? (
          <Empty text="Laden…" />
        ) : feed.isError ? (
          <Empty text="Kon het audit log niet laden." />
        ) : lines.length === 0 ? (
          <Empty text={filtersActive ? 'Geen resultaten voor deze filters.' : 'Nog niets gelogd.'} />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {lines.map((l) => (
              <AuditRow
                key={l.id}
                line={l}
                onHistory={l.guestId ? () => setGuestId(l.guestId) : undefined}
              />
            ))}
          </ul>
        )}
      </Scroll>

      {sheetOpen && (
        <FilterSheet
          current={filters}
          onApply={(f) => {
            setFilters(f);
            setSheetOpen(false);
          }}
          onClose={() => setSheetOpen(false)}
        />
      )}
      {mfa.sheet}
    </div>
  );
}

// ── One log line ─────────────────────────────────────────────────────────────
function AuditRow({ line, onHistory }: { line: AuditLine; onHistory?: () => void }): JSX.Element {
  const meta = auditActionMeta(line.action);
  const door = isDoorDevice(line.device);
  const inner = (
    <>
      <span
        className={cn(
          'flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-[12px] border',
          door ? 'border-transparent bg-acc-dim text-acc' : 'border-line bg-elev2 text-dim'
        )}
      >
        <Icon name={meta.icon} size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] leading-[1.4] text-dim">
          <span className="font-semibold text-text">{line.actor}</span> {line.text}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11.5px] text-faint">
          {line.event && (
            <>
              <span className="max-w-[150px] truncate">{line.event}</span>
              <span className="text-ghost">·</span>
            </>
          )}
          <span>{formatWhen(line.iso)}</span>
          <span className="text-ghost">·</span>
          <span className={cn('inline-flex items-center gap-1', door && 'text-acc')}>
            <span className={cn('h-[6px] w-[6px] rounded-full', door ? 'bg-acc' : 'bg-ghost')} />
            {line.device}
          </span>
        </span>
      </span>
      {onHistory && <Icon name="history" size={16} className="mt-1 shrink-0 self-start text-ghost" />}
    </>
  );

  if (onHistory) {
    return (
      <li>
        <button
          type="button"
          onClick={onHistory}
          aria-label={`Geschiedenis van ${line.entity}`}
          className={cn(
            'flex w-full items-start gap-[12px] rounded-[14px] border border-line bg-elev p-[12px] text-left',
            press
          )}
        >
          {inner}
        </button>
      </li>
    );
  }
  return (
    <li className="flex items-start gap-[12px] rounded-[14px] border border-line bg-elev p-[12px]">
      {inner}
    </li>
  );
}

// ── Filter sheet (event / gebruiker / actie + zoeken) ────────────────────────
function FilterSheet({
  current,
  onApply,
  onClose,
}: {
  current: FilterState;
  onApply: (f: FilterState) => void;
  onClose: () => void;
}): JSX.Element {
  const options = usePoAuditFilterOptions();
  const [draft, setDraft] = useState<FilterState>(current);
  const events = options.data?.events ?? [];
  const actors = options.data?.actors ?? [];

  const optRow = (active: boolean): string =>
    cn(
      'flex min-h-[44px] w-full items-center justify-between gap-3 rounded-[12px] border px-[14px] py-[11px] text-left',
      press,
      active ? 'border-transparent bg-acc-dim' : 'border-line bg-elev'
    );

  return (
    <Sheet onClose={onClose} center={false}>
      <div className="mb-3 flex items-center justify-between">
        <Label>Filteren</Label>
        <button
          type="button"
          onClick={() => setDraft(EMPTY_FILTERS)}
          className={cn('font-body text-[12.5px] font-semibold text-faint', press)}
        >
          Wissen
        </button>
      </div>

      <div className="po-scroll -mx-1 max-h-[58vh] overflow-y-auto px-1">
        <Field
          icon="search"
          placeholder="Zoek op naam…"
          value={draft.search}
          onChange={(v) => setDraft((d) => ({ ...d, search: v }))}
          className="mb-4"
        />

        <Label className="mb-2">Actie</Label>
        <div className="mb-4 flex flex-wrap gap-1.5">
          {AUDIT_ACTION_FILTERS.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => setDraft((d) => ({ ...d, action: a.key }))}
              className={cn(
                'rounded-full border px-[14px] py-[9px] font-display text-[12.5px] font-bold',
                press,
                draft.action === a.key ? 'border-transparent bg-acc text-on-acc' : 'border-line text-dim'
              )}
            >
              {a.label}
            </button>
          ))}
        </div>

        <Label className="mb-2">Event</Label>
        <div className="mb-4 flex flex-col gap-1.5">
          <button type="button" onClick={() => setDraft((d) => ({ ...d, eventId: undefined }))} className={optRow(!draft.eventId)}>
            <span className="font-display text-[14px] font-bold text-text">Alle events</span>
            {!draft.eventId && <Icon name="check" size={16} className="shrink-0 text-acc" />}
          </button>
          {events.map((e) => (
            <button key={e.id} type="button" onClick={() => setDraft((d) => ({ ...d, eventId: e.id }))} className={optRow(draft.eventId === e.id)}>
              <span className="min-w-0 truncate font-display text-[14px] font-bold text-text">{e.name}</span>
              {draft.eventId === e.id && <Icon name="check" size={16} className="shrink-0 text-acc" />}
            </button>
          ))}
        </div>

        <Label className="mb-2">Gebruiker</Label>
        <div className="mb-1 flex flex-col gap-1.5">
          <button type="button" onClick={() => setDraft((d) => ({ ...d, actorId: undefined }))} className={optRow(!draft.actorId)}>
            <span className="font-display text-[14px] font-bold text-text">Alle gebruikers</span>
            {!draft.actorId && <Icon name="check" size={16} className="shrink-0 text-acc" />}
          </button>
          {actors.map((a) => (
            <button key={a.id} type="button" onClick={() => setDraft((d) => ({ ...d, actorId: a.id }))} className={optRow(draft.actorId === a.id)}>
              <span className="min-w-0 truncate font-display text-[14px] font-bold text-text">{a.name}</span>
              {draft.actorId === a.id && <Icon name="check" size={16} className="shrink-0 text-acc" />}
            </button>
          ))}
        </div>
      </div>

      <Btn kind="primary" full icon="check" className="mt-4" onClick={() => onApply(draft)}>
        Toon resultaten
      </Btn>
    </Sheet>
  );
}

// ── Per-guest geschiedenis-tijdlijn ──────────────────────────────────────────
function GuestHistoryView({ guestId, onBack }: { guestId: string; onBack: () => void }): JSX.Element {
  const history = usePoGuestHistory(guestId);
  const guest = history.data?.guest ?? null;
  const lines = history.data?.lines ?? [];

  return (
    <div className={col}>
      <Top onBack={onBack} title="Geschiedenis" sub={guest?.fullName ?? undefined} />
      <Scroll bottom={28}>
        {history.isLoading ? (
          <Empty text="Laden…" />
        ) : history.isError ? (
          <Empty text="Kon de geschiedenis niet laden." />
        ) : (
          <>
            <div className="mb-5 rounded-[18px] border border-line bg-elev p-4">
              <Label className="mb-2">Geschiedenis van</Label>
              {guest ? (
                <div className="flex items-center gap-[13px]">
                  <Avatar name={guest.fullName} size={46} />
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-[18px] font-bold text-text">
                      {guest.fullName}
                      {guest.plusOnes > 0 && <span className="text-acc"> +{guest.plusOnes}</span>}
                    </div>
                    <div className="mt-0.5 truncate text-[12.5px] text-faint">
                      {[guest.eventName, guest.tierName, guestStatusLabel(guest.status)]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-[13.5px] text-dim">Deze gast is niet (meer) zichtbaar.</div>
              )}
            </div>

            <Label className="mb-3">Tijdlijn</Label>
            {lines.length === 0 ? (
              <Empty text="Nog geen gebeurtenissen voor deze gast." />
            ) : (
              <ul className="flex flex-col">
                {lines.map((l, i) => (
                  <TimelineRow key={l.id} line={l} last={i === lines.length - 1} />
                ))}
              </ul>
            )}
          </>
        )}
      </Scroll>
    </div>
  );
}

function TimelineRow({ line, last }: { line: AuditLine; last: boolean }): JSX.Element {
  const meta = auditActionMeta(line.action);
  const door = isDoorDevice(line.device);
  return (
    <li className="relative flex gap-[14px]">
      <div className="relative flex w-[34px] shrink-0 flex-col items-center">
        <span
          className={cn(
            'z-10 mt-0.5 flex h-[34px] w-[34px] items-center justify-center rounded-[11px] border',
            door ? 'border-transparent bg-acc-dim text-acc' : 'border-line bg-elev2 text-dim'
          )}
        >
          <Icon name={meta.icon} size={16} />
        </span>
        {!last && <span className="absolute bottom-0 left-1/2 top-[34px] w-px -translate-x-1/2 bg-line2" />}
      </div>
      <div className="flex-1 pb-5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-display text-[12px] font-bold uppercase tracking-[0.03em] text-faint">
            {meta.label}
          </span>
          <span className="text-[12px] text-faint">{formatWhen(line.iso)}</span>
        </div>
        <p className="mt-1.5 text-[14px] leading-[1.45] text-dim">
          <span className="font-semibold text-text">{line.actor}</span> {line.text}
        </p>
        <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-faint">
          <Avatar name={line.actor} size={18} />
          <span>{line.actor}</span>
          <span className="text-ghost">·</span>
          <span className={cn(door && 'text-acc')}>{line.device}</span>
        </div>
      </div>
    </li>
  );
}
