'use client';

/**
 * Create-request-link sheet for the Promotion dashboard (S15, split out of
 * promo.tsx per FE-5 file-size discipline — no behavior change). Form → done
 * flow: pick influencer/label, tier, auto-approve, optional capacity.
 */
import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { fmt, t } from '@/lib/i18n';
import type { PoEvent } from '@/lib/po/types';
import { usePoTiers } from '@/features/po/hooks';
import { usePoCreateInfluencer, usePoCreateLink } from '@/features/po/mutations';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { Icon } from '../icon';
import { Toggle } from '../kit';
import { Sheet } from '../shell';
import { Kicker, eventLabel, press } from './promo';

// ── Create request link modal (form → done) ───────────────────────────────────
export function CreateLinkModal({ event, onClose }: { event: PoEvent; onClose: () => void }): JSX.Element {
  const { venueId } = usePoIdentity();
  const tiersQ = usePoTiers(event.id);
  const tiers = useMemo(() => tiersQ.data ?? [], [tiersQ.data]);
  const createInf = usePoCreateInfluencer();
  const createLink = usePoCreateLink(event.id);

  const [step, setStep] = useState<'form' | 'done'>('form');
  const [type, setType] = useState<'influencer' | 'label'>('influencer');
  const [name, setName] = useState('');
  const [tierId, setTierId] = useState('');
  const [auto, setAuto] = useState(true);
  const [capOn, setCapOn] = useState(false);
  const [cap, setCap] = useState(25);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [doneUrl, setDoneUrl] = useState('');
  const [doneName, setDoneName] = useState('');

  // Default to the event's first tier once loaded (the design preselects one).
  useEffect(() => {
    if (tiers.length > 0) setTierId((cur) => (cur && tiers.some((x) => x.id === cur) ? cur : tiers[0].id));
  }, [tiers]);

  const noTiers = !tiersQ.isLoading && tiers.length === 0;
  const tier = tiers.find((x) => x.id === tierId) ?? null;
  // Auto-approve requires a pinned tier (server-enforced) — disabled without one.
  const autoOn = auto && tier != null;
  const ready = name.trim().length > 0;
  const busy = createInf.isPending || createLink.isPending;

  const inp = 'w-full rounded-[12px] border border-line bg-bg px-[14px] py-3 font-body text-[14.5px] text-text outline-none placeholder:text-faint';
  const stepBtn = cn('flex h-[38px] w-[38px] items-center justify-center rounded-[11px] border border-line bg-elev2 font-display text-[20px] font-bold leading-none text-text', press);
  const closeBtn = (
    <button
      type="button"
      onClick={onClose}
      aria-label={t.promo.closeAria}
      className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-line bg-transparent text-faint', press)}
    >
      <Icon name="close" size={16} />
    </button>
  );

  const create = async (): Promise<void> => {
    if (!ready || busy) return;
    setErr(null);
    const nm = name.trim();
    try {
      let influencerId: string | undefined;
      if (type === 'influencer') {
        if (!venueId) throw new Error(t.promo.errCreate);
        influencerId = await createInf.mutateAsync({ venueId, name: nm });
        if (!influencerId) throw new Error(t.promo.errCreate);
      }
      const created = await createLink.mutateAsync({
        eventId: event.id,
        influencerId,
        label: type === 'label' ? nm : undefined,
        slugBase: nm,
        tierId: tierId || undefined,
        maxHeadcount: capOn ? cap : undefined,
        autoApprove: autoOn,
      });
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      setDoneUrl(`${origin}/e/${created.slug ?? ''}`);
      setDoneName(nm);
      setStep('done');
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.promo.errCreate);
    }
  };

  const copy = async (): Promise<void> => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(doneUrl);
        setCopied(true);
      }
    } catch {
      // Clipboard blocked (rare in webviews) — the URL stays visible/selectable.
    }
  };

  return (
    <Sheet onClose={onClose} center={false}>
      {step === 'form' ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">{t.promo.createTitle}</div>
              <div className="mt-[3px] text-[12.5px] text-faint">{t.promo.createSub}</div>
            </div>
            {closeBtn}
          </div>

          <div>
            <Kicker className="mb-2">{t.promo.eventLabel}</Kicker>
            <div className={cn(inp, 'flex items-center justify-between gap-[9px]')}>
              <span className="inline-flex items-center gap-[9px] font-semibold">
                <Icon name="cal" size={16} stroke="#B5A6FF" />
                {eventLabel(event)}
              </span>
              <Icon name="chevD" size={15} className="text-ghost" />
            </div>
          </div>

          <div>
            <Kicker className="mb-2">{t.promo.attachToLabel}</Kicker>
            <div className="flex gap-[3px] rounded-[11px] border border-line bg-bg p-[3px]">
              {(
                [
                  ['influencer', t.promo.attachInfluencer],
                  ['label', t.promo.attachLabel],
                ] as const
              ).map(([k, label]) => {
                const on = type === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setType(k)}
                    className={cn('flex-1 rounded-[8px] py-[9px] font-display text-[13.5px] font-bold', on ? 'bg-acc-dim text-acc' : 'text-faint', press)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={type === 'influencer' ? t.promo.influencerNamePlaceholder : t.promo.labelPlaceholder}
              className={cn(inp, 'mt-[10px]')}
            />
          </div>

          <div>
            <Kicker className="mb-2">{t.promo.tierLabel}</Kicker>
            {noTiers ? (
              <>
                <div className="flex gap-[3px] rounded-[11px] border border-dashed border-line bg-bg p-[3px] opacity-60">
                  <span className="flex-1 py-[9px] text-center font-display text-[12.5px] font-bold text-faint">—</span>
                </div>
                <div className="mt-2 text-[12px] leading-[1.4] text-faint">{t.promo.noTiersHint}</div>
              </>
            ) : (
              <>
                <div className="po-scroll flex gap-[3px] overflow-x-auto rounded-[11px] border border-line bg-bg p-[3px]">
                  {tiers.map((x) => {
                    const on = x.id === tierId;
                    return (
                      <button
                        key={x.id}
                        type="button"
                        onClick={() => setTierId(x.id)}
                        className={cn(
                          'min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-[8px] px-1 py-[9px] font-display text-[12.5px] font-bold',
                          on ? 'bg-acc-dim text-acc' : 'text-faint',
                          press,
                        )}
                      >
                        {x.short}
                      </button>
                    );
                  })}
                </div>
                {tier && (
                  <div className="mt-2 text-[12px] leading-[1.4] text-faint">
                    {fmt(t.promo.tierExplainer, { tier: tier.short, event: event.name })}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className="text-[14px] font-semibold text-text">{t.promo.autoApproveTitle}</div>
              <div className="mt-0.5 text-[12px] leading-[1.4] text-faint">
                {noTiers ? t.promo.autoApproveNeedsTier : t.promo.autoApproveSub}
              </div>
            </div>
            <span className={noTiers ? 'pointer-events-none opacity-40' : undefined}>
              <Toggle on={autoOn} onClick={() => setAuto(!autoOn)} />
            </span>
          </div>

          <div>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="text-[14px] font-semibold text-text">{t.promo.capacityTitle}</div>
                <div className="mt-0.5 text-[12px] leading-[1.4] text-faint">{t.promo.capacitySub}</div>
              </div>
              <Toggle on={capOn} onClick={() => setCapOn(!capOn)} />
            </div>
            {capOn && (
              <div className="mt-[13px] flex items-center gap-[10px]">
                <button type="button" aria-label={t.promo.capacityLessAria} onClick={() => setCap(Math.max(1, cap - 1))} className={stepBtn}>
                  −
                </button>
                <div className="min-w-[56px] text-center font-display text-[22px] font-extrabold tabular-nums text-text">{cap}</div>
                <button type="button" aria-label={t.promo.capacityMoreAria} onClick={() => setCap(cap + 1)} className={stepBtn}>
                  +
                </button>
                <span className="ml-1 text-[13px] text-faint">{t.promo.capacityUnit}</span>
              </div>
            )}
          </div>

          {err && <div className="text-[13px] font-semibold text-[#E89AC0]">{err}</div>}
          <button
            type="button"
            onClick={() => void create()}
            className={cn(
              'mt-0.5 inline-flex w-full items-center justify-center gap-2 rounded-[13px] bg-acc px-[18px] py-[13px] font-display text-[15px] font-bold text-on-acc',
              press,
              (!ready || busy) && 'pointer-events-none opacity-40',
            )}
          >
            <Icon name="link" size={17} sw={2.2} stroke="#16132B" />
            {busy ? t.promo.creating : t.promo.createCta}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex justify-end">{closeBtn}</div>
          <div className="-mt-1.5 flex flex-col items-center gap-[10px] text-center">
            <div className="po-promo-floaty flex h-[56px] w-[56px] items-center justify-center rounded-[17px] bg-acc-dim text-acc">
              <Icon name="check" size={27} sw={2.4} />
            </div>
            <div className="font-display text-[20px] font-extrabold tracking-[-0.01em] text-text">{t.promo.doneTitle}</div>
            <div className="max-w-[250px] text-[13px] leading-[1.5] text-dim">
              {fmt(tier ? t.promo.doneBodyTier : t.promo.doneBody, {
                name: doneName || (type === 'influencer' ? t.promo.doneFallbackInfluencer : t.promo.doneFallbackLabel),
                event: event.name,
                tier: tier?.short ?? '',
              })}
              {autoOn ? t.promo.doneAuto : ''}
              {capOn ? fmt(t.promo.doneCap, { cap }) : ''}
            </div>
          </div>
          <div className={cn(inp, 'flex items-center gap-[9px]')}>
            <Icon name="link" size={16} className="text-faint" />
            <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-body text-[13.5px] text-text">{doneUrl}</span>
            <button
              type="button"
              onClick={() => void copy()}
              className={cn(
                'inline-flex shrink-0 items-center gap-[5px] rounded-[9px] px-[11px] py-[7px] font-display text-[12.5px] font-bold',
                copied ? 'bg-acc-dim text-acc' : 'bg-acc text-on-acc',
                press,
              )}
            >
              <Icon name={copied ? 'check' : 'copy'} size={13} sw={2.3} />
              {copied ? t.promo.copied : t.promo.copy}
            </button>
          </div>
          <div className="flex gap-[10px]">
            <button
              type="button"
              onClick={() => {
                setStep('form');
                setName('');
                setCopied(false);
                setErr(null);
              }}
              className={cn('flex-1 rounded-[13px] border border-line bg-transparent py-3 font-display text-[14.5px] font-bold text-text', press)}
            >
              {t.promo.createAnother}
            </button>
            <button type="button" onClick={onClose} className={cn('flex-1 rounded-[13px] bg-acc py-3 font-display text-[14.5px] font-bold text-on-acc', press)}>
              {t.promo.done}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
