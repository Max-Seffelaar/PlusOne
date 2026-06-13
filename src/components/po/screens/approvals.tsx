'use client';

/** Approvals: quota requests (#4,#5) + landing-page guest requests (#12,#31),
 *  with a tier-assign sheet that shows door-payment + notifies the guest (#34). */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { guestRequests, quotaRequests, tiers } from '@/lib/po/data';
import type { GuestRequest, Tier } from '@/lib/po/types';
import { useNav } from '../context';
import { Icon } from '../icon';
import { Avatar, Btn, Empty, Label, Note, Top } from '../kit';
import { Sheet } from '../shell';

const press = 'transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]';
const col = 'flex h-full flex-col';

type Verdict = 'ok' | 'no';

export function Aanvragen(): JSX.Element {
  const nav = useNav();
  const [tab, setTab] = useState<'quota' | 'landing'>('quota');
  const [done, setDone] = useState<Record<string, Verdict>>({});
  const [granted, setGranted] = useState<Record<string, Tier>>({});
  const [assign, setAssign] = useState<GuestRequest | null>(null);
  const qReqs = quotaRequests;
  const gReqs = guestRequests;
  const openQ = qReqs.filter((r) => !done[r.id]).length;
  const openG = gReqs.filter((r) => !done[r.id]).length;

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
                      <Btn sm kind="dark" full icon="close" onClick={() => setDone((d) => ({ ...d, [r.id]: 'no' }))}>
                        Afwijzen
                      </Btn>
                      <Btn sm kind="primary" full icon="check2" onClick={() => setDone((d) => ({ ...d, [r.id]: 'ok' }))}>
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
                      <Btn sm kind="dark" full icon="close" onClick={() => setDone((d) => ({ ...d, [r.id]: 'no' }))}>
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
          onClose={() => setAssign(null)}
          onConfirm={(tier) => {
            setGranted((g) => ({ ...g, [assign.id]: tier }));
            setDone((d) => ({ ...d, [assign.id]: 'ok' }));
            setAssign(null);
          }}
        />
      )}
    </div>
  );
}

function AssignSheet({ req, onClose, onConfirm }: { req: GuestRequest; onClose: () => void; onConfirm: (tier: Tier) => void }): JSX.Element {
  const [tierId, setTierId] = useState('regular');
  const tier = tiers.find((t) => t.id === tierId) ?? tiers[tiers.length - 1];
  const heads = 1 + req.plus;
  const pay = tier.doorPrice > 0;
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
        {tiers.map((t) => {
          const on = t.id === tierId;
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
              Moet <b>€{tier.doorPrice} p.p.</b> afrekenen aan de deur ({heads}×)
            </span>
          ) : (
            <span>Gratis toegang — niets te betalen</span>
          )}
        </span>
      </div>
      <Btn kind="primary" full icon="check" onClick={() => onConfirm(tier)}>
        Toevoegen &amp; gast informeren
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
