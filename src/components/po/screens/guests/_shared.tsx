'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { usePoCreateTier } from '@/features/po/mutations';
import { usePoTiers } from '@/features/po/hooks';
import { t, fmt } from '@/lib/i18n';
import { TIER_COLORS, allColorsUsed, nextAvailableColor } from '@/lib/po/tier-colors';
import { Icon } from '../../icon';
import { Btn, Field, Label } from '../../kit';

export const cardPress = 'transition-[border-color,transform] hover:border-white/[0.24] active:scale-[0.99]';
export const press = 'transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]';
export const col = 'flex h-full flex-col';

/** Radio-style option row for the "already on the list" choice (bulk add). */
export function DupeOption({ on, onClick, title, sub }: { on: boolean; onClick: () => void; title: string; sub: string }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('flex items-center gap-[11px] rounded-[12px] border px-[13px] py-[10px] text-left', press, on ? 'border-transparent bg-bg' : 'border-line bg-transparent')}
    >
      <span className={cn('flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full border-2', on ? 'border-acc' : 'border-ghost')}>
        {on && <span className="h-[10px] w-[10px] rounded-full bg-acc" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[13.5px] font-bold text-text">{title}</span>
        <span className="block text-[11.5px] text-faint">{sub}</span>
      </span>
    </button>
  );
}

// ── NO-TIERS ESCAPE HATCH ────────────────────────────────────────────────────
// Shared by all three add flows (QuickAdd / BulkPaste / AddToEventSheet). When an
// event has no tiers yet the flows used to dead-end ("add one in event settings");
// now an admin/organizer can create the first tier inline and the add continues.
// No "default" flag exists on guest_tiers — resolveDefaultTierId picks the only/
// first tier — so the moment usePoCreateTier invalidates the tiers query the
// parent re-resolves defaultTierId, this block unmounts, and the add UI appears.
// `canCreate` mirrors the guest_tiers_insert RLS (admin OR event organizer,
// surfaced via the quota `exempt` flag); everyone else gets a "ask a beheerder"
// note instead of a button that would only fail with a 42501.

/** The inline create-a-tier form (name/color/price/alias), shared by
 *  NoTiersBlock (first tier) and AddTierInline (any next tier). */
function TierCreateFields({ eventId, onDone, onCancel }: { eventId: string; onDone?: () => void; onCancel: () => void }): JSX.Element {
  const createTier = usePoCreateTier(eventId);
  const { data: tierList } = usePoTiers(eventId);
  const usedColors = tierList?.map((tr) => tr.color) ?? [];
  const allUsed = allColorsUsed(usedColors);

  const [name, setName] = useState('');
  const [alias, setAlias] = useState('');
  const [color, setColor] = useState(() => nextAvailableColor(usedColors));
  const [kind, setKind] = useState<'free' | 'paid'>('free');
  const [price, setPrice] = useState('');
  const [vat, setVat] = useState('9');
  const [err, setErr] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    const nm = name.trim();
    if (!nm || createTier.isPending) return;
    setErr(null);
    const priceNum = Number.parseFloat(price.replace(',', '.'));
    const doorPriceCents =
      kind === 'paid' && price.trim() && Number.isFinite(priceNum) && priceNum > 0 ? Math.round(priceNum * 100) : null;
    if (kind === 'paid' && doorPriceCents == null) {
      setErr(t.events.errPaidNeedsPrice);
      return;
    }
    const vatNum = Number.parseFloat(vat.replace(',', '.'));
    const vatPercent = kind === 'paid' && Number.isFinite(vatNum) ? vatNum : null;
    try {
      await createTier.mutateAsync({
        eventId,
        name: nm,
        color,
        doorPriceCents,
        vatPercent,
        aliases: alias.split(',').map((a) => a.trim()).filter(Boolean),
      });
      onDone?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.guests.tierCreate.error);
    }
  };

  return (
    <div className="mt-3 flex flex-col gap-[12px]">
      <div>
        <Label className="mb-2">{t.guests.tierCreate.nameLabel}</Label>
        <Field autoFocus placeholder={t.guests.tierCreate.namePlaceholder} value={name} onChange={setName} maxLength={80} />
      </div>
      <div>
        <Label className="mb-2">{t.events.tierKindLabel}</Label>
        <div className="flex gap-2">
          {(['free', 'paid'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={cn(
                'rounded-full px-[14px] py-[6px] font-display text-[13px] font-bold transition-[filter] hover:brightness-110',
                kind === k ? 'bg-acc text-on-acc' : 'border border-line bg-elev text-dim',
              )}
            >
              {k === 'free' ? t.events.tierKindFree : t.events.tierKindPaid}
            </button>
          ))}
        </div>
      </div>
      <div>
        <Label className="mb-2">{t.guests.tierCreate.colorLabel}</Label>
        <div className="flex flex-wrap gap-[9px]">
          {TIER_COLORS.map((c) => {
            const disabled = usedColors.includes(c) && !allUsed;
            return (
              <button
                key={c}
                type="button"
                disabled={disabled}
                aria-disabled={disabled}
                onClick={() => !disabled && setColor(c)}
                className={cn(
                  'h-[30px] w-[30px] rounded-full transition-[filter]',
                  disabled ? 'cursor-not-allowed opacity-30' : 'cursor-pointer hover:brightness-[1.1]',
                )}
                style={{ background: c, border: '2px solid ' + (color === c ? '#FFFFFF' : 'transparent') }}
                aria-label={fmt(t.events.colorAria, { color: c })}
              />
            );
          })}
        </div>
        {allUsed && <p className="mt-2 text-[12px] text-faint">{t.events.colorAllUsedWarning}</p>}
      </div>
      {kind === 'paid' && (
        <>
          <div>
            <Label className="mb-2">{t.guests.tierCreate.priceLabel}</Label>
            <Field placeholder={t.guests.tierCreate.pricePlaceholder} value={price} onChange={setPrice} inputMode="numeric" />
          </div>
          <div>
            <Label className="mb-2">{t.events.vatLabel}</Label>
            <Field placeholder={t.events.vatPlaceholder} value={vat} onChange={setVat} inputMode="numeric" />
          </div>
        </>
      )}
      <div>
        <Label className="mb-2">{t.guests.tierCreate.aliasLabel}</Label>
        <Field icon="spark" placeholder={t.guests.tierCreate.aliasPlaceholder} value={alias} onChange={setAlias} />
      </div>
      {err && (
        <p className="text-[12.5px] text-red-300" role="alert">
          {err}
        </p>
      )}
      <div className="flex gap-2">
        <Btn
          kind="primary"
          icon="check"
          disabled={!name.trim() || createTier.isPending}
          className={!name.trim() || createTier.isPending ? 'opacity-[0.45]' : ''}
          onClick={() => void submit()}
        >
          {createTier.isPending ? t.guests.tierCreate.busy : t.guests.tierCreate.createBtn}
        </Btn>
        <Btn kind="ghost" onClick={onCancel}>
          {t.guests.tierCreate.cancel}
        </Btn>
      </div>
    </div>
  );
}

