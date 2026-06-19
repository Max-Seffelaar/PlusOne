'use client';

/** Guest list, guest detail (+logboek, Let-op popup, stepper check-in),
 *  quick-add (#33), bulk-paste, adresboek, permanente gasten. */
import { useState } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { cn } from '@/lib/utils';
import { contacts } from '@/lib/po/data';
import type { Guest as GuestT, PoEvent } from '@/lib/po/types';
import {
  parseQuickAdd,
  parseBulk,
  resolveAmbiguity,
  totalSlots,
  type QuickAddTier,
  type AmbiguityChoice,
  type ParseResult,
} from '@/features/guests/quick-add-parser';
import { resolveDefaultTierId } from '@/features/guests/tiers';
import { usePoEvents, usePoGuests, usePoTiers, usePoQuota } from '@/features/po/hooks';
import { usePoAddGuest, usePoAddGuestsBulk, usePoRequestExtraSlots } from '@/features/po/mutations';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { canManageGuests } from '@/features/auth/roles';
import { useNav, usePo } from '../context';
import { Icon, type IconName } from '../icon';
import { Avatar, Btn, Empty, Field, IconBtn, Label, MiniChip, PayChip, RoleChip, Scroll, StatusDot, Stepper, Top } from '../kit';
import { BottomBar, Sheet } from '../shell';

const cardPress = 'transition-[border-color,transform] hover:border-white/[0.24] active:scale-[0.99]';
const press = 'transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]';
const col = 'flex h-full flex-col';

function FilterChip({ on, onClick, children, grow }: { on: boolean; onClick: () => void; children: React.ReactNode; grow?: boolean }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'shrink-0 cursor-pointer rounded-full border px-[14px] py-[7px] font-display text-[13px] font-bold transition-[filter] hover:brightness-[1.07]',
        grow && 'flex-1',
        on ? 'border-transparent bg-text text-bg' : 'border-line bg-transparent text-dim',
      )}
    >
      {children}
    </button>
  );
}

// ── GUEST LIST (pushed) ──────────────────────────────────────────────────────
export function Lijst({ ev }: { ev: PoEvent }): JSX.Element {
  const nav = useNav();
  const { data: guests = [], isLoading, isError } = usePoGuests(ev.id);
  const [q, setQ] = useState('');
  const [f, setF] = useState<'all' | 'wait' | 'in' | 'vip'>('all');
  // Live data: a guest's own status (checked_in → 'in') drives in/wait, not the
  // prototype's mock door set — the live door outbox arrives in STAP 3.5.
  let gs = guests.filter(
    (g) => f === 'all' || (f === 'in' && g.status === 'in') || (f === 'wait' && g.status === 'wait') || (f === 'vip' && g.role === 'VIP'),
  );
  if (q) gs = gs.filter((g) => g.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className={col}>
      <Top onBack={nav.back} title="Gastenlijst" sub={`${ev.name} · ${gs.length} getoond van ${guests.length}`} right={<IconBtn name="plus" onClick={() => nav.push('quickadd', { id: ev.id })} />} />
      <div className="flex-none px-4 pb-[10px]">
        <Field icon="search" placeholder="Zoek gast…" value={q} onChange={setQ} />
      </div>
      <div className="po-scroll flex flex-none gap-[7px] overflow-x-auto px-4 pb-3">
        {([['all', 'Alle'], ['wait', 'Onderweg'], ['in', 'Binnen'], ['vip', 'VIP']] as const).map(([k, l]) => (
          <FilterChip key={k} on={f === k} onClick={() => setF(k)}>
            {l}
          </FilterChip>
        ))}
      </div>
      <div className="flex flex-none gap-2 px-4 pb-3">
        <Btn sm kind="primary" icon="plus" onClick={() => nav.push('quickadd', { id: ev.id })}>
          Snel toevoegen
        </Btn>
        <Btn sm kind="quiet" icon="paste" onClick={() => nav.push('bulk', { id: ev.id })}>
          Plak namen
        </Btn>
        <Btn sm kind="quiet" icon="contact" onClick={() => nav.push('contacten', { id: ev.id })}>
          Adresboek
        </Btn>
      </div>
      <Scroll pad={16} bottom={24}>
        {isLoading ? (
          <Empty text="Gasten laden…" />
        ) : isError ? (
          <Empty text="Kon de gastenlijst niet laden." />
        ) : gs.length === 0 ? (
          <Empty text={q || f !== 'all' ? 'Geen gasten gevonden.' : 'Nog geen gasten — voeg de eerste toe.'} />
        ) : (
          <div className="flex flex-col gap-[9px]">
            {gs.map((g) => (
              <button key={g.id} type="button" onClick={() => nav.push('guest', { id: g.id, eventId: ev.id })} className={cn('flex items-center gap-[12px] rounded-[16px] border border-line bg-elev p-[12px] text-left', cardPress)}>
                <Avatar name={g.name} size={42} accent={g.role === 'VIP'} />
                <div className="min-w-0 flex-1">
                  <div className="font-display text-[15.5px] font-bold text-text">
                    {g.name}
                    {g.plus > 0 && <span className="font-semibold text-faint"> +{g.plus}</span>}
                  </div>
                  <div className="mt-[5px] flex flex-wrap items-center gap-1.5">
                    <RoleChip role={g.role} />
                    {g.pay === 'pay' && <PayChip pay="pay" />}
                    {g.note && (
                      <span className="text-acc-soft">
                        <Icon name="note" size={13} />
                      </span>
                    )}
                  </div>
                </div>
                <StatusDot status={g.status} label={false} />
              </button>
            ))}
          </div>
        )}
      </Scroll>
    </div>
  );
}

