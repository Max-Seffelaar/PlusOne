'use client';

/**
 * Event tier management — split from events.tsx (FE-5). The alias parts of this
 * screen (the banner, the per-tier alias chips, the create-form field) render only
 * when `TIER_ALIASES_UI` is on; it is off since the ADE UX round (17/9/2026).
 *
 * Joeri walkthrough (z8uq9m0hw3):
 * - item 4: "Add another tier" is a full-width button under the list, not a "+"
 *   in the header. The empty state keeps its own "+ Add your first tier".
 * - item 5: a tier card opens the same form, prefilled, and saves through
 *   updateTier. Aliases are never sent on an edit (stored ones survive), the
 *   tier's own colour is never blocked, and a max below current use warns.
 * - item 7: `setup` is the guided step right after creating an event: a
 *   GuideCard on top and a bottom bar that moves on to the event. It does NOT
 *   auto-open the create form, so the guide is read before a sheet covers it.
 *
 * Adding and editing tiers is admin + organizer of this event (RLS
 * guest_tiers_insert/update); `usePoEventForEdit().canManage` is that same
 * rule, so other roles get a read-only list instead of a form RLS would refuse.
 */
import { type JSX, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import type { Tier } from '@/lib/po/types';
import { usePoEvent, usePoEventForEdit, usePoTiers } from '@/features/po/hooks';
import { usePoCreateTier, usePoUpdateTier } from '@/features/po/mutations';
import { TIER_ALIASES_UI } from '@/features/guests/tiers';
import { blankTierDraft, draftAliases, draftToWrite, tierToDraft, type TierDraft } from '@/features/events/tier-form';
import { nextAvailableColor } from '@/lib/po/tier-colors';
import { useNav } from '../../context';
import { Icon } from '../../icon';
import { Btn, Empty, GuideCard, Label, MiniChip, Note, Scroll, Top, cardPress } from '../../kit';
import { BottomBar } from '../../shell';
import { TierFormSheet } from './tier-form';
import { col } from './shared';

/** Which tier the form sheet works on: a new one, or an existing one. */
type FormTarget = { mode: 'create' } | { mode: 'edit'; tier: Tier };

// ── TIERS & aliases (pushed) ─────────────────────────────────────────────────────

export function Tiers({ eventId, setup }: { eventId?: string; setup?: boolean }): JSX.Element {
  const nav = useNav();
  const id = eventId ?? '';
  const { event } = usePoEvent(id);
  const { data: tierList, isLoading, isError } = usePoTiers(id);
  const { canManage, isLoading: permLoading } = usePoEventForEdit(id);
  const createTier = usePoCreateTier(id);
  const updateTier = usePoUpdateTier(id);

  const tiers = tierList ?? [];
  const usedColors = tiers.map((tr) => tr.color);

  const [form, setForm] = useState<FormTarget | null>(null);
  const [draft, setDraft] = useState<TierDraft>(() => blankTierDraft(nextAvailableColor(usedColors)));
  const [err, setErr] = useState<string | null>(null);
  const [aliasFor, setAliasFor] = useState<string | null>(null);
  const [newAlias, setNewAlias] = useState('');
  // Colors used by tiers created this session, before the tiers query refetches
  // (Save & add another must not immediately re-offer the color just taken).
  const [justAddedColors, setJustAddedColors] = useState<string[]>([]);

  // Colours the picker blocks: every other tier's. On an edit that excludes the
  // tier being edited, so keeping (or re-picking) its own colour always works.
  const takenColors =
    form?.mode === 'edit'
      ? tiers.filter((tr) => tr.id !== form.tier.id).map((tr) => tr.color)
      : [...usedColors, ...justAddedColors];

  const openAdd = (): void => {
    setErr(null);
    setDraft(blankTierDraft(nextAvailableColor([...usedColors, ...justAddedColors])));
    setForm({ mode: 'create' });
  };

  const openEdit = (tier: Tier): void => {
    setErr(null);
    setDraft(tierToDraft(tier));
    setForm({ mode: 'edit', tier });
  };

  const closeForm = (): void => {
    setErr(null);
    setJustAddedColors([]);
    setForm(null);
  };

  // Arriving on a tier-less event (setup nudge, "Guest tiers" row) opens the
  // create form directly — no extra tap first (retest 3/7, Q10). Once only, so
  // deliberately closing the form doesn't bounce it back open. Not in the
  // guided setup step, and never for a role that can't create a tier.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (setup || autoOpened.current || isLoading || isError || permLoading || !canManage) return;
    if ((tierList ?? []).length === 0) {
      autoOpened.current = true;
      setDraft(blankTierDraft(nextAvailableColor([])));
      setForm({ mode: 'create' });
    }
  }, [setup, isLoading, isError, permLoading, canManage, tierList]);

  const pending = createTier.isPending || updateTier.isPending;

  const submit = async (stayOpen: boolean): Promise<void> => {
    if (!form || pending) return;
    const parsed = draftToWrite(draft);
    if (!parsed.ok) {
      // An empty name never gets here (Save is disabled); a paid tier without a
      // usable price does.
      if (parsed.error === 'paid_needs_price') setErr(t.events.errPaidNeedsPrice);
      return;
    }
    setErr(null);
    try {
      if (form.mode === 'edit') {
        // Aliases deliberately omitted: the alias UI is hidden, and an edit
        // must never overwrite the stored list (TIER_ALIASES_UI).
        await updateTier.mutateAsync({ tierId: form.tier.id, ...parsed.value });
        closeForm();
        return;
      }
      await createTier.mutateAsync({
        eventId: id,
        ...parsed.value,
        // Alias UI hidden (TIER_ALIASES_UI): create with an empty list, never a
        // half-filled one from a field nobody can see.
        aliases: TIER_ALIASES_UI ? draftAliases(draft) : [],
      });
      if (stayOpen) {
        const nextJustAdded = [...justAddedColors, parsed.value.color];
        setJustAddedColors(nextJustAdded);
        setDraft(blankTierDraft(nextAvailableColor([...usedColors, ...nextJustAdded])));
      } else {
        closeForm();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : form.mode === 'edit' ? t.events.errUpdateTier : t.events.errCreateTier);
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

  /** Name, usage, price chips and the usage bar — the tappable part of a card. */
  const tierSummary = (tier: Tier): JSX.Element => (
    <>
      {/* `last:mb-0` keeps the card tight when the alias block below is
          hidden (TIER_ALIASES_UI) and this row ends up last. */}
      <div className="mb-3 flex items-center gap-[11px] last:mb-0">
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
        {canManage && <Icon name="chev" size={18} className="shrink-0 text-ghost" />}
      </div>
      {tier.max && (
        <div className="mb-3 h-[6px] overflow-hidden rounded-[4px] bg-elev2 last:mb-0">
          <div className="h-full rounded-[4px]" style={{ width: Math.min(100, (tier.used / tier.max) * 100) + '%', background: tier.color }} />
        </div>
      )}
    </>
  );

  return (
    <div className={col}>
      <Top onBack={nav.back} title={t.events.tiersTitle} sub={event?.name} />
      <Scroll bottom={24}>
        {setup && <GuideCard icon="ticket" title={t.events.setupStep.title} body={t.events.setupStep.body} />}
        {err && !form && <div className="mb-3 text-[13px] font-semibold text-[#E89AC0]">{err}</div>}
        {TIER_ALIASES_UI && <Note icon="spark">{t.events.aliasesNote}</Note>}
        {isLoading ? (
          <Empty text={t.events.loadingTiers} />
        ) : isError ? (
          <Empty text={t.events.loadTiersError} />
        ) : tiers.length === 0 ? (
          !form &&
          (canManage ? (
            <button
              type="button"
              onClick={openAdd}
              className="flex w-full flex-col items-center gap-2 rounded-[18px] border border-dashed border-line bg-elev/40 py-[30px] text-center transition-[filter] hover:brightness-110"
            >
              <span className="text-[14px] text-faint">{t.events.emptyTiers}</span>
              <span className="font-display text-[14px] font-bold text-acc">{t.events.emptyTiersCta}</span>
            </button>
          ) : (
            <Empty text={t.events.emptyTiers} />
          ))
        ) : (
          <>
            <div className="flex flex-col gap-[11px]">
              {tiers.map((tier) => (
                <div key={tier.id} className={cn('rounded-[18px] border border-line bg-elev', canManage && cardPress)}>
                  {canManage ? (
                    <button
                      type="button"
                      onClick={() => openEdit(tier)}
                      aria-label={fmt(t.events.editTierAria, { name: tier.name })}
                      className="block w-full p-[15px] text-left"
                    >
                      {tierSummary(tier)}
                    </button>
                  ) : (
                    <div className="p-[15px]">{tierSummary(tier)}</div>
                  )}
                  {TIER_ALIASES_UI && (
                    <div className="px-[15px] pb-[15px]">
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
                  )}
                </div>
              ))}
            </div>
            {canManage && (
              <Btn kind="ghost" full icon="plus" className="mt-[14px]" onClick={openAdd}>
                {t.events.addAnotherTier}
              </Btn>
            )}
          </>
        )}
      </Scroll>
      {/* The way on to the event. `replace`: this step came from a replaced
          create form, so Back from the event still lands where the flow began. */}
      {setup && (
        <BottomBar>
          {tiers.length > 0 ? (
            <Btn kind="primary" full icon="check" onClick={() => nav.replace('event', { id })}>
              {t.events.setupStep.done}
            </Btn>
          ) : (
            <Btn kind="ghost" full onClick={() => nav.replace('event', { id })}>
              {t.events.setupStep.skip}
            </Btn>
          )}
        </BottomBar>
      )}
      {form && (
        <TierFormSheet
          mode={form.mode}
          draft={draft}
          onChange={setDraft}
          takenColors={takenColors}
          used={form.mode === 'edit' ? form.tier.used : undefined}
          pending={pending}
          err={err}
          onSave={(stayOpen) => void submit(stayOpen)}
          onClose={closeForm}
        />
      )}
    </div>
  );
}
