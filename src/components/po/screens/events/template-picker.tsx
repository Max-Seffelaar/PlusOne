'use client';

/**
 * The "Start from" template chips on the new-event form (create-from-template,
 * 86exyp8gn). Split out of `edit.tsx` (z8uq9m0hw3) so the event form stays under
 * the 800-LOC line. Collapses past 4 chips — a venue with 10+ templates would
 * drown the form otherwise (retest T4, Q4) — and always keeps the active chip
 * visible, even when it sorts further down.
 */
import { type JSX, useState } from 'react';
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import type { PoTemplateRow } from '@/features/po/queries';
import { Label, Note, hitRingY6 } from '../../kit';

// The chips are 34.8px with a 1px border; an invisible 6px ring (kit
// `hitRingY6`) gives a 44.8px tap area on touch without changing how they look.
// Each ring reaches 5px past the chip, and wrapped rows sit 10px apart, so two
// rows' rings meet without overlapping (T1, iPad = touch).

/** A blank/template selector chip. */
function TemplateChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-[13px] py-[7px] font-display text-[12.5px] font-bold transition-colors',
        hitRingY6,
        active ? 'border-acc bg-acc-dim text-acc' : 'border-line text-dim hover:brightness-110',
      )}
    >
      {label}
    </button>
  );
}

export function TemplatePicker({
  templates,
  templateId,
  onChange,
}: {
  templates: PoTemplateRow[];
  /** null = blank event (the plain create path). */
  templateId: string | null;
  onChange: (templateId: string | null) => void;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  // Collapsed = first 4 (name-sorted), plus the selection if it lives further
  // down so the active chip never disappears.
  const shown = expanded ? [...templates] : templates.slice(0, 4);
  const selected = templateId ? templates.find((tpl) => tpl.id === templateId) : undefined;
  if (selected && !shown.some((tpl) => tpl.id === selected.id)) shown.push(selected);
  const hidden = templates.length - shown.length;
  return (
    <>
      <Label className="mb-2">{t.events.fieldTemplate}</Label>
      <div className="mb-[14px] flex flex-wrap gap-x-2 gap-y-[10px]">
        <TemplateChip label={t.events.templateBlank} active={!templateId} onClick={() => onChange(null)} />
        {shown.map((tpl) => (
          <TemplateChip key={tpl.id} label={tpl.name} active={templateId === tpl.id} onClick={() => onChange(tpl.id)} />
        ))}
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className={cn('rounded-full border border-dashed border-line px-[13px] py-[7px] font-display text-[12.5px] font-bold text-faint transition-colors hover:brightness-110', hitRingY6)}
          >
            {fmt(t.events.templateShowAll, { n: templates.length })}
          </button>
        )}
      </div>
      {templateId && (
        <div className="mb-[14px]">
          <Note icon="spark">{t.events.templateNote}</Note>
        </div>
      )}
    </>
  );
}
