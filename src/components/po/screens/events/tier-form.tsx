'use client';

/**
 * The Guest tiers form sheet, for creating a tier AND editing one (z8uq9m0hw3,
 * item 5). Split out of `tiers.tsx`; the rules behind the fields live in
 * `src/features/events/tier-form.ts`.
 *
 * A real MODAL (feedback Max 12/7): fill in and save in one focused sheet, never
 * scroll past the existing tiers, and the actions sit right under the fields
 * even with the keyboard open.
 *
 * Controlled: the parent owns the draft, so "Save & add another" can hand in a
 * fresh draft without remounting the sheet.
 */
import type { JSX } from 'react';
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import { TIER_ALIASES_UI } from '@/features/guests/tiers';
import { draftAliases, draftMax, maxBelowUsed, type TierDraft } from '@/features/events/tier-form';
import { allColorsUsed } from '@/lib/po/tier-colors';
import { Btn, ColorSwatches, Field, Label, Note } from '../../kit';
import { Sheet } from '../../shell';

export function TierFormSheet({
  mode,
  draft,
  onChange,
  takenColors,
  used,
  pending,
  err,
  onSave,
  onClose,
}: {
  mode: 'create' | 'edit';
  draft: TierDraft;
  onChange: (next: TierDraft) => void;
  /** Colours other tiers already hold. On edit the parent leaves out the tier's
   *  OWN colour, so keeping it is never blocked. */
  takenColors: readonly string[];
  /** Edit only: people already on the tier, for the lowered-max warning. */
  used?: number;
  pending: boolean;
  err: string | null;
  /** stayOpen = "Save & add another" (create only). */
  onSave: (stayOpen: boolean) => void;
  onClose: () => void;
}): JSX.Element {
  const set = (patch: Partial<TierDraft>): void => onChange({ ...draft, ...patch });
  const allUsed = allColorsUsed(takenColors);
  const canSave = !!draft.name.trim() && !pending;
  const lowMax = mode === 'edit' && used !== undefined && maxBelowUsed(draft, used);

  return (
    <Sheet onClose={onClose} center={false}>
      <div className="mb-3 font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">
        {mode === 'edit' ? t.events.editTier : t.events.newTier}
      </div>
      <Field placeholder={t.events.tierNamePlaceholder} value={draft.name} onChange={(v) => set({ name: v })} autoFocus className="mb-3" />
      <Label className="mb-2">{t.events.tierKindLabel}</Label>
      <div className="mb-[14px] flex gap-2">
        {(['free', 'paid'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => set({ kind: k })}
            className={cn(
              'rounded-full px-[14px] py-[6px] font-display text-[13px] font-bold transition-[filter] hover:brightness-110',
              draft.kind === k ? 'bg-acc text-on-acc' : 'border border-line bg-elev text-dim',
            )}
          >
            {k === 'free' ? t.events.tierKindFree : t.events.tierKindPaid}
          </button>
        ))}
      </div>
      <Label className="mb-2">{t.events.color}</Label>
      <ColorSwatches
        value={draft.color}
        onPick={(color) => set({ color })}
        isDisabled={(c) => takenColors.includes(c) && !allUsed && c !== draft.color}
        className="mb-[14px]"
      />
      {allUsed && <div className="mb-[14px] text-[12px] text-faint">{t.events.colorAllUsedWarning}</div>}
      <Label className="mb-2">{t.events.maxOptional}</Label>
      <Field placeholder={t.events.maxPlaceholder} value={draft.max} onChange={(v) => set({ max: v })} inputMode="numeric" className="mb-[14px]" />
      {lowMax && (
        <Note icon="warn">{fmt(t.events.maxBelowUsed, { used: used ?? 0, max: draftMax(draft) ?? 0 })}</Note>
      )}
      {draft.kind === 'paid' && (
        <>
          <Label className="mb-2">{t.events.priceLabel}</Label>
          <Field placeholder={t.events.pricePlaceholder} value={draft.price} onChange={(v) => set({ price: v })} inputMode="decimal" className="mb-[14px]" />
          <Label className="mb-2">{t.events.vatLabel}</Label>
          <Field placeholder={t.events.vatPlaceholder} value={draft.vat} onChange={(v) => set({ vat: v })} inputMode="numeric" className="mb-[14px]" />
        </>
      )}
      {/* Aliases: create only, and only while the alias UI is on. The edit path
          never shows or sends them, so stored aliases survive an edit. */}
      {TIER_ALIASES_UI && mode === 'create' && (
        <>
          <Label className="mb-2">{t.events.aliasesFeedLabel}</Label>
          <Field icon="spark" placeholder={t.events.aliasesPlaceholder} value={draft.aliasText} onChange={(v) => set({ aliasText: v })} />
          {draft.aliasText.trim() && (
            <div className="mt-[10px] flex flex-wrap gap-1.5">
              {draftAliases(draft).map((a) => (
                <span key={a} className="rounded-[8px] border border-line bg-elev2 px-[9px] py-[5px] font-mono text-[12px] text-dim">
                  {a}
                </span>
              ))}
            </div>
          )}
        </>
      )}
      {err && <p className="mt-3 text-[13px] font-semibold text-[#E89AC0]" role="alert">{err}</p>}
      <div className="mt-4 flex flex-col gap-2">
        <Btn
          kind="primary"
          full
          icon="check"
          onClick={() => onSave(false)}
          disabled={!canSave}
          className={canSave ? '' : 'opacity-50'}
        >
          {pending ? t.events.saving : mode === 'edit' ? t.events.saveTierChanges : t.events.saveTier}
        </Btn>
        {mode === 'create' ? (
          <div className="flex gap-2">
            <Btn kind="dark" className={cn('flex-1', canSave ? '' : 'opacity-50')} onClick={() => onSave(true)} disabled={!canSave}>
              {t.events.saveTierAndNew}
            </Btn>
            <Btn kind="ghost" className="flex-1" onClick={onClose}>
              {t.events.cancelTier}
            </Btn>
          </div>
        ) : (
          <Btn kind="ghost" full onClick={onClose}>
            {t.events.cancelTier}
          </Btn>
        )}
      </div>
    </Sheet>
  );
}
