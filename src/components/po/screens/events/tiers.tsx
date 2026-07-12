'use client';

/** Event tier + alias management — split from events.tsx (FE-5). */
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import { usePoEvent, usePoTiers } from '@/features/po/hooks';
import { usePoCreateTier, usePoUpdateTier } from '@/features/po/mutations';
import { TIER_COLORS, nextAvailableColor, allColorsUsed } from '@/lib/po/tier-colors';
import { useNav } from '../../context';
import { Icon } from '../../icon';
import { Btn, Empty, Field, IconBtn, Label, MiniChip, Note, Scroll, Top } from '../../kit';
import { Sheet } from '../../shell';
import { col } from './shared';

// ── TIERS & aliases (pushed) ─────────────────────────────────────────────────────

export function Tiers({ eventId }: { eventId?: string }): JSX.Element {
  const nav = useNav();
  const id = eventId ?? '';
  const { event } = usePoEvent(id);
  const { data: tierList, isLoading, isError } = usePoTiers(id);
  const createTier = usePoCreateTier(id);
  const updateTier = usePoUpdateTier(id);

  const usedColors = tierList?.map((tr) => tr.color) ?? [];

  const [adding, setAdding] = useState(false);
  const [nm, setNm] = useState('');
  const [color, setColor] = useState(() => nextAvailableColor(usedColors));
  const [kind, setKind] = useState<'free' | 'paid'>('free');
  const [max, setMax] = useState('');
  const [price, setPrice] = useState('');
  const [vat, setVat] = useState('9');
  const [aliasText, setAliasText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [aliasFor, setAliasFor] = useState<string | null>(null);
  const [newAlias, setNewAlias] = useState('');
  // Colors used by tiers created this session, before the tiers query refetches
  // (Save & add another must not immediately re-offer the color just taken).
  const [justAddedColors, setJustAddedColors] = useState<string[]>([]);

  const usedColorsForPicker = [...usedColors, ...justAddedColors];
  const allUsed = allColorsUsed(usedColorsForPicker);

  const resetForm = (extraUsed: string[] = []): void => {
    setNm('');
    setColor(nextAvailableColor([...usedColors, ...extraUsed]));
    setKind('free');
    setMax('');
    setPrice('');
    setVat('9');
    setAliasText('');
  };

  const openAdd = (): void => {
    setErr(null);
    resetForm(justAddedColors);
    setAdding(true);
  };

  const closeAdd = (): void => {
    setErr(null);
    setJustAddedColors([]);
    setAdding(false);
  };

  // Arriving on a tier-less event (setup nudge, "Guest tiers" row) opens the
  // create form directly — no extra tap on the + first (retest 3/7, Q10). Once
  // only, so deliberately closing the form doesn't bounce it back open.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || isLoading || isError) return;
    if ((tierList ?? []).length === 0) {
      autoOpened.current = true;
      setAdding(true);
    }
  }, [isLoading, isError, tierList]);

  const submit = async (stayOpen: boolean): Promise<void> => {
    if (!nm.trim() || createTier.isPending) return;
    setErr(null);
    const maxNum = Number.parseInt(max, 10);
    // Door price in euros → cents (#34, display only). Free tiers stay null.
    const priceNum = Number.parseFloat(price.replace(',', '.'));
    const doorPriceCents =
      kind === 'paid' && price.trim() && Number.isFinite(priceNum) && priceNum > 0 ? Math.round(priceNum * 100) : null;
    if (kind === 'paid' && doorPriceCents == null) {
      setErr(t.events.errPaidNeedsPrice);
      return;
    }
    const vatNum = Number.parseFloat(vat.replace(',', '.'));
    const vatPercent = kind === 'paid' && Number.isFinite(vatNum) ? vatNum : null;
    const usedColor = color;
    try {
      await createTier.mutateAsync({
        eventId: id,
        name: nm.trim(),
        color,
        maxGuests: Number.isFinite(maxNum) && maxNum > 0 ? maxNum : null,
        doorPriceCents,
        vatPercent,
        aliases: aliasText.split(',').map((a) => a.trim()).filter(Boolean),
      });
      if (stayOpen) {
        const nextJustAdded = [...justAddedColors, usedColor];
        setJustAddedColors(nextJustAdded);
        resetForm(nextJustAdded);
      } else {
        resetForm();
        setJustAddedColors([]);
        setAdding(false);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.events.errCreateTier);
    }
  };

  const commitAlias = async (tierId: string, current: string[]): Promise<void> => {
    const a = newAlias.trim().toLowerCase();
    setAliasFor(null);
    setNewAlias('');
    if (!a || current.includes(a)) return;
    setErr(null);
    try {
      await updateTier.mutateAsync({ tierId, aliases: [...current, a] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.events.errSaveAlias);
    }
  };

  return (
    <div className={col}>
      <Top
        onBack={nav.back}
        title={t.events.tiersTitle}
        sub={event?.name}
        right={<IconBtn name={adding ? 'close' : 'plus'} onClick={() => (adding ? closeAdd() : openAdd())} />}
      />
      <Scroll bottom={24}>
        {err && !adding && <div className="mb-3 text-[13px] font-semibold text-[#E89AC0]">{err}</div>}
        <Note icon="spark">{t.events.aliasesNote}</Note>
        {isLoading ? (
          <Empty text={t.events.loadingTiers} />
        ) : isError ? (
          <Empty text={t.events.loadTiersError} />
        ) : (tierList ?? []).length === 0 ? (
          !adding && (
            <button
              type="button"
              onClick={openAdd}
              className="flex w-full flex-col items-center gap-2 rounded-[18px] border border-dashed border-line bg-elev/40 py-[30px] text-center transition-[filter] hover:brightness-110"
            >
              <span className="text-[14px] text-faint">{t.events.emptyTiers}</span>
              <span className="font-display text-[14px] font-bold text-acc">{t.events.emptyTiersCta}</span>
            </button>
          )
        ) : (
          <div className="flex flex-col gap-[11px]">
            {(tierList ?? []).map((tier) => (
              <div key={tier.id} className="rounded-[18px] border border-line bg-elev p-[15px]">
                <div className="mb-3 flex items-center gap-[11px]">
                  <span className="h-[14px] w-[14px] shrink-0 rounded-full" style={{ background: tier.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-[15.5px] font-bold text-text">{tier.name}</div>
                    <div className="mt-px text-[12px] text-faint">{tier.max ? fmt(t.events.tierUsedOfMax, { used: tier.used, max: tier.max }) : fmt(t.events.tierUsedNoMax, { used: tier.used })}</div>
                  </div>
                  {tier.doorPrice > 0 && (
                    <span className="shrink-0 rounded-[7px] bg-acc-dim px-2 py-[3px] font-display text-[11.5px] font-bold text-acc">
                      €{tier.doorPrice % 1 === 0 ? tier.doorPrice : tier.doorPrice.toFixed(2)}
                    </span>
                  )}
                  {tier.doorPrice > 0 && tier.vatPercent != null && (
                    <span className="shrink-0 rounded-[7px] border border-line2 bg-transparent px-2 py-[3px] font-display text-[10.5px] font-semibold text-faint">
                      {fmt(t.events.tierVatChip, { pct: tier.vatPercent % 1 === 0 ? tier.vatPercent : tier.vatPercent.toFixed(1) })}
                    </span>
                  )}
                  {tier.isDefault && <MiniChip>{t.events.tierDefault}</MiniChip>}
                </div>
                {tier.max && (
                  <div className="mb-3 h-[6px] overflow-hidden rounded-[4px] bg-elev2">
                    <div className="h-full rounded-[4px]" style={{ width: Math.min(100, (tier.used / tier.max) * 100) + '%', background: tier.color }} />
                  </div>
                )}
                <Label className="mb-2">{t.events.aliases}</Label>
                <div className="flex flex-wrap gap-1.5">
                  {tier.aliases.map((a) => (
                    <span key={a} className="inline-flex items-center gap-[5px] rounded-[8px] border border-line bg-elev2 px-[9px] py-[5px] font-mono text-[12px] text-dim">
                      {a}
                    </span>
                  ))}
                  {aliasFor === tier.id ? (
                    <input
                      autoFocus
                      value={newAlias}
                      onChange={(e) => setNewAlias(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void commitAlias(tier.id, tier.aliases);
                        if (e.key === 'Escape') {
                          setAliasFor(null);
                          setNewAlias('');
                        }
                      }}
                      onBlur={() => {
                        setAliasFor(null);
                        setNewAlias('');
                      }}
                      placeholder={t.events.aliasInputPlaceholder}
                      className="w-[120px] rounded-[8px] border border-acc bg-elev2 px-[9px] py-[5px] font-mono text-[12px] text-text outline-none placeholder:text-faint"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setAliasFor(tier.id);
                        setNewAlias('');
                      }}
                      className="inline-flex items-center gap-1 rounded-[8px] border border-dashed border-line bg-transparent px-[9px] py-[5px] font-body text-[12px] text-faint transition-[filter] hover:brightness-[1.2]"
                    >
                      <Icon name="plus" size={12} sw={2.4} />
                      {t.events.aliasAdd}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Scroll>
        {/* New-tier form is a real MODAL (feedback Max 12/7): fill in and save in
            one focused sheet — never scroll past the existing tiers, and the
            actions sit right under the fields even with the keyboard open. */}
        {adding && (
          <Sheet onClose={closeAdd} center={false}>
            <div className="mb-3 font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">{t.events.newTier}</div>
            <Field placeholder={t.events.tierNamePlaceholder} value={nm} onChange={setNm} autoFocus className="mb-3" />
            <Label className="mb-2">{t.events.tierKindLabel}</Label>
            <div className="mb-[14px] flex gap-2">
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
            <Label className="mb-2">{t.events.color}</Label>
            <div className="mb-[14px] flex flex-wrap gap-[9px]">
              {TIER_COLORS.map((c) => {
                const disabled = usedColorsForPicker.includes(c) && !allUsed && c !== color;
                return (
                  <button
                    key={c}
                    type="button"
                    disabled={disabled}
                    aria-disabled={disabled}
                    onClick={() => !disabled && setColor(c)}
                    className={cn(
                      'h-[34px] w-[34px] rounded-full transition-[filter]',
                      disabled ? 'cursor-not-allowed opacity-30' : 'cursor-pointer hover:brightness-[1.1]',
                    )}
                    style={{ background: c, border: '2px solid ' + (color === c ? '#FFFFFF' : 'transparent') }}
                    aria-label={fmt(t.events.colorAria, { color: c })}
                  />
                );
              })}
            </div>
            {allUsed && <div className="mb-[14px] text-[12px] text-faint">{t.events.colorAllUsedWarning}</div>}
            <Label className="mb-2">{t.events.maxOptional}</Label>
            <Field placeholder={t.events.maxPlaceholder} value={max} onChange={setMax} inputMode="numeric" className="mb-[14px]" />
            {kind === 'paid' && (
              <>
                <Label className="mb-2">{t.events.priceLabel}</Label>
                <Field placeholder={t.events.pricePlaceholder} value={price} onChange={setPrice} inputMode="numeric" className="mb-[14px]" />
                <Label className="mb-2">{t.events.vatLabel}</Label>
                <Field placeholder={t.events.vatPlaceholder} value={vat} onChange={setVat} inputMode="numeric" className="mb-[14px]" />
              </>
            )}
            <Label className="mb-2">{t.events.aliasesFeedLabel}</Label>
            <Field icon="spark" placeholder={t.events.aliasesPlaceholder} value={aliasText} onChange={setAliasText} />
            {aliasText.trim() && (
              <div className="mt-[10px] flex flex-wrap gap-1.5">
                {aliasText
                  .split(',')
                  .map((a) => a.trim())
                  .filter(Boolean)
                  .map((a) => (
                    <span key={a} className="rounded-[8px] border border-line bg-elev2 px-[9px] py-[5px] font-mono text-[12px] text-dim">
                      {a}
                    </span>
                  ))}
              </div>
            )}
            {err && <p className="mt-3 text-[13px] font-semibold text-[#E89AC0]" role="alert">{err}</p>}
            <div className="mt-4 flex flex-col gap-2">
              <Btn
                kind="primary"
                full
                icon="check"
                onClick={() => void submit(false)}
                disabled={!nm.trim() || createTier.isPending}
                className={nm.trim() && !createTier.isPending ? '' : 'opacity-50'}
              >
                {createTier.isPending ? t.events.saving : t.events.saveTier}
              </Btn>
              <div className="flex gap-2">
                <Btn
                  kind="dark"
                  className={cn('flex-1', nm.trim() && !createTier.isPending ? '' : 'opacity-50')}
                  onClick={() => void submit(true)}
                  disabled={!nm.trim() || createTier.isPending}
                >
                  {t.events.saveTierAndNew}
                </Btn>
                <Btn kind="ghost" className="flex-1" onClick={closeAdd}>
                  {t.events.cancelTier}
                </Btn>
              </div>
            </div>
          </Sheet>
        )}
    </div>
  );
}
