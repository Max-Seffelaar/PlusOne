'use client';

/**
 * Add-on-the-spot at the door (decision #10), within the doorhost's own quota.
 * Reuses the Fase-7 quick-add parser (`parseQuickAdd`/`resolveAmbiguity`): free
 * text → name + plus-ones + tier, asking inline on unrecognised words rather
 * than silently defaulting (#33). The quota guard mirrors `event_quota_status`;
 * the database quota trigger is the real backstop.
 */
import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import {
  parseQuickAdd,
  resolveAmbiguity,
  type AmbiguityChoice,
  type QuickAddTier,
} from '@/features/guests/quick-add-parser';
import { Icon, type IconName } from '@/components/po/icon';
import { Avatar, Btn, Label, MiniChip, Scroll, Top } from '@/components/po/kit';
import { BottomBar } from '@/components/po/shell';
import { useDoor } from '../DoorProvider';

interface AddedRow {
  id: string;
  name: string;
  plus: number;
  tierName: string;
  tierColor: string;
}

function PreviewChip({ icon, dot, label }: { icon?: IconName; dot?: string; label: string }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[9px] border border-line bg-elev2 px-[11px] py-1.5 font-display text-[13px] font-bold text-text">
      {dot && <span className="h-[9px] w-[9px] rounded-full" style={{ background: dot }} />}
      {icon && <Icon name={icon} size={13} className="text-faint" />}
      {label}
    </span>
  );
}

