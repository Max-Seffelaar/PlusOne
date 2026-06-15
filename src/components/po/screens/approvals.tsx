'use client';

/** Approvals: quota requests (#4,#5) + landing-page guest requests (#12,#31),
 *  with a tier-assign sheet that shows door-payment + notifies the guest (#34). */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { GuestRequest, Tier } from '@/lib/po/types';
import { usePoTiers } from '@/features/po/PoLiveProvider';
import {
  useApproveGuestRequest,
  useApproveQuotaRequest,
  useDenyGuestRequest,
  useDenyQuotaRequest,
  useGuestRequests,
  useQuotaRequests,
} from '@/features/po/approvals-live';
import { useNav } from '../context';
import { Icon } from '../icon';
import { Avatar, Btn, Empty, Label, Note, Top } from '../kit';
import { Sheet } from '../shell';

const press = 'transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]';
const col = 'flex h-full flex-col';

type Verdict = 'ok' | 'no';

// One-tap deny on this screen has no free-text field, but the audited deny
// actions require a reason — record an honest default so the layout is untouched.
const DEFAULT_DENY_REASON = 'Afgewezen door beoordelaar';

export function Aanvragen({ eventId }: { eventId?: string }): JSX.Element {
  const nav = useNav();
  const [tab, setTab] = useState<'quota' | 'landing'>('quota');
  const [done, setDone] = useState<Record<string, Verdict>>({});
  const [granted, setGranted] = useState<Record<string, Tier>>({});
  const [assign, setAssign] = useState<GuestRequest | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const { requests: qReqs } = useQuotaRequests(eventId);
  const { requests: gReqs } = useGuestRequests(eventId);
  const approveQuota = useApproveQuotaRequest(eventId);
  const denyQuota = useDenyQuotaRequest(eventId);
  const approveGuest = useApproveGuestRequest(eventId);
  const denyGuest = useDenyGuestRequest(eventId);

  const openQ = qReqs.filter((r) => !done[r.id]).length;
  const openG = gReqs.filter((r) => !done[r.id]).length;

  // Re-open a card by dropping its optimistic verdict (mutate a copy, #app.tsx).
  function reopen(id: string): void {
    setDone((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });
  }

  // Optimistically record the verdict, fire the audited action, and roll the
  // local state back (re-opening the card) with a Dutch error if it is rejected.
  async function decideQuota(id: string, verdict: Verdict): Promise<void> {
    setErr(null);
    setDone((d) => ({ ...d, [id]: verdict }));
    const res =
      verdict === 'ok'
        ? await approveQuota.approve(id)
        : await denyQuota.deny(id, DEFAULT_DENY_REASON);
    if (!res.ok) {
      reopen(id);
      setErr(res.message);
    }
  }

  async function denyGuestReq(id: string): Promise<void> {
    setErr(null);
    setDone((d) => ({ ...d, [id]: 'no' }));
    const res = await denyGuest.deny(id, DEFAULT_DENY_REASON);
    if (!res.ok) {
      reopen(id);
      setErr(res.message);
    }
  }

  return (
    <div className={col}>
      <Top onBack={nav.back} title="Aanvragen" sub="Verzoeken die op jouw goedkeuring wachten" />
      <div className="flex flex-none gap-1.5 px-5 pb-[14px] pt-1">
        {([['quota', 'Quotum', openQ], ['landing', 'Landingpage', openG]] as const).map(([k, l, n]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cn(
              'inline-flex flex-1 cursor-pointer items-center justify-center gap-[7px] rounded-full border py-[10px] font-display text-[13px] font-bold transition-[filter] hover:brightness-[1.07]',
              tab === k ? 'border-transparent bg-text text-bg' : 'border-line bg-transparent text-dim',
            )}
          >
            {l}
            {n > 0 && (
              <span className={cn('inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-[5px] text-[11px] font-extrabold', tab === k ? 'bg-acc text-on-acc' : 'bg-acc-dim text-acc')}>{n}</span>
            )}
          </button>
        ))}
      </div>
      <div className="po-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-[28px]">
        {err && (
          <div className="mb-[11px] rounded-[12px] border border-acc-soft/40 bg-acc-dim px-[13px] py-[10px] text-[13px] font-semibold text-acc-soft">
            {err}
          </div>
        )}
        {tab === 'quota' ? (
          <div className="flex flex-col gap-[11px]">
            {qReqs.map((r) => {
              const st = done[r.id];
              return (
                <div key={r.id} className={cn('rounded-[18px] border border-line bg-elev p-[15px]', st && 'opacity-60')}>
                  <div className="mb-[11px] flex items-center gap-[11px]">
                    <Avatar name={r.who} size={40} />
                    <div className="min-w-0 flex-1">
                      <div className="font-display text-[15.5px] font-bold text-text">{r.who}</div>
                      <div className="text-[12px] text-faint">
                        {r.role} · {r.event} · {r.at}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-display text-[18px] font-extrabold text-acc">
                        {r.current}→{r.want}
                      </div>
                      <div className="text-[10.5px] text-faint">plekken</div>
                    </div>
                  </div>
                  <div className="mb-[13px] pl-0.5 text-[13.5px] leading-[1.45] text-dim">“{r.reason}”</div>
                  {st ? (
                    <span className={cn('inline-flex items-center gap-1.5 font-body text-[13px] font-bold', st === 'ok' ? 'text-acc' : 'text-faint')}>
                      <Icon name={st === 'ok' ? 'check2' : 'close'} size={14} stroke={st === 'ok' ? '#B5A6FF' : 'rgba(255,255,255,0.40)'} sw={2.4} />
                      {st === 'ok' ? `Goedgekeurd · ${r.want} plekken` : 'Afgewezen'}
                    </span>
                  ) : (
                    <div className="flex gap-2">
                      <Btn sm kind="dark" full icon="close" onClick={() => void decideQuota(r.id, 'no')}>
                        Afwijzen
                      </Btn>
                      <Btn sm kind="primary" full icon="check2" onClick={() => void decideQuota(r.id, 'ok')}>
                        Keur {r.want} goed
                      </Btn>
                    </div>
                  )}
                </div>
              );
            })}
            {openQ === 0 && qReqs.length > 0 && <Empty text="Alle quotum-verzoeken afgehandeld 🎉" />}
          </div>
        ) : (
          <div className="flex flex-col gap-[11px]">
            <Note icon="user">
              Landingpage-aanvragen vallen <b>buiten</b> je eigen quotum (#31) — goedkeuren kost jou geen plek, maar telt wel mee in de tier-max.
            </Note>
            {gReqs.map((r) => {
              const st = done[r.id];
              return (
                <div key={r.id} className={cn('rounded-[18px] border border-line bg-elev p-[15px]', st && 'opacity-60')} style={{ borderColor: r.flag && !st ? 'rgba(181,166,255,0.4)' : undefined }}>
                  <div className={cn('flex items-center gap-[11px]', r.motivation || r.flag ? 'mb-[11px]' : 'mb-[13px]')}>
                    <Avatar name={r.name} size={40} />
                    <div className="min-w-0 flex-1">
                      <div className="font-display text-[15.5px] font-bold text-text">
                        {r.name}
                        {r.plus > 0 && <span className="text-faint"> +{r.plus}</span>}
                      </div>
                      <div className="text-[12px] text-faint">
                        tel. {r.phone} · {r.at}
                      </div>
                    </div>
                  </div>
                  {r.flag && (
                    <div className="mb-[11px] inline-flex items-center gap-1.5 rounded-[7px] bg-acc-dim px-[9px] py-1 font-body text-[11.5px] font-bold text-acc">
                      <Icon name="warn" size={12} stroke="#B5A6FF" />
                      {r.flag}
                    </div>
                  )}
                  {r.motivation && <div className="mb-[13px] pl-0.5 text-[13.5px] leading-[1.45] text-dim">“{r.motivation}”</div>}
                  {st === 'ok' ? (
                    <div className="flex items-center gap-[9px] rounded-[12px] bg-acc-dim px-[13px] py-[11px]">
                      <Icon name="check2" size={16} stroke="#B5A6FF" sw={2.4} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13.5px] font-bold text-text">Op de lijst · {granted[r.id]?.short ?? 'Regular'}</div>
                        <div className="mt-px text-[11.5px] text-dim">{granted[r.id] && granted[r.id].doorPrice > 0 ? `Betaalt €${granted[r.id].doorPrice} aan de deur` : 'Gratis toegang'} · melding verstuurd</div>
                      </div>
                    </div>
                  ) : st === 'no' ? (
                    <span className="inline-flex items-center gap-1.5 font-body text-[13px] font-bold text-faint">
                      <Icon name="close" size={14} stroke="rgba(255,255,255,0.40)" sw={2.4} />
                      Afgewezen
                    </span>
                  ) : (
                    <div className="flex gap-2">
                      <Btn sm kind="dark" full icon="close" onClick={() => void denyGuestReq(r.id)}>
                        Afwijzen
                      </Btn>
                      <Btn sm kind="primary" full icon="check2" onClick={() => setAssign(r)}>
                        Toevoegen…
                      </Btn>
                    </div>
                  )}
                </div>
              );
            })}
            {openG === 0 && gReqs.length > 0 && <Empty text="Alle aanvragen afgehandeld 🎉" />}
          </div>
        )}
      </div>
      {assign && (
        <AssignSheet
          req={assign}
          eventId={eventId}
          onClose={() => setAssign(null)}
          onConfirm={async (tier) => {
            setErr(null);
            const res = await approveGuest.approve(assign.id, tier.id);
            if (!res.ok) {
              setErr(res.message);
              return;
            }
            setGranted((g) => ({ ...g, [assign.id]: tier }));
            setDone((d) => ({ ...d, [assign.id]: 'ok' }));
            setAssign(null);
          }}
        />
      )}
    </div>
  );
}

