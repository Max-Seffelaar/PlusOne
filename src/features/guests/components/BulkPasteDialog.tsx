'use client';

import { useMemo, useState, useTransition } from 'react';
import { cn } from '@/lib/utils';
import {
  parseBulk,
  resolveAmbiguity,
  totalSlots,
  type QuickAddTier,
  type AmbiguityChoice,
  type ParseResult,
} from '../quick-add-parser';
import { addGuestsBulk } from '../actions';

interface BulkPasteDialogProps {
  eventId: string;
  tiers: QuickAddTier[];
  defaultTierId: string;
  source?: 'app' | 'door';
  remaining: number | null;
  exempt: boolean;
}

const plural = (n: number) => (n === 1 ? 'plek' : 'plekken');

/**
 * Bulk paste (decision #33): paste a WhatsApp-style list, preview the parsed
 * rows with total quota impact, resolve the rows that need a decision via the
 * same chips, and confirm the rest in one go. A quota overage blocks the whole
 * batch (the DB enforces this too — this is just early UI feedback).
 *
 * Design note: #33 calls for "geel gemarkeerd" rows, but the PLUSONE design
 * system (#38) permits only the lavender accent — so rows needing a decision
 * are marked with the accent, not yellow.
 */
export function BulkPasteDialog({
  eventId,
  tiers,
  defaultTierId,
  source = 'app',
  remaining,
  exempt,
}: BulkPasteDialogProps) {
  const [text, setText] = useState('');
  const [choices, setChoices] = useState<Record<number, AmbiguityChoice>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const rows = useMemo(() => parseBulk(text, tiers, defaultTierId), [text, tiers, defaultTierId]);

  const resolvedRows = rows.map((r, i) => resolveRow(r, choices[i], defaultTierId));
  const total = totalSlots(resolvedRows.map((r) => ({ plusOnes: r.plusOnes })));
  const unresolved = resolvedRows.filter((r) => r.needsChoice || r.name === '').length;
  const overQuota = !exempt && remaining !== null && total > remaining;
  const canConfirm = !pending && rows.length > 0 && unresolved === 0 && !overQuota;

  function confirm() {
    if (!canConfirm) return;
    setError(null);
    startTransition(async () => {
      const res = await addGuestsBulk({
        eventId,
        source,
        guests: resolvedRows.map((r) => ({
          fullName: r.name,
          plusOnes: r.plusOnes,
          tierId: r.tierId,
        })),
      });
      if (res.ok) {
        setText('');
        setChoices({});
      } else {
        setError(res.message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="label" htmlFor="bulk-paste">
        Lijst plakken
      </label>
      <textarea
        id="bulk-paste"
        className="field min-h-[7rem] font-mono text-sm"
        placeholder={'Juri Braakman +2 vip\nSanne Mulder\nLotte fles'}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setChoices({});
          setError(null);
        }}
      />

      {rows.length > 0 && (
        <>
          <div className="overflow-hidden rounded-card border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-faint">
                  <th className="px-3 py-2 font-medium">Naam</th>
                  <th className="px-3 py-2 font-medium">Tier</th>
                  <th className="px-3 py-2 font-medium">+N</th>
                  <th className="px-3 py-2 font-medium">Plekken</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const res = resolvedRows[i];
                  const flagged = res.needsChoice || res.name === '';
                  return (
                    <tr
                      key={i}
                      className={cn(
                        'border-b border-line2 align-top',
                        flagged && 'bg-acc-dim'
                      )}
                    >
                      <td className="px-3 py-2">
                        {res.name || <span className="text-faint">{r.raw}</span>}
                      </td>
                      <td className="px-3 py-2">
                        {res.needsChoice ? (
                          <AmbiguityChips
                            parsed={r}
                            tiers={tiers}
                            defaultTierId={defaultTierId}
                            value={choices[i]}
                            onChoose={(c) => setChoices((prev) => ({ ...prev, [i]: c }))}
                          />
                        ) : (
                          (tiers.find((t) => t.id === res.tierId)?.name ?? '—')
                        )}
                      </td>
                      <td className="px-3 py-2">+{res.plusOnes}</td>
                      <td className="px-3 py-2">{1 + res.plusOnes}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={cn('text-sm text-dim', overQuota && 'text-acc-soft')}>
              {rows.length} {rows.length === 1 ? 'regel' : 'regels'} · {total} {plural(total)}
              {!exempt && remaining !== null && ` · ${remaining} over in je quotum`}
            </span>
            <button
              type="button"
              className="btn-primary disabled:cursor-not-allowed"
              disabled={!canConfirm}
              onClick={confirm}
            >
              {pending ? '…' : `Bevestig ${rows.length} ${rows.length === 1 ? 'gast' : 'gasten'}`}
            </button>
          </div>

          {unresolved > 0 && (
            <p className="text-sm text-dim">
              {unresolved} {unresolved === 1 ? 'regel heeft' : 'regels hebben'} nog een keuze nodig.
            </p>
          )}
          {overQuota && (
            <p className="text-sm text-acc-soft">
              Deze lijst ({total} {plural(total)}) overschrijdt je quotum
              {remaining !== null && ` (${remaining} over)`} — de hele batch wordt geblokkeerd.
            </p>
          )}
          {error && <p className="text-sm text-acc-soft">{error}</p>}
        </>
      )}
    </div>
  );
}

interface ResolvedRow {
  name: string;
  plusOnes: number;
  tierId: string;
  needsChoice: boolean;
}

function resolveRow(
  r: ParseResult,
  choice: AmbiguityChoice | undefined,
  defaultTierId: string
): ResolvedRow {
  if (r.status === 'ambiguous') {
    if (!choice) return { name: r.name, plusOnes: r.plusOnes, tierId: defaultTierId, needsChoice: true };
    const res = resolveAmbiguity(r, choice, defaultTierId);
    return { name: res.name, plusOnes: res.plusOnes, tierId: res.tierId, needsChoice: false };
  }
  return {
    name: r.name,
    plusOnes: r.plusOnes,
    tierId: r.tierId ?? defaultTierId,
    needsChoice: false,
  };
}

function AmbiguityChips({
  parsed,
  tiers,
  defaultTierId,
  value,
  onChoose,
}: {
  parsed: ParseResult;
  tiers: QuickAddTier[];
  defaultTierId: string;
  value: AmbiguityChoice | undefined;
  onChoose: (c: AmbiguityChoice) => void;
}) {
  const chip = 'rounded-btn border border-line bg-elev2 px-2 py-0.5 text-xs hover:border-line2';
  const active = 'border-acc text-acc';
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-faint">
        &lsquo;{parsed.ambiguous?.text}&rsquo;?
      </span>
      <div className="flex flex-wrap gap-1">
        {parsed.ambiguous?.suggestions.map((s) => (
          <button
            key={s.tierId}
            type="button"
            className={cn(chip, value?.kind === 'tier' && value.tierId === s.tierId && active)}
            onClick={() => onChoose({ kind: 'tier', tierId: s.tierId })}
          >
            {s.tierName}
          </button>
        ))}
        <button
          type="button"
          className={cn(chip, value?.kind === 'default' && active)}
          onClick={() => onChoose({ kind: 'default' })}
        >
          {tiers.find((t) => t.id === defaultTierId)?.name ?? 'Standaard'}
        </button>
        <button
          type="button"
          className={cn(chip, value?.kind === 'name' && active)}
          onClick={() => onChoose({ kind: 'name' })}
        >
          Bij de naam
        </button>
      </div>
    </div>
  );
}