export function AddOnSpot({ onBack }: { onBack: () => void }): JSX.Element {
  const { view, defaultTierId, quota, addOnSpot } = useDoor();
  const [val, setVal] = useState('');
  const [choice, setChoice] = useState<AmbiguityChoice | null>(null);
  const [added, setAdded] = useState<AddedRow[]>([]);

  const tiers: QuickAddTier[] = useMemo(
    () => (view?.tiers ?? []).map((t) => ({ id: t.id, name: t.name, aliases: t.aliases })),
    [view],
  );
  const tierColor = (id: string): string => view?.tiers.find((t) => t.id === id)?.color ?? '#8E8E93';

  useEffect(() => {
    setChoice(null);
  }, [val]);

  const exempt = quota?.exempt ?? false;
  const remaining = quota?.remaining ?? null;
  const total = quota?.quota ?? null;
  const usedHere = added.reduce((a, r) => a + 1 + r.plus, 0);
  const left = remaining == null ? null : remaining - usedHere;

  const parsed = defaultTierId && val.trim() ? parseQuickAdd(val, tiers, defaultTierId) : null;
  const needsAsk = parsed?.status === 'ambiguous' && !choice;
  // Bare name on a multi-tier event: don't silently drop the guest on the default
  // tier — ask which tier, exactly like the po quick-add (feedback 1/7: "the +
  // doesn't always show the tier selection").
  const needsTierPick = parsed?.status === 'ok' && parsed.matchedVia === 'default' && tiers.length > 1 && !choice;
  const resolved =
    parsed && defaultTierId && parsed.status !== 'needs_name'
      ? parsed.status === 'ambiguous'
        ? choice
          ? resolveAmbiguity(parsed, choice, defaultTierId)
          : null
        : {
            name: parsed.name,
            plusOnes: parsed.plusOnes,
            tierId: (choice?.kind === 'tier' ? choice.tierId : undefined) ?? parsed.tierId ?? defaultTierId,
          }
      : null;
  const cost = parsed ? parsed.slots : 0;
  const overQuota = !exempt && left != null && cost > left;
  const canCommit = !!resolved && !needsAsk && !needsTierPick && !overQuota;

  const commit = (): void => {
    if (!resolved || !canCommit) return;
    addOnSpot({ name: resolved.name, plusOnes: resolved.plusOnes, tierId: resolved.tierId });
    setAdded((a) => [
      { id: resolved.tierId + Math.random().toString(36).slice(2), name: resolved.name, plus: resolved.plusOnes, tierName: tierLabel(resolved.tierId), tierColor: tierColor(resolved.tierId) },
      ...a,
    ]);
    setVal('');
    setChoice(null);
  };

  const tierLabel = (id: string): string => view?.tiers.find((tr) => tr.id === id)?.name ?? t.door.tierFallback;

  return (
    <div className="flex h-full flex-col">
      <Top
        onBack={onBack}
        title={t.door.addTitle}
        sub={exempt ? t.door.addSubNoQuota : left != null ? fmt(t.door.addSubQuotaLeft, { n: Math.max(0, left), m: total ?? 0 }) : t.door.addSubFallback}
      />
      <Scroll bottom={120}>
        <Label className="mb-2">{t.door.addInputLabel}</Label>
        <div className={cn('rounded-[16px] border bg-elev px-[15px] py-[14px] transition-colors', parsed ? 'border-acc' : 'border-line')}>
          <input
            autoFocus
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canCommit) commit();
            }}
            placeholder={t.door.addInputPlaceholder}
            className="w-full border-none bg-transparent font-display text-[18px] font-bold tracking-[-0.01em] text-text outline-none placeholder:text-faint"
          />
          {parsed && (
            <div className="mt-[13px] flex flex-wrap gap-[7px]">
              <PreviewChip icon="user" label={parsed.name || '—'} />
              {parsed.plusOnes > 0 && <PreviewChip icon="users" label={`+${parsed.plusOnes}`} />}
              {!needsAsk && !needsTierPick && resolved && <PreviewChip dot={tierColor(resolved.tierId)} label={tierLabel(resolved.tierId)} />}
              {needsAsk && parsed.ambiguous && <MiniChip className="border-dashed border-acc text-text">“{parsed.ambiguous.text}” ?</MiniChip>}
            </div>
          )}
        </div>

        {needsAsk && parsed?.ambiguous && (
          <div className="mt-3 rounded-[16px] bg-acc-dim p-[14px]">
            <div className="mb-[11px] text-[13.5px] leading-[1.45] text-text">
              {fmt(t.door.ambiguity, { x: parsed.ambiguous.text })}
            </div>
            <div className="flex flex-col gap-2">
              {parsed.ambiguous.suggestions.map((s) => (
                <button
                  key={s.tierId}
                  type="button"
                  onClick={() => setChoice({ kind: 'tier', tierId: s.tierId })}
                  className="flex items-center gap-[10px] rounded-[12px] border border-line bg-bg px-[13px] py-[12px] text-text transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]"
                >
                  <span className="h-[10px] w-[10px] rounded-full" style={{ background: tierColor(s.tierId) }} />
                  <span className="flex-1 text-left font-display text-[14.5px] font-bold">{s.tierName}</span>
                  <Icon name="chev" size={16} className="text-ghost" />
                </button>
              ))}
              <button
                type="button"
                onClick={() => setChoice({ kind: 'default' })}
                className="flex items-center gap-[10px] rounded-[12px] border border-line bg-bg px-[13px] py-[12px] text-text transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]"
              >
                <span className="h-[10px] w-[10px] rounded-full" style={{ background: tierColor(defaultTierId ?? '') }} />
                {/* Real default-tier name, not a hardcoded "Regular" (1/7). */}
                <span className="flex-1 text-left font-display text-[14.5px] font-bold">{tierLabel(defaultTierId ?? '')}</span>
                <Icon name="chev" size={16} className="text-ghost" />
              </button>
              <button
                type="button"
                onClick={() => setChoice({ kind: 'name' })}
                className="flex items-center gap-[10px] rounded-[12px] border border-line bg-bg px-[13px] py-[12px] text-text transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]"
              >
                <Icon name="user" size={15} className="text-faint" />
                <span className="flex-1 text-left font-display text-[14.5px] font-bold">{t.door.ambiguityBelongsToName}</span>
                <Icon name="chev" size={16} className="text-ghost" />
              </button>
            </div>
          </div>
        )}

        {needsTierPick && (
          <div className="mt-3 rounded-[16px] bg-acc-dim p-[14px]">
            <div className="mb-[11px] text-[13.5px] leading-[1.45] text-text">{t.guests.add.tierPickQuestion}</div>
            <div className="flex flex-col gap-2">
              {(view?.tiers ?? []).map((tier) => (
                <button
                  key={tier.id}
                  type="button"
                  onClick={() => setChoice({ kind: 'tier', tierId: tier.id })}
                  className="flex items-center gap-[10px] rounded-[12px] border border-line bg-bg px-[13px] py-[12px] text-text transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]"
                >
                  <span className="h-[10px] w-[10px] rounded-full" style={{ background: tier.color ?? '#8E8E93' }} />
                  <span className="flex-1 text-left font-display text-[14.5px] font-bold">{tier.name}</span>
                  <Icon name="chev" size={16} className="text-ghost" />
                </button>
              ))}
            </div>
          </div>
        )}

        {parsed && !needsAsk && !needsTierPick && !exempt && left != null && (
          <div className={cn('mt-3 flex items-center gap-[9px] rounded-[13px] px-[14px] py-[11px]', overQuota ? 'border border-acc bg-white/[0.04]' : 'border border-line bg-elev')}>
            <Icon name="ticket" size={17} stroke={overQuota ? '#B5A6FF' : 'rgba(255,255,255,0.40)'} />
            <span className="flex-1 text-[13.5px] text-text">
              {fmt(t.door.quotaCost, { cost, unit: cost === 1 ? t.door.slotSingular : t.door.slotPlural, left: Math.max(0, left - cost) })}
            </span>
            {overQuota && <MiniChip className="border-acc text-acc">{t.door.quotaFull}</MiniChip>}
          </div>
        )}

        {added.length > 0 && (
          <>
            <Label className="mx-0.5 mb-[10px] mt-[22px]">{fmt(t.door.justAdded, { n: added.length })}</Label>
            <div className="flex flex-col gap-2">
              {added.map((r) => (
                <div key={r.id} className="flex items-center gap-[11px] rounded-[14px] border border-line bg-elev p-[11px]">
                  <Avatar name={r.name} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-[14.5px] font-bold text-text">
                      {r.name}
                      {r.plus > 0 && <span className="text-faint"> +{r.plus}</span>}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-faint">
                      <span className="h-[8px] w-[8px] rounded-full" style={{ background: r.tierColor }} />
                      {r.tierName}
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-[5px] font-body text-[11.5px] font-bold text-acc">
                    <Icon name="check2" size={13} stroke="#B5A6FF" sw={2.4} />
                    {t.door.onList}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </Scroll>
      <BottomBar>
        <Btn kind="primary" full icon="plus" onClick={commit} className={canCommit ? '' : 'opacity-[0.45]'}>
          {parsed?.name
            ? fmt(t.door.addCommit, { name: `${parsed.name}${parsed.plusOnes ? ` +${parsed.plusOnes}` : ''}` })
            : t.door.addTypeName}
        </Btn>
      </BottomBar>
    </div>
  );
}