// ── GUEST detail / check-in (pushed) ─────────────────────────────────────────
function LogRow({ icon, label, who, when, accent, last }: { icon: IconName; label: string; who: string; when?: string; accent?: boolean; last?: boolean }): JSX.Element {
  return (
    <div className={cn('flex items-center gap-[12px] py-[12px]', last ? '' : 'border-b border-line2')}>
      <span className={cn('flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px]', accent ? 'bg-acc-dim text-acc' : 'bg-elev2 text-dim')}>
        <Icon name={icon} size={15} sw={2} />
      </span>
      <span className="flex-1 text-[13.5px] text-faint">{label}</span>
      <span className="text-right">
        <span className={cn('text-[13.5px] font-semibold', accent ? 'text-acc' : 'text-text')}>{who}</span>
        {when && <span className="ml-[7px] font-display text-[12px] text-faint">{when}</span>}
      </span>
    </div>
  );
}

export function Guest({ g }: { g: GuestT }): JSX.Element {
  const nav = useNav();
  const { inside, checkIn, uncheck, log, taskDone, ackTask } = usePo();
  const isIn = inside.has(g.id);
  const [plus, setPlus] = useState(g.plus);
  const hasTask = !!g.note;
  const done = taskDone(g.id);
  const [alertOpen, setAlertOpen] = useState(g.flag === 'high' && !done);
  const entry = log[g.id];
  const total = 1 + plus;

  return (
    <div className={col}>
      <Top
        onBack={nav.back}
        title="Gast"
        right={
          <>
            <IconBtn name="share" />
            <IconBtn name="dots" />
          </>
        }
      />
      <Scroll bottom={20}>
        <div className="flex flex-col items-center px-0 pb-[18px] pt-1.5 text-center">
          <Avatar name={g.name} size={84} accent={g.role === 'VIP'} />
          <h2 className="mb-0 mt-4 whitespace-nowrap font-display text-[28px] font-extrabold tracking-[-0.02em] text-text">{g.name}</h2>
          <div className="mt-3 flex gap-[7px]">
            <RoleChip role={g.role} />
            {g.pay === 'pay' ? (
              <PayChip pay="pay" />
            ) : (
              <span className={cn('rounded-[7px] px-2 py-[3px] text-[11px] font-bold', g.pay === 'paid' ? 'border border-transparent bg-acc-dim text-acc' : 'border border-line2 text-faint')}>
                {g.pay === 'paid' ? 'BETAALD' : 'GRATIS'}
              </span>
            )}
          </div>
        </div>

        {hasTask && (
          <div className={cn('mb-[10px] rounded-[14px] p-[14px]', g.flag === 'high' && !done ? 'border border-transparent bg-acc-dim' : 'border border-line bg-elev')}>
            <div className="mb-[7px] flex items-center justify-between">
              <span className="inline-flex items-center gap-[7px]">
                <Icon name="flag" size={15} stroke={g.flag === 'high' ? '#B5A6FF' : 'rgba(255,255,255,0.40)'} fill={g.flag === 'high' ? '#B5A6FF' : 'none'} />
                <Label className={g.flag === 'high' ? 'text-acc-soft' : 'text-faint'}>{g.flag === 'high' ? 'Belangrijke opdracht' : 'Opdracht'}</Label>
              </span>
              {done ? (
                <span className="inline-flex items-center gap-[5px] font-body text-[11.5px] font-bold text-acc">
                  <Icon name="check2" size={13} stroke="#B5A6FF" sw={2.4} />
                  Opgepakt
                </span>
              ) : (
                <span className="font-body text-[11px] font-bold text-faint">OPEN</span>
              )}
            </div>
            <div className="mb-3 text-[15px] leading-[1.45] text-text">{g.note}</div>
            <Btn sm full kind={done ? 'ghost' : 'primary'} icon={done ? 'history' : 'check2'} onClick={() => ackTask(g.id, !done)}>
              {done ? 'Heropenen' : 'Markeer als opgepakt'}
            </Btn>
          </div>
        )}

        {g.pay === 'pay' && (
          <div className="mb-[10px] flex items-center gap-[9px] rounded-[13px] border border-dashed border-line bg-elev px-[14px] py-[11px]">
            <Icon name="money" size={17} className="text-text" />
            <span className="text-[13.5px] font-semibold text-text">Betaalde gastenlijst — laat afrekenen aan de deur</span>
          </div>
        )}

        <Label className="mx-0.5 mb-[10px] mt-1.5">Logboek</Label>
        <div className="mb-4 rounded-[14px] border border-line bg-elev px-[14px] py-1">
          <LogRow icon="user" label="Toegevoegd" who={g.by} when={g.addedAt} />
          {g.plus > 0 && <LogRow icon="users" label="Meegenomen gasten" who={`+${g.plus} tickets`} />}
          {isIn ? (
            <LogRow icon="check2" label="Ingecheckt" who={entry?.by ?? g.inBy ?? '—'} when={entry?.at ?? g.at} accent last />
          ) : (
            <LogRow icon="clock" label="Nog niet ingecheckt" who="onderweg" last />
          )}
        </div>

        {!isIn && (
          <>
            <Label className="mb-[9px]">Hoeveel komen er binnen?</Label>
            <div className="mb-4">
              <Stepper value={plus + 1} onChange={(v) => setPlus(Math.max(0, v - 1))} />
            </div>
          </>
        )}
      </Scroll>
      <BottomBar>
        {isIn ? (
          <Btn kind="ghost" full icon="back" onClick={() => uncheck(g.id)}>
            Uitchecken
          </Btn>
        ) : (
          <Btn
            kind="primary"
            full
            icon="check"
            onClick={() => {
              checkIn(g.id, total);
              nav.back();
            }}
          >
            Check in · {total} {total === 1 ? 'persoon' : 'personen'}
          </Btn>
        )}
      </BottomBar>

      {alertOpen && (
        <Sheet onClose={() => setAlertOpen(false)} center>
          <div className="mb-[14px] flex h-[52px] w-[52px] items-center justify-center rounded-[16px] bg-acc">
            <Icon name="warn" size={28} stroke="#16132B" sw={2.2} />
          </div>
          <div className="font-display text-[22px] font-extrabold tracking-[-0.01em] text-text">Let op!</div>
          <div className="mb-[14px] mt-0.5 text-[13px] text-faint">Opdracht voor {g.name}</div>
          <div className="mb-[18px] w-full rounded-[14px] border border-line bg-elev p-[14px] text-left text-[15.5px] leading-[1.45] text-text">{g.note}</div>
          <Btn
            full
            kind="primary"
            icon="check2"
            onClick={() => {
              ackTask(g.id, true);
              setAlertOpen(false);
            }}
          >
            Gezien &amp; opgepakt
          </Btn>
          <button type="button" onClick={() => setAlertOpen(false)} className={cn('mt-[10px] cursor-pointer border-none bg-transparent font-body text-[13.5px] font-semibold text-faint', press)}>
            Later
          </button>
        </Sheet>
      )}
    </div>
  );
}

