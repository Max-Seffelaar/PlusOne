'use client';

/**
 * Shared create-request-link flow (G3-0, 86ey7e03j). One component behind BOTH
 * entries — the Promotion overview's "+ New link" and the per-event links
 * screen — replacing two diverged implementations (promo-create-link.tsx's
 * modal and links.tsx's LinkSheet create branch). Form: who (existing
 * influencer / new / label-only), tier (kit TierPicker), auto-approve, optional
 * capacity + expiry. Ends on an explicit done step with a copy button: sharing
 * the fresh URL is the whole point of the action (decided per the G3 plan).
 * Editing an existing link stays in event-links.tsx's LinkSheet.
 */
import { type JSX, useState } from 'react';
import { cn } from '@/lib/utils';
import { fmt, t } from '@/lib/i18n';
import type { PoEvent } from '@/lib/po/types';
import { usePoInfluencers, usePoTiers } from '@/features/po/hooks';
import { usePoCreateInfluencer, usePoCreateLink } from '@/features/po/mutations';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { localInputToIso } from '@/features/events/datetime';
import { Icon } from '../../icon';
import { Btn, Field, Label, TierPicker, ToggleRow, press } from '../../kit';
import { Sheet } from '../../shell';
import { EventPicker, Kicker } from './shared';

type WhoKind = 'influencer' | 'new' | 'label' | null;

function whoChip(key: string, label: string, active: boolean, onClick: () => void): JSX.Element {
  return (
    <button
      key={key}
      type="button"
      onClick={onClick}
      className={cn(
        'shrink-0 rounded-full border px-[13px] py-[8px] font-display text-[12.5px] font-bold transition-colors',
        active ? 'border-acc bg-acc-dim text-acc' : 'border-line text-dim hover:brightness-110',
      )}
    >
      {label}
    </button>
  );
}

