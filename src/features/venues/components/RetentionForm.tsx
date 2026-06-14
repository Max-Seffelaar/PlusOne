'use client';

import { useState, useTransition } from 'react';
import { updateVenueRetentionAction } from '../actions';

// Preset windows mirror the mock VenueSettings AVG control (settings.tsx). A
// venue whose stored value is outside the presets (set via API within the DB's
// 1–60 range) gets its current value added as an extra chip so it stays visible.
const PRESETS = [6, 12, 24] as const;

export function RetentionForm({
  venueId,
  current,
}: {
  venueId: string;
  current: number;
}): JSX.Element {
  const [selected, setSelected] = useState(current);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const options = (PRESETS as readonly number[]).includes(current)
    ? [...PRESETS]
    : [...PRESETS, current].sort((a, b) => a - b);

  function choose(months: number): void {
    if (months === selected || pending) return;
    const previous = selected;
    setSelected(months);
    setSaved(false);
    setError(null);
    startTransition(async () => {
      const res = await updateVenueRetentionAction({ venueId, retentionMonths: months });
      if (res.ok) {
        setSaved(true);
      } else {
        setSelected(previous); // revert the optimistic choice
        setError(res.message);
      }
    });
  }

  return (
    <div>
      <div className="flex gap-2">
        {options.map((m) => (
          <button
            key={m}
            type="button"
            disabled={pending}
            aria-pressed={selected === m}
            onClick={() => choose(m)}
            className={`rounded-btn flex-1 border py-3 font-display text-sm font-bold transition-colors disabled:opacity-60 ${
              selected === m
                ? 'border-transparent bg-acc text-on-acc'
                : 'border-line bg-elev2 text-dim hover:border-acc'
            }`}
          >
            {m} mnd
          </button>
        ))}
      </div>
      <p className="text-faint mt-2 text-xs" aria-live="polite">
        {pending
          ? 'Opslaan…'
          : error
            ? <span className="text-red-300">{error}</span>
            : saved
              ? `Opgeslagen — gastdata wordt na ${selected} maanden geanonimiseerd.`
              : `Huidige bewaartermijn: ${selected} ${selected === 1 ? 'maand' : 'maanden'}.`}
      </p>
    </div>
  );
}
