'use client';

import { useMemo, useState, useTransition } from 'react';
import { cn } from '@/lib/utils';
import {
  parseQuickAdd,
  resolveAmbiguity,
  type QuickAddTier,
  type AmbiguityChoice,
} from '../quick-add-parser';
import { addGuest } from '../actions';

interface QuickAddFieldProps {
  eventId: string;
  tiers: QuickAddTier[];
  defaultTierId: string;
  source?: 'app' | 'door';
  /** Remaining personal slots; null when unknown. Ignored when `exempt`. */
  remaining: number | null;
  /** Admin/organizer: no personal limit, so hide the quota hint. */
  exempt: boolean;
}

const plural = (n: number) => (n === 1 ? 'plek' : 'plekken');

/**
 * The quick-add field (decision #33): one input that parses free text into a
 * name, +N and a tier, with live preview chips, inline disambiguation, and a
 * quota-aware hint. Enter only fires once the line is unambiguous and named.
 */
export function QuickAddField({
  eventId,
  tiers,
  defaultTierId,
  source = 'app',
  remaining,
  exempt,
}: QuickAddFieldProps) {
  const [input, setInput] = useState('');
  const [manualTierId, setManualTierId] = useState<string | null>(null);
  const [manualPlus, setManualPlus] = useState<number | null>(null);
  const [choice, setChoice] = useState<AmbiguityChoice | null>(null);
  const [editingTier, setEditingTier] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const parsed = useMemo(
    () => parseQuickAdd(input, tiers, defaultTierId),
    [input, tiers, defaultTierId]
  );

  const isAmbiguous = parsed.status === 'ambiguous';
  const resolved = isAmbiguous && choice ? resolveAmbiguity(parsed, choice, defaultTierId) : null;

  const effName = (resolved ? resolved.name : parsed.name).trim();
  const effPlus = manualPlus ?? (resolved ? resolved.plusOnes : parsed.plusOnes);
  const effTierId = manualTierId ?? resolved?.tierId ?? parsed.tierId ?? defaultTierId;
  const effTier = tiers.find((t) => t.id === effTierId);
  const slots = 1 + effPlus;

  const needsChoice = isAmbiguous && !choice;
  const overQuota = !exempt && remaining !== null && slots > remaining;
  const canSubmit = !pending && effName !== '' && !needsChoice;

  function reset(value: string) {
    setInput(value);
    setManualTierId(null);
    setManualPlus(null);
    setChoice(null);
    setEditingTier(false);
    setError(null);
  }

  function submit() {
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      const res = await addGuest({
        eventId,
        tierId: effTierId,
        fullName: effName,
        plusOnes: effPlus,
        source,
      });
      if (res.ok) reset('');
      else setError(res.message);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="label" htmlFor="quick-add">
        Snel toevoegen
      </label>
      <div className="flex gap-2">
        <input
          id="quick-add"
          className="field flex-1"
          placeholder="Bijv. Juri Braakman +2 vip fles"
          value={input}
          autoComplete="off"
          onChange={(e) => reset(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button
          type="button"
          className="btn-primary disabled:cursor-not-allowed"
          disabled={!canSubmit || overQuota}
          onClick={submit}
        >
          {pending ? '…' : 'Toevoegen'}
        </button>
      </div>

      {/* Live preview chips (case a/b) */}
      {input.trim() !== '' && !isAmbiguous && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Chip>{effName || <span className="text-faint">wie?</span>}</Chip>
          <button
            type="button"
            className={chipClass}
            onClick={() => setEditingTier((v) => !v)}
            aria-label="Tier wijzigen"
          >
            {effTier?.name ?? '—'}
          </button>
          <Stepper value={effPlus} onChange={(n) => setManualPlus(Math.max(0, n))} />
          {!exempt && (
            <span className={cn('text-dim', overQuota && 'text-acc-soft')}>
              {slots} {plural(slots)}
              {remaining !== null && ` van je quotum`}
            </span>
          )}
        </div>
      )}

      {/* Tier corrector */}
      {editingTier && (
        <div className="flex flex-wrap gap-2">
          {tiers.map((t) => (
            <button
              key={t.id}
              type="button"
              className={cn(chipClass, t.id === effTierId && 'border-acc text-acc')}
              onClick={() => {
                setManualTierId(t.id);
                setEditingTier(false);
              }}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      {/* Inline disambiguation (case c) — never silently defaults (#33) */}
      {isAmbiguous && parsed.ambiguous && (
        <div className="card flex flex-col gap-2">
          <p className="text-sm text-dim">
            &lsquo;<span className="text-text">{parsed.ambiguous.text}</span>&rsquo; herken ik niet
            — bedoel je?
          </p>
          <div className="flex flex-wrap gap-2">
            {parsed.ambiguous.suggestions.map((s) => (
              <button
                key={s.tierId}
                type="button"
                className={cn(
                  chipClass,
                  choice?.kind === 'tier' && choice.tierId === s.tierId && 'border-acc text-acc'
                )}
                onClick={() => setChoice({ kind: 'tier', tierId: s.tierId })}
              >
                {s.tierName}
              </button>
            ))}
            <button
              type="button"
              className={cn(chipClass, choice?.kind === 'default' && 'border-acc text-acc')}
              onClick={() => setChoice({ kind: 'default' })}
            >
              {tiers.find((t) => t.id === defaultTierId)?.name ?? 'Standaard'}
            </button>
            <button
              type="button"
              className={cn(chipClass, choice?.kind === 'name' && 'border-acc text-acc')}
              onClick={() => setChoice({ kind: 'name' })}
            >
              Hoort bij de naam
            </button>
          </div>
          {choice && (
            <p className="text-sm text-dim">
              → <span className="text-text">{effName}</span> · {effTier?.name} · +{effPlus}
            </p>
          )}
        </div>
      )}

      {overQuota && (
        <p className="text-sm text-acc-soft">
          Dit ({slots} {plural(slots)}) past niet meer in je quotum
          {remaining !== null && ` (${remaining} over)`}.
        </p>
      )}
      {error && <p className="text-sm text-acc-soft">{error}</p>}
    </div>
  );
}

const chipClass =
  'inline-flex items-center gap-1 rounded-btn border border-line bg-elev2 px-3 py-1 text-sm transition-colors hover:border-line2';

function Chip({ children }: { children: React.ReactNode }) {
  return <span className={chipClass}>{children}</span>;
}

function Stepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-btn bg-acc-dim px-2 py-1">
      <button
        type="button"
        className="h-7 w-7 rounded-full bg-elev2 text-text disabled:opacity-40"
        onClick={() => onChange(value - 1)}
        disabled={value <= 0}
        aria-label="Min één"
      >
        −
      </button>
      <span className="min-w-[2.5rem] text-center font-display">+{value}</span>
      <button
        type="button"
        className="h-7 w-7 rounded-full bg-elev2 text-text"
        onClick={() => onChange(value + 1)}
        aria-label="Plus één"
      >
        +
      </button>
    </span>
  );
}