export function CreateLinkFlow({
  eventId,
  eventName,
  events,
  onClose,
  onCreated,
}: {
  /** Starting event — the only one used when `events` is omitted/single. */
  eventId: string;
  /** Plain event name — shown in the form's event row and the done-step copy. */
  eventName: string;
  /** Full venue event list — when longer than one, an EventPicker replaces the
   *  static label so the flow isn't locked to wherever it was opened from (a
   *  venue member creating a link isn't necessarily on the right event's tab
   *  yet). Omit from single-event contexts (the standalone per-event route,
   *  reached by an external organizer scoped to just that event) — passing it
   *  there would suggest access to other venue events the organizer can't
   *  actually create links on. */
  events?: PoEvent[];
  onClose: () => void;
  /** Fired once on success with the new link's id (e.g. list highlight). */
  onCreated?: (id: string) => void;
}): JSX.Element {
  const { venueId } = usePoIdentity();
  const [pickedEventId, setPickedEventId] = useState(eventId);
  const pickedEvent = events?.find((e) => e.id === pickedEventId);
  const activeEventId = pickedEvent ? pickedEventId : eventId;
  const activeEventName = pickedEvent?.name ?? eventName;
  const canSwitchEvent = (events?.length ?? 0) > 1;

  const tiersQ = usePoTiers(activeEventId);
  const influencersQ = usePoInfluencers();
  const createLink = usePoCreateLink(activeEventId);
  const createInf = usePoCreateInfluencer();

  const [step, setStep] = useState<'form' | 'done'>('form');
  const [whoKind, setWhoKind] = useState<WhoKind>(null);
  const [whoId, setWhoId] = useState('');
  const [newName, setNewName] = useState('');
  const [label, setLabel] = useState('');
  const [tierId, setTierId] = useState('');
  const [autoApprove, setAutoApprove] = useState(false);
  const [maxHeads, setMaxHeads] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [expiryTime, setExpiryTime] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [doneUrl, setDoneUrl] = useState('');
  const [doneName, setDoneName] = useState('');
  const [copied, setCopied] = useState(false);

  const tiers = tiersQ.data ?? [];
  const influencers = influencersQ.data ?? [];
  const tier = tiers.find((x) => x.id === tierId) ?? null;
  const busy = createLink.isPending || createInf.isPending;
  const maxNum = Number.parseInt(maxHeads, 10);
  const maxVal = Number.isFinite(maxNum) && maxNum > 0 ? maxNum : null;

  // Switching events resets everything tier/identity-related below it — a
  // tier id from the old event is meaningless (or worse, silently wrong) on
  // the new one.
  const pickEvent = (id: string): void => {
    setPickedEventId(id);
    setWhoKind(null);
    setWhoId('');
    setNewName('');
    setLabel('');
    setTierId('');
    setAutoApprove(false);
    setErr(null);
  };

  // Turning auto-approve on requires a pinned tier: auto-select the first one,
  // or surface the "add a tier first" hint on a tier-less event.
  const setAuto = (v: boolean): void => {
    setErr(null);
    if (v && !tierId) {
      if (tiers.length > 0) {
        setTierId(tiers[0].id);
        setAutoApprove(true);
      } else {
        setErr(t.links.noTiersYet);
      }
      return;
    }
    setAutoApprove(v);
  };

  const create = async (): Promise<void> => {
    setErr(null);

    // Identity — exactly one of influencer/label.
    let influencerId: string | undefined;
    let labelVal: string | undefined;
    if (whoKind === 'influencer' && whoId) {
      influencerId = whoId;
    } else if (whoKind === 'new') {
      if (newName.trim().length < 2) {
        setErr(t.links.errNewInfluencerName);
        return;
      }
    } else if (whoKind === 'label') {
      if (!label.trim()) {
        setErr(t.links.errIdentity);
        return;
      }
      labelVal = label.trim();
    } else {
      setErr(t.links.errIdentity);
      return;
    }

    // Expiry — both fields or neither.
    let expiresAt: string | null = null;
    if (expiryDate || expiryTime) {
      expiresAt = localInputToIso(`${expiryDate}T${expiryTime}`);
      if (!expiresAt) {
        setErr(t.links.errExpiry);
        return;
      }
    }

    try {
      // "+ New" creates the influencer first, then attaches the link to it.
      if (whoKind === 'new') {
        if (!venueId) throw new Error(t.links.errInfluencerSave);
        influencerId = await createInf.mutateAsync({ venueId, name: newName.trim() });
        if (!influencerId) throw new Error(t.links.errInfluencerSave);
      }
      const infName =
        whoKind === 'new' ? newName.trim() : influencers.find((i) => i.id === influencerId)?.name ?? '';
      const created = await createLink.mutateAsync({
        eventId: activeEventId,
        influencerId,
        label: labelVal,
        slugBase: labelVal ?? infName,
        tierId: tierId || undefined,
        maxHeadcount: maxVal ?? undefined,
        autoApprove,
        expiresAt: expiresAt ?? undefined,
      });
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      setDoneUrl(`${origin}/e/${created.slug ?? ''}`);
      setDoneName(labelVal ?? infName);
      setCopied(false);
      setStep('done');
      if (created.id) onCreated?.(created.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.links.errCreate);
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

  if (step === 'done') {
    return (
      <Sheet onClose={onClose} center={false}>
        <div className="flex flex-col gap-4">
          <div className="-mt-1 flex flex-col items-center gap-[10px] text-center">
            <div className="po-promo-floaty flex h-[56px] w-[56px] items-center justify-center rounded-[17px] bg-acc-dim text-acc">
              <Icon name="check" size={27} sw={2.4} />
            </div>
            <div className="font-display text-[20px] font-extrabold tracking-[-0.01em] text-text">{t.promo.doneTitle}</div>
            <div className="max-w-[250px] text-[13px] leading-[1.5] text-dim">
              {fmt(tier ? t.promo.doneBodyTier : t.promo.doneBody, {
                name: doneName || (whoKind === 'label' ? t.promo.doneFallbackLabel : t.promo.doneFallbackInfluencer),
                event: activeEventName,
                tier: tier?.short ?? '',
              })}
              {autoApprove ? t.promo.doneAuto : ''}
              {maxVal != null ? fmt(t.promo.doneCap, { cap: maxVal }) : ''}
            </div>
          </div>
          <div className="flex items-center gap-[9px] rounded-[12px] border border-line bg-bg px-[14px] py-3">
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
                setWhoKind(null);
                setWhoId('');
                setNewName('');
                setLabel('');
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
      </Sheet>
    );
  }

  return (
    <Sheet onClose={onClose} center={false}>
      <div className="mb-1 font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">{t.links.sheetCreateTitle}</div>
      {canSwitchEvent ? (
        <div className="mb-4">
          <Kicker className="mb-2">{t.promo.eventLabel}</Kicker>
          <EventPicker events={events ?? []} selectedId={activeEventId} onPick={pickEvent} />
        </div>
      ) : (
        <div className="mb-4 text-[13px] text-faint">{activeEventName}</div>
      )}
      <div className="po-scroll -mx-1 max-h-[62vh] overflow-y-auto px-1">
        {/* (a) For who? — existing influencer chips + "+ New" + "Label only". */}
        <Label className="mb-2">{t.links.forWho}</Label>
        <div className="po-scroll mb-2 flex gap-2 overflow-x-auto pb-1">
          {influencers.map((inf) =>
            whoChip(inf.id, inf.name, whoKind === 'influencer' && whoId === inf.id, () => {
              setWhoKind('influencer');
              setWhoId(inf.id);
              setErr(null);
            }),
          )}
          {whoChip('new', t.links.chipNew, whoKind === 'new', () => {
            setWhoKind('new');
            setErr(null);
          })}
          {whoChip('label', t.links.chipLabelOnly, whoKind === 'label', () => {
            setWhoKind('label');
            setErr(null);
          })}
        </div>
        {whoKind === 'new' && (
          <Field placeholder={t.links.newInfluencerPlaceholder} value={newName} onChange={setNewName} autoFocus className="mb-3" />
        )}
        {whoKind === 'label' && (
          <Field placeholder={t.links.labelPlaceholder} value={label} onChange={setLabel} autoFocus className="mb-3" />
        )}

        {/* (b) Tier — the shared kit picker (auto-approve pins a real tier). */}
        <Label className="mb-2">{t.links.tierLabel}</Label>
        {tiersQ.isLoading ? (
          <div className="mb-3 py-[14px] text-center text-[13px] text-faint">{t.events.loadingTiers}</div>
        ) : (
          <TierPicker
            className="mb-3"
            tiers={tiers}
            value={tierId}
            onChange={setTierId}
            hint={(row) => (row.max != null ? fmt(t.links.tierUsedOfMax, { used: row.used, max: row.max }) : t.links.tierNoMax)}
            none={autoApprove ? undefined : { label: t.links.noFixedTier, sub: t.links.noFixedTierSub }}
          />
        )}

        {/* (c) Auto-approve — needs a pinned tier. */}
        <div className="mb-1 rounded-[16px] border border-line bg-elev px-[14px] py-1">
          <ToggleRow title={t.links.autoApproveTitle} sub={t.links.autoApproveSub} on={autoApprove} set={setAuto} last />
        </div>

        {/* (d) Max heads + expiry. */}
        <Label className="mb-2 mt-3">{t.links.maxHeadsLabel}</Label>
        <Field icon="users" placeholder={t.links.maxHeadsPlaceholder} value={maxHeads} onChange={(v) => setMaxHeads(v.replace(/[^0-9]/g, ''))} inputMode="numeric" className="mb-3" />
        <div className="mb-3 flex gap-[10px]">
          <div className="flex-1">
            <Label className="mb-2">{`${t.links.expiresLabel} · ${t.links.expiresDate}`}</Label>
            <Field icon="cal" type="date" value={expiryDate} onChange={setExpiryDate} />
          </div>
          <div className="flex-1">
            <Label className="mb-2">{t.links.expiresTime}</Label>
            <Field icon="clock" type="time" value={expiryTime} onChange={setExpiryTime} />
          </div>
        </div>
      </div>

      {err && <div className="mt-2 text-[13px] font-semibold text-[#E89AC0]">{err}</div>}
      <Btn kind="primary" full icon="link" disabled={busy} onClick={() => void create()} className={cn('mt-2', busy && 'opacity-50')}>
        {busy ? t.promo.creating : t.links.createCta}
      </Btn>
      <button type="button" onClick={onClose} className={cn('mt-3 cursor-pointer self-center border-none bg-transparent font-body text-[13.5px] font-semibold text-faint', press)}>
        {t.links.cancel}
      </button>
    </Sheet>
  );
}