// ── QUICK-ADD (#33) ──────────────────────────────────────────────────────────
interface JustAdded {
  id: string;
  name: string;
  plus: number;
  tierShort: string;
  vip: boolean;
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

export function QuickAdd({ eventId }: { eventId?: string }): JSX.Element {
  const nav = useNav();
  const { data: liveEvents = [] } = usePoEvents();
  const upcoming = liveEvents.filter((e) => e.when === 'upcoming');
  const [curId, setCurId] = useState<string | undefined>(eventId);
  const curEv = liveEvents.find((e) => e.id === curId) ?? upcoming[0] ?? liveEvents[0];
  const evId = curEv?.id ?? '';

  const { data: tiers = [] } = usePoTiers(evId);
  const { data: quota } = usePoQuota(evId);
  const add = usePoAddGuest(evId);
  const reqExtra = usePoRequestExtraSlots(evId);
  const { roles } = usePoIdentity();

  const [val, setVal] = useState('');
  const [choice, setChoice] = useState<AmbiguityChoice | null>(null);
  const [added, setAdded] = useState<JustAdded[]>([]);
  const [evPick, setEvPick] = useState(false);
  const [reqOpen, setReqOpen] = useState(false);
  const [reqMotiv, setReqMotiv] = useState('');

  const qaTiers: QuickAddTier[] = tiers.map((t) => ({ id: t.id, name: t.name, aliases: t.aliases }));
  const defaultTierId = resolveDefaultTierId(qaTiers);

  // Parse against the LIVE tiers with the shared #33 parser (same one the desktop
  // quick-add uses), so behaviour — fuzzy match, NL +N, ambiguity — is identical.
  const parsed = defaultTierId && val.trim() ? parseQuickAdd(val, qaTiers, defaultTierId) : null;
  const isAmbiguous = parsed?.status === 'ambiguous';
  const resolved =
    isAmbiguous && choice && parsed && defaultTierId ? resolveAmbiguity(parsed, choice, defaultTierId) : null;

  const effName = (resolved ? resolved.name : parsed?.name ?? '').trim();
  const effPlus = resolved ? resolved.plusOnes : parsed?.plusOnes ?? 0;
  const effTierId = resolved?.tierId ?? parsed?.tierId ?? defaultTierId ?? '';
  const effTier = tiers.find((t) => t.id === effTierId);
  const cost = 1 + effPlus;

  const exempt = quota?.exempt ?? false;
  const remaining = exempt ? null : quota?.remaining ?? null;
  const overQuota = remaining !== null && cost > remaining;
  // Hide the quick-add for roles that can't create guests (user_manager/finance):
  // RLS would reject the insert with a confusing 42501, so gate the UI instead.
  // admin/staff/doorhost qualify via role; an event organizer via the exempt flag.
  const canAdd = exempt || canManageGuests(roles);
  const reqShortfall = remaining !== null ? Math.max(1, cost - remaining) : 1;
  const needsAsk = !!isAmbiguous && !choice;
  const canSubmit = !add.isPending && !!defaultTierId && !!evId && effName !== '' && !needsAsk && !overQuota;

  const onInput = (v: string): void => {
    setVal(v);
    setChoice(null);
    setReqOpen(false);
    reqExtra.reset();
  };

  const commit = (): void => {
    if (!canSubmit || !effTier) return;
    // Client UUIDv7 so the optimistic row and the inserted row share an id (#25)
    // — the list reconciles without a flash when invalidation refetches.
    const id = uuidv7();
    const snapshot: JustAdded = { id, name: effName, plus: effPlus, tierShort: effTier.short, vip: effTier.role === 'VIP' };
    add.mutate(
      {
        id,
        eventId: evId,
        tierId: effTierId,
        fullName: effName,
        plusOnes: effPlus,
        email: parsed?.email ?? undefined,
        phone: parsed?.phone ?? undefined,
        source: 'app',
      },
      {
        onSuccess: () => {
          setAdded((a) => [snapshot, ...a]);
          setVal('');
          setChoice(null);
        },
      },
    );
  };

  const sub = !curEv
    ? 'Geen event gekozen'
    : exempt
      ? 'onbeperkt quotum'
      : remaining !== null && quota
        ? `jouw quotum ${remaining} van ${quota.quota} over`
        : 'gast toevoegen';

  return (
    <div className={col}>
      <Top onBack={nav.back} title="Gast toevoegen" sub={sub} right={<IconBtn name="paste" onClick={() => nav.push('bulk', curEv ? { id: curEv.id } : {})} />} />
      <Scroll bottom={120}>
        <Label className="mb-2">Evenement</Label>
        {curEv ? (
          <button type="button" onClick={() => setEvPick(true)} className={cn('mb-4 flex w-full items-center gap-[13px] rounded-[14px] border border-line bg-elev px-[14px] py-[13px] text-left', press)}>
            <span className="w-[40px] shrink-0 text-center">
              <span className="block font-display text-[18px] font-extrabold leading-none text-text">{curEv.date}</span>
              <span className="mt-0.5 block text-[9.5px] font-bold tracking-[0.05em] text-faint">{curEv.mon}</span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-[15.5px] font-bold text-text">{curEv.name}</span>
              <span className="mt-px block text-[12.5px] text-faint">
                deur {curEv.time} · {curEv.venue}
              </span>
            </span>
            <span className="text-acc">
              <Icon name="chevD" size={18} />
            </span>
          </button>
        ) : (
          <div className="mb-4">
            <Empty text="Nog geen komend event om aan toe te voegen." />
          </div>
        )}

        {curEv && !canAdd && (
          <div className="rounded-[16px] border border-line bg-elev p-[14px] text-[13.5px] leading-[1.45] text-faint">
            Je hebt op dit event geen rechten om gasten toe te voegen. Vraag een beheerder of organisator om toegang.
          </div>
        )}

        {curEv && canAdd && !defaultTierId && (
          <div className="rounded-[16px] border border-line bg-elev p-[14px] text-[13.5px] leading-[1.45] text-faint">
            Dit event heeft nog geen tiers. Voeg eerst een tier toe via eventbeheer voordat je gasten toevoegt.
          </div>
        )}

        {curEv && canAdd && defaultTierId && (
          <>
            <Label className="mb-2">Typ vrij — naam, +gasten, tier</Label>
            <div className={cn('rounded-[16px] border bg-elev px-[15px] py-[14px] transition-colors', parsed ? 'border-acc' : 'border-line')}>
              <input
                autoFocus
                value={val}
                onChange={(e) => onInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canSubmit) commit();
                }}
                placeholder={'bv. "Juri Braakman +2 vip"'}
                className="w-full border-none bg-transparent font-display text-[18px] font-bold tracking-[-0.01em] text-text outline-none placeholder:text-faint"
              />
              {parsed && (
                <div className="mt-[13px] flex flex-wrap gap-[7px]">
                  <PreviewChip icon="user" label={effName || '—'} />
                  {effPlus > 0 && <PreviewChip icon="users" label={`+${effPlus}`} />}
                  {!needsAsk && effTier && <PreviewChip dot={effTier.color} label={effTier.short} />}
                  {needsAsk && parsed.ambiguous && (
                    <MiniChip className="border-dashed border-acc text-text">“{parsed.ambiguous.text}” ?</MiniChip>
                  )}
                </div>
              )}
            </div>

            {needsAsk && parsed?.ambiguous && (
              <div className="mt-3 rounded-[16px] bg-acc-dim p-[14px]">
                <div className="mb-[11px] text-[13.5px] leading-[1.45] text-text">
                  <b>“{parsed.ambiguous.text}”</b> herken ik niet. Wat bedoel je?
                </div>
                <div className="flex flex-col gap-2">
                  {parsed.ambiguous.suggestions.map((s) => {
                    const t = tiers.find((x) => x.id === s.tierId);
                    return (
                      <button key={s.tierId} type="button" onClick={() => setChoice({ kind: 'tier', tierId: s.tierId })} className={cn('flex items-center gap-[10px] rounded-[12px] border border-line bg-bg px-[13px] py-[12px] text-text', press)}>
                        <span className="h-[10px] w-[10px] rounded-full" style={{ background: t?.color ?? '#B5A6FF' }} />
                        <span className="flex-1 text-left font-display text-[14.5px] font-bold">{s.tierName}</span>
                        <Icon name="chev" size={16} className="text-ghost" />
                      </button>
                    );
                  })}
                  <button type="button" onClick={() => setChoice({ kind: 'default' })} className={cn('flex items-center gap-[10px] rounded-[12px] border border-line bg-bg px-[13px] py-[12px] text-text', press)}>
                    <Icon name="ticket" size={15} className="text-faint" />
                    <span className="flex-1 text-left font-display text-[14.5px] font-bold">{tiers.find((t) => t.id === defaultTierId)?.short ?? 'Standaard'}</span>
                    <Icon name="chev" size={16} className="text-ghost" />
                  </button>
                  <button type="button" onClick={() => setChoice({ kind: 'name' })} className={cn('flex items-center gap-[10px] rounded-[12px] border border-line bg-bg px-[13px] py-[12px] text-text', press)}>
                    <Icon name="user" size={15} className="text-faint" />
                    <span className="flex-1 text-left font-display text-[14.5px] font-bold">Hoort bij de naam</span>
                    <Icon name="chev" size={16} className="text-ghost" />
                  </button>
                </div>
              </div>
            )}

            {parsed && !needsAsk && !exempt && remaining !== null && (
              <div className={cn('mt-3 flex items-center gap-[9px] rounded-[13px] px-[14px] py-[11px]', overQuota ? 'border border-acc bg-white/[0.04]' : 'border border-line bg-elev')}>
                <Icon name="ticket" size={17} stroke={overQuota ? '#B5A6FF' : 'rgba(255,255,255,0.40)'} />
                <span className="flex-1 text-[13.5px] text-text">
                  Kost <b>{cost}</b> {cost === 1 ? 'plek' : 'plekken'} ·{' '}
                  {overQuota
                    ? `${remaining} over · ${cost - remaining} te veel`
                    : `${remaining - cost} over na toevoegen`}
                </span>
                {overQuota && <MiniChip className="border-acc text-acc">Quotum vol</MiniChip>}
              </div>
            )}

            {overQuota && parsed && !needsAsk ? (
              reqExtra.isSuccess ? (
                <div className="mt-[10px] flex items-center gap-[9px] rounded-[13px] border border-acc bg-acc-dim px-[14px] py-[11px] text-[13px] text-text">
                  <Icon name="check" size={16} stroke="#B5A6FF" />
                  <span className="flex-1">Aanvraag verstuurd — een beheerder beslist erover.</span>
                </div>
              ) : reqOpen ? (
                <div className="mt-[10px] flex flex-col gap-[10px] rounded-[16px] border border-line bg-elev p-[14px]">
                  <Label>
                    Vraag {reqShortfall} extra {reqShortfall === 1 ? 'plek' : 'plekken'} aan
                  </Label>
                  <textarea
                    autoFocus
                    value={reqMotiv}
                    onChange={(e) => setReqMotiv(e.target.value)}
                    maxLength={500}
                    rows={2}
                    placeholder="Waarom heb je deze plekken nodig?"
                    className="w-full resize-none rounded-[12px] border border-line bg-bg px-[13px] py-[11px] text-[14px] text-text outline-none placeholder:text-faint focus:border-acc"
                  />
                  {reqExtra.isError && (
                    <p className="text-[12.5px] text-acc" role="alert">
                      {reqExtra.error?.message ?? 'Versturen mislukt.'}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Btn
                      kind="primary"
                      icon="check"
                      className={cn((reqExtra.isPending || reqMotiv.trim() === '') && 'opacity-[0.45]')}
                      disabled={reqExtra.isPending || reqMotiv.trim() === ''}
                      onClick={() =>
                        reqExtra.mutate({
                          eventId: evId,
                          requestedExtra: reqShortfall,
                          motivation: reqMotiv.trim(),
                        })
                      }
                    >
                      {reqExtra.isPending ? 'Versturen…' : 'Versturen'}
                    </Btn>
                    <Btn
                      kind="ghost"
                      onClick={() => {
                        setReqOpen(false);
                        setReqMotiv('');
                      }}
                    >
                      Annuleren
                    </Btn>
                  </div>
                </div>
              ) : (
                <Btn kind="ghost" full icon="plus" className="mt-[10px]" onClick={() => setReqOpen(true)}>
                  Extra plekken aanvragen
                </Btn>
              )
            ) : null}

            {add.isError && (
              <div className="mt-3 flex items-center gap-[9px] rounded-[13px] border border-acc bg-acc-dim px-[14px] py-[11px] text-[13px] text-text">
                <Icon name="warn" size={16} stroke="#B5A6FF" />
                <span className="flex-1">{add.error?.message}</span>
              </div>
            )}

            {added.length > 0 && (
              <>
                <Label className="mx-0.5 mb-[10px] mt-[22px]">Net toegevoegd · {added.length}</Label>
                <div className="flex flex-col gap-2">
                  {added.map((g) => (
                    <div key={g.id} className="flex items-center gap-[11px] rounded-[14px] border border-line bg-elev p-[11px]">
                      <Avatar name={g.name} size={36} accent={g.vip} />
                      <div className="min-w-0 flex-1">
                        <div className="font-display text-[14.5px] font-bold text-text">
                          {g.name}
                          {g.plus > 0 && <span className="text-faint"> +{g.plus}</span>}
                        </div>
                        <div className="mt-0.5 text-[11.5px] text-faint">{g.tierShort}</div>
                      </div>
                      <span className="inline-flex items-center gap-[5px] font-body text-[11.5px] font-bold text-acc">
                        <Icon name="check2" size={13} stroke="#B5A6FF" sw={2.4} />
                        op lijst
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </Scroll>
      <BottomBar>
        <Btn kind="primary" full icon="plus" onClick={commit} className={canSubmit ? '' : 'opacity-[0.45]'}>
          {add.isPending ? 'Bezig…' : parsed ? `Voeg toe · ${effName || 'gast'}${effPlus ? ' +' + effPlus : ''}` : 'Typ een naam'}
        </Btn>
      </BottomBar>

      {evPick && (
        <Sheet onClose={() => setEvPick(false)} center={false}>
          <div className="mb-1 font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">Kies evenement</div>
          <div className="mb-4 text-[13px] text-faint">Aan welke gastenlijst voeg je toe?</div>
          <div className="flex flex-col gap-2">
            {upcoming.map((e) => {
              const on = e.id === curEv?.id;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => {
                    setCurId(e.id);
                    setEvPick(false);
                  }}
                  className={cn('flex items-center gap-[12px] rounded-[12px] border px-[13px] py-[12px] text-left', on ? 'border-transparent bg-acc-dim' : 'border-line bg-elev', press)}
                >
                  <span className="w-[38px] shrink-0 text-center">
                    <span className="block font-display text-[16px] font-extrabold leading-none text-text">{e.date}</span>
                    <span className="block text-[9px] font-bold tracking-[0.05em] text-faint">{e.mon}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-[14.5px] font-bold text-text">{e.name}</span>
                    <span className="block text-[11.5px] text-faint">{e.venue}</span>
                  </span>
                  {on && <Icon name="check2" size={17} stroke="#B5A6FF" sw={2.4} />}
                </button>
              );
            })}
          </div>
        </Sheet>
      )}
    </div>
  );
}

// ── BULK PASTE (#33) ─────────────────────────────────────────────────────────
interface ResolvedRow {
  name: string;
  plusOnes: number;
  tierId: string;
  needsChoice: boolean;
}

/** Fold a parsed line + the user's chip choice into a final addable row. */
function resolveRow(r: ParseResult, choice: AmbiguityChoice | undefined, defaultTierId: string): ResolvedRow {
  if (r.status === 'ambiguous') {
    if (!choice) return { name: r.name, plusOnes: r.plusOnes, tierId: defaultTierId, needsChoice: true };
    const res = resolveAmbiguity(r, choice, defaultTierId);
    return { name: res.name, plusOnes: res.plusOnes, tierId: res.tierId, needsChoice: false };
  }
  return { name: r.name, plusOnes: r.plusOnes, tierId: r.tierId ?? defaultTierId, needsChoice: false };
}

export function BulkPaste({ eventId }: { eventId?: string }): JSX.Element {
  const nav = useNav();
  const { data: liveEvents = [] } = usePoEvents();
  const upcoming = liveEvents.filter((e) => e.when === 'upcoming');
  const curEv = liveEvents.find((e) => e.id === eventId) ?? upcoming[0] ?? liveEvents[0];
  const evId = curEv?.id ?? '';

  const { data: tiers = [] } = usePoTiers(evId);
  const { data: quota } = usePoQuota(evId);
  const addBulk = usePoAddGuestsBulk(evId);

  const qaTiers: QuickAddTier[] = tiers.map((t) => ({ id: t.id, name: t.name, aliases: t.aliases }));
  const defaultTierId = resolveDefaultTierId(qaTiers);

  const [text, setText] = useState('');
  const [choices, setChoices] = useState<Record<number, AmbiguityChoice>>({});

  const rows = defaultTierId ? parseBulk(text, qaTiers, defaultTierId) : [];
  const resolvedRows = rows.map((r, i) => resolveRow(r, choices[i], defaultTierId ?? ''));
  const total = totalSlots(resolvedRows.map((r) => ({ plusOnes: r.plusOnes })));
  const doubtful = resolvedRows.filter((r) => r.needsChoice || r.name === '').length;
  const ready = rows.length - doubtful;

  const exempt = quota?.exempt ?? false;
  const remaining = exempt ? null : quota?.remaining ?? null;
  const overQuota = remaining !== null && total > remaining;
  const canConfirm = !addBulk.isPending && rows.length > 0 && doubtful === 0 && !overQuota && !!defaultTierId && !!evId;

  const confirm = (): void => {
    if (!canConfirm) return;
    // One UUIDv7 per row (#25) — the optimistic rows match the inserted rows. The
    // DB enforces the batch atomically (quota overage rolls the whole batch back).
    addBulk.mutate(
      {
        eventId: evId,
        source: 'app',
        guests: resolvedRows.map((r, i) => ({
          id: uuidv7(),
          fullName: r.name,
          plusOnes: r.plusOnes,
          tierId: r.tierId,
          email: rows[i]?.email ?? undefined,
          phone: rows[i]?.phone ?? undefined,
        })),
      },
      {
        onSuccess: () => {
          setText('');
          setChoices({});
          nav.back();
        },
      },
    );
  };

  return (
    <div className={col}>
      <Top onBack={nav.back} title="Plak een lijst" sub={curEv ? `Naar ${curEv.name} · één gast per regel` : 'Eén gast per regel'} />
      <Scroll bottom={120}>
        {!curEv ? (
          <Empty text="Nog geen komend event om aan toe te voegen." />
        ) : !defaultTierId ? (
          <div className="rounded-[16px] border border-line bg-elev p-[14px] text-[13.5px] leading-[1.45] text-faint">
            Dit event heeft nog geen tiers. Voeg eerst een tier toe via eventbeheer.
          </div>
        ) : (
          <>
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setChoices({});
              }}
              rows={5}
              placeholder={'Juri Braakman +2 vip\nNoor de Wit\nSem Aaltink fles\nLucas van Os +1'}
              className="mb-4 w-full resize-y rounded-[14px] border border-line bg-elev p-[14px] font-body text-[14.5px] leading-[1.5] text-text outline-none placeholder:text-faint"
            />
            {rows.length > 0 && (
              <>
                <div className="mb-[10px] flex items-center justify-between">
                  <Label>Preview · {rows.length} regels</Label>
                  {doubtful > 0 && <MiniChip className="border-acc text-acc">{doubtful} te controleren</MiniChip>}
                </div>
                <div className="flex flex-col gap-2">
                  {rows.map((r, i) => {
                    const res = resolvedRows[i];
                    const ask = res.needsChoice;
                    const tier = tiers.find((t) => t.id === res.tierId);
                    return (
                      <div key={i} className={cn('rounded-[14px] border bg-elev p-[12px]', ask ? 'border-acc' : 'border-line')}>
                        <div className="flex items-center gap-[11px]">
                          <Avatar name={res.name || r.raw} size={34} accent={tier?.role === 'VIP'} />
                          <div className="min-w-0 flex-1">
                            <div className="font-display text-[14.5px] font-bold text-text">
                              {res.name || r.raw}
                              {res.plusOnes > 0 && <span className="text-faint"> +{res.plusOnes}</span>}
                            </div>
                            <div className={cn('mt-0.5 text-[11.5px]', ask ? 'text-acc' : 'text-faint')}>
                              {ask ? `“${r.ambiguous?.text ?? ''}” onbekend` : tier?.short ?? '—'}
                            </div>
                          </div>
                          {!ask && (
                            <span className="text-acc">
                              <Icon name="check2" size={17} stroke="#B5A6FF" sw={2.2} />
                            </span>
                          )}
                        </div>
                        {ask && r.ambiguous && (
                          <div className="mt-[11px] flex flex-wrap gap-[7px]">
                            {r.ambiguous.suggestions.map((s) => (
                              <button
                                key={s.tierId}
                                type="button"
                                onClick={() => setChoices((c) => ({ ...c, [i]: { kind: 'tier', tierId: s.tierId } }))}
                                className={cn('flex-1 rounded-[10px] border border-line bg-elev2 py-[9px] font-display text-[12.5px] font-bold text-text', press)}
                              >
                                {s.tierName}
                              </button>
                            ))}
                            <button
                              type="button"
                              onClick={() => setChoices((c) => ({ ...c, [i]: { kind: 'default' } }))}
                              className={cn('flex-1 rounded-[10px] border border-line bg-elev2 py-[9px] font-display text-[12.5px] font-bold text-text', press)}
                            >
                              {tiers.find((t) => t.id === defaultTierId)?.short ?? 'Standaard'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setChoices((c) => ({ ...c, [i]: { kind: 'name' } }))}
                              className={cn('flex-1 rounded-[10px] border border-line bg-elev2 py-[9px] font-display text-[12.5px] font-bold text-text', press)}
                            >
                              Bij naam
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {!exempt && remaining !== null && (
                  <div className={cn('mt-3 text-[12.5px]', overQuota ? 'text-acc-soft' : 'text-faint')}>
                    {total} {total === 1 ? 'plek' : 'plekken'} · {remaining} over in je quotum
                    {overQuota && ' — de hele batch wordt geblokkeerd'}
                  </div>
                )}
                {addBulk.isError && (
                  <div className="mt-3 flex items-center gap-[9px] rounded-[13px] border border-acc bg-acc-dim px-[14px] py-[11px] text-[13px] text-text">
                    <Icon name="warn" size={16} stroke="#B5A6FF" />
                    <span className="flex-1">{addBulk.error?.message}</span>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </Scroll>
      <BottomBar>
        <Btn kind="primary" full icon="check" onClick={confirm} className={canConfirm ? '' : 'opacity-[0.45]'}>
          {addBulk.isPending
            ? 'Bezig…'
            : doubtful > 0
              ? `Voeg ${ready} toe · ${doubtful} open`
              : `Voeg ${ready} ${ready === 1 ? 'gast' : 'gasten'} toe`}
        </Btn>
      </BottomBar>
    </div>
  );
}

// ── ADRESBOEK (pushed) ───────────────────────────────────────────────────────
export function Contacten(): JSX.Element {
  const nav = useNav();
  const { vast, toggleVast } = usePo();
  const [q, setQ] = useState('');
  let cs = contacts;
  if (q) cs = cs.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className={col}>
      <Top onBack={nav.back} title="Adresboek" sub="1.284 contacten · herbruik in één tik" right={<IconBtn name="upload" />} />
      <div className="flex-none px-4 pb-3">
        <Field icon="search" placeholder="Zoek op naam of tag…" value={q} onChange={setQ} />
      </div>
      <Scroll pad={16} bottom={24}>
        <div className="flex flex-col gap-[9px]">
          {cs.map((c) => (
            <div key={c.name} className="flex items-center gap-[12px] rounded-[16px] border border-line bg-elev p-[12px]">
              <Avatar name={c.name} size={42} accent={vast.has(c.name)} />
              <div className="min-w-0 flex-1">
                <div className="font-display text-[15.5px] font-bold text-text">{c.name}</div>
                <div className="mt-1 flex items-center gap-2">
                  <RoleChip role={c.role} />
                  <span className="text-[11.5px] text-faint">{c.events}× op een lijst</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => toggleVast(c.name)}
                title="Altijd toevoegen"
                className={cn('flex h-[38px] w-[38px] items-center justify-center rounded-[11px] border', press, vast.has(c.name) ? 'border-transparent bg-acc-dim text-acc' : 'border-line text-ghost')}
              >
                <Icon name="star" size={17} fill={vast.has(c.name) ? '#B5A6FF' : 'none'} stroke={vast.has(c.name) ? '#B5A6FF' : 'rgba(255,255,255,0.26)'} />
              </button>
              <button type="button" className={cn('flex h-[38px] w-[38px] items-center justify-center rounded-[11px] border-none bg-text text-bg', press)}>
                <Icon name="plus" size={18} sw={2.4} />
              </button>
            </div>
          ))}
        </div>
      </Scroll>
    </div>
  );
}

// ── PERMANENTE GASTEN (pushed) ───────────────────────────────────────────────
export function Vaste(): JSX.Element {
  const nav = useNav();
  const { vast, toggleVast } = usePo();
  const list = contacts.filter((c) => vast.has(c.name));
  return (
    <div className={col}>
      <Top onBack={nav.back} title="Permanente gasten" right={<IconBtn name="plus" />} />
      <Scroll bottom={24}>
        <div className="mb-4 flex gap-[12px] rounded-[16px] bg-acc-dim p-[15px]">
          <Icon name="star" size={20} stroke="#B5A6FF" fill="#B5A6FF" />
          <div className="text-[13.5px] leading-[1.45] text-text">
            Deze gasten komen <b>automatisch</b> op élke nieuwe gastenlijst. Eén keer instellen — daarna niets meer doen.
          </div>
        </div>
        <div className="flex flex-col gap-[9px]">
          {list.map((c) => (
            <div key={c.name} className="flex items-center gap-[12px] rounded-[16px] border border-line bg-elev p-[12px]">
              <Avatar name={c.name} size={42} accent />
              <div className="flex-1">
                <div className="font-display text-[15.5px] font-bold text-text">{c.name}</div>
                <div className="mt-[3px] text-[12px] text-faint">auto · {c.role}</div>
              </div>
              <button type="button" onClick={() => toggleVast(c.name)} className={cn('flex h-[38px] w-[38px] items-center justify-center rounded-[11px] border border-line text-faint', press)}>
                <Icon name="close" size={16} />
              </button>
            </div>
          ))}
          {list.length === 0 && <div className="py-[30px] text-center text-[14px] text-faint">Nog geen permanente gasten.</div>}
        </div>
      </Scroll>
    </div>
  );
}