function AssignSheet({
  req,
  eventId,
  onClose,
  onConfirm,
}: {
  req: GuestRequest;
  eventId?: string;
  onConfirm: (tier: Tier) => Promise<void> | void;
  onClose: () => void;
}): JSX.Element {
  const { tiers, isLoading } = usePoTiers(eventId);
  const [tierId, setTierId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Default to the event's default tier (or the first) once tiers load.
  const selected =
    tiers.find((t) => t.id === tierId) ?? tiers.find((t) => t.isDefault) ?? tiers[0] ?? null;
  const heads = 1 + req.plus;
  const pay = (selected?.doorPrice ?? 0) > 0;

  async function confirm(): Promise<void> {
    if (!selected || busy) return;
    setBusy(true);
    try {
      await onConfirm(selected);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet onClose={onClose} center={false}>
      <div className="mb-4 flex items-center gap-[12px]">
        <Avatar name={req.name} size={44} />
        <div className="min-w-0 flex-1">
          <div className="font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">
            {req.name}
            {req.plus > 0 && <span className="text-faint"> +{req.plus}</span>}
          </div>
          <div className="text-[12.5px] text-faint">
            Landingpage-aanvraag · {heads} {heads === 1 ? 'persoon' : 'personen'}
          </div>
        </div>
      </div>
      <Label className="mb-[10px]">Wat krijgt deze gast?</Label>
      <div className="mb-[14px] flex flex-col gap-[7px]">
        {isLoading && tiers.length === 0 && (
          <div className="rounded-[12px] border border-line bg-elev px-[13px] py-[12px] text-[13px] text-faint">
            Tiers laden…
          </div>
        )}
        {!isLoading && tiers.length === 0 && (
          <div className="rounded-[12px] border border-line bg-elev px-[13px] py-[12px] text-[13px] text-faint">
            Geen tiers voor dit event — maak er eerst één aan.
          </div>
        )}
        {tiers.map((t) => {
          const on = t.id === (selected?.id ?? null);
          return (
            <button key={t.id} type="button" onClick={() => setTierId(t.id)} className={cn('flex items-center gap-[11px] rounded-[12px] border px-[13px] py-[12px] text-left', on ? 'border-transparent bg-acc-dim' : 'border-line bg-elev', press)}>
              <span className="h-[12px] w-[12px] shrink-0 rounded-full" style={{ background: t.color }} />
              <span className="min-w-0 flex-1">
                <span className="block font-display text-[14.5px] font-bold text-text">{t.short}</span>
                <span className="block text-[11.5px] text-faint">{t.doorPrice > 0 ? `€ ${t.doorPrice} aan de deur` : 'Gratis'}</span>
              </span>
              <span className={cn('flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full border-2', on ? 'border-acc bg-acc' : 'border-ghost bg-transparent')}>{on && <Icon name="check" size={12} stroke="#16132B" sw={3} />}</span>
            </button>
          );
        })}
      </div>
      <div className={cn('mb-4 flex items-center gap-[10px] rounded-[13px] px-[14px] py-[13px]', pay ? 'border border-dashed border-line' : 'bg-acc-dim')}>
        <Icon name={pay ? 'money' : 'check2'} size={18} stroke={pay ? '#FFFFFF' : '#B5A6FF'} sw={pay ? 1.9 : 2.4} />
        <span className="text-[13.5px] leading-[1.4] text-text">
          {pay ? (
            <span>
              Moet <b>€{selected?.doorPrice} p.p.</b> afrekenen aan de deur ({heads}×)
            </span>
          ) : (
            <span>Gratis toegang — niets te betalen</span>
          )}
        </span>
      </div>
      <Btn kind="primary" full icon="check" disabled={!selected || busy} onClick={() => void confirm()}>
        {busy ? 'Bezig…' : 'Toevoegen & gast informeren'}
      </Btn>
      <div className="mt-3 flex items-start gap-[7px]">
        <Icon name="bell" size={13} className="text-ghost" />
        <span className="text-[11.5px] leading-[1.45] text-faint">{req.name.split(' ')[0]} krijgt een melding dat de aanvraag is goedgekeurd, met de tier en of er aan de deur betaald moet worden.</span>
      </div>
      <button type="button" onClick={onClose} className={cn('mt-3 cursor-pointer self-center border-none bg-transparent font-body text-[13.5px] font-semibold text-faint', press)}>
        Annuleren
      </button>
    </Sheet>
  );
}