export function NoTiersBlock({ eventId, canCreate, className }: { eventId: string; canCreate: boolean; className?: string }): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <div className={cn('rounded-[16px] border border-line bg-elev p-[14px]', className)}>
      <div className="flex items-start gap-[11px]">
        <span className="mt-px shrink-0 text-acc">
          <Icon name="ticket" size={17} />
        </span>
        <div className="flex-1 text-[13.5px] leading-[1.45] text-faint">
          {t.guests.tierCreate.intro}{' '}
          {canCreate ? t.guests.tierCreate.introCreate : t.guests.tierCreate.introAsk}
        </div>
      </div>

      {canCreate && !open && (
        <Btn sm kind="primary" icon="plus" className="mt-3" onClick={() => setOpen(true)}>
          {t.guests.tierCreate.createBtn}
        </Btn>
      )}

      {/* Success needs no follow-up: the tiers query invalidates → the parent
          re-renders with a resolved defaultTierId → this block unmounts and the
          add flow takes over with the brand-new (default) tier selected. */}
      {canCreate && open && <TierCreateFields eventId={eventId} onCancel={() => setOpen(false)} />}
    </div>
  );
}

/** Always-available "Add tier" affordance for the add-guest flows once tiers
 *  exist (retest 3/7, Q12) — creating the first tier inline shouldn't be a
 *  one-shot. Collapsed it's a subtle dashed row; open it's the same form. */
export function AddTierInline({ eventId, className }: { eventId: string; className?: string }): JSX.Element {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'flex w-full items-center justify-center gap-[7px] rounded-[13px] border border-dashed border-line bg-transparent px-[13px] py-[10px] font-display text-[13px] font-bold text-faint transition-[filter] hover:brightness-[1.3]',
          className,
        )}
      >
        <Icon name="plus" size={14} sw={2.4} />
        {t.guests.tierCreate.addBtn}
      </button>
    );
  }

  return (
    <div className={cn('rounded-[16px] border border-acc bg-elev p-[14px]', className)}>
      <div className="flex items-center gap-[9px]">
        <Icon name="ticket" size={16} className="text-acc" />
        <Label>{t.guests.tierCreate.addBtn}</Label>
      </div>
      <TierCreateFields eventId={eventId} onDone={() => setOpen(false)} onCancel={() => setOpen(false)} />
    </div>
  );
}
