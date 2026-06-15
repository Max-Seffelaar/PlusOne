'use client';

/** Guest list, guest detail (+logboek, Let-op popup, stepper check-in),
 *  quick-add (#33), bulk-paste, adresboek, permanente gasten. */
import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { contacts, events, tiers } from '@/lib/po/data';
import { parseBulk, parseQuickAdd } from '@/lib/po/parse';
import {
  parseQuickAdd as parseQuickAddLive,
  parseBulk as parseBulkLive,
  resolveAmbiguity,
  type ParseResult,
} from '@/features/guests/quick-add-parser';
import { resolveDefaultTierId } from '@/features/guests/tiers';
import type { Guest as GuestT, PoEvent, Tier } from '@/lib/po/types';
import {
  useEventGuest,
  useEventGuests,
  useEventQuota,
  useEventTiers,
  useGuestLog,
  useGuestMutations,
} from '@/features/po/guests-live';
import { usePoEvents } from '@/features/po/PoLiveProvider';
import { usePoDoor } from '@/features/po/door-live';
import { useNav, usePo } from '../context';
import { Icon, type IconName } from '../icon';
import { Avatar, Btn, Field, IconBtn, Label, MiniChip, PayChip, RoleChip, Scroll, StatusDot, Stepper, Top } from '../kit';
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
export function Lijst({ ev, eventId }: { ev: PoEvent; eventId?: string }): JSX.Element {
  const nav = useNav();
  const { inside } = usePo();
  const evId = eventId ?? ev.id;
  const { guests: liveGuests, isLoading } = useEventGuests(evId);
  const [q, setQ] = useState('');
  const [f, setF] = useState<'all' | 'wait' | 'in' | 'vip'>('all');

  // "Binnen" is the door-local toggle (usePo) OR the server check-in status.
  const isInside = (g: GuestT): boolean => inside.has(g.id) || g.status === 'in';
  const total = liveGuests.length;
  let gs = liveGuests.filter(
    (g) => f === 'all' || (f === 'in' && isInside(g)) || (f === 'wait' && !isInside(g)) || (f === 'vip' && g.role === 'VIP'),
  );
  if (q) gs = gs.filter((g) => g.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className={col}>
      <Top onBack={nav.back} title="Gastenlijst" sub={`${ev.name} · ${gs.length} getoond van ${total}`} right={<IconBtn name="plus" onClick={() => nav.push('quickadd', { id: evId })} />} />
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
        <Btn sm kind="primary" icon="plus" onClick={() => nav.push('quickadd', { id: evId })}>
          Snel toevoegen
        </Btn>
        <Btn sm kind="quiet" icon="paste" onClick={() => nav.push('bulk', { id: evId })}>
          Plak namen
        </Btn>
        <Btn sm kind="quiet" icon="contact" onClick={() => nav.push('contacten')}>
          Adresboek
        </Btn>
      </div>
      <Scroll pad={16} bottom={24}>
        {isLoading && gs.length === 0 && <p className="px-1 py-6 text-[13px] text-dim">Laden…</p>}
        {!isLoading && total === 0 && <p className="px-1 py-6 text-[13px] text-dim">Nog geen gasten op deze lijst.</p>}
        <div className="flex flex-col gap-[9px]">
          {gs.map((g) => (
            <button key={g.id} type="button" onClick={() => nav.push('guest', { id: g.id, eventId: evId })} className={cn('flex items-center gap-[12px] rounded-[16px] border border-line bg-elev p-[12px] text-left', cardPress)}>
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
              <StatusDot status={isInside(g) ? 'in' : 'wait'} label={false} />
            </button>
          ))}
        </div>
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

export function Guest({ g, eventId, id }: { g: GuestT; eventId?: string; id?: string }): JSX.Element {
  const nav = useNav();
  // The nav stack only carries the guest id + eventId; `g` is the mock fallback.
  // In a live event we must resolve the REAL guest by the clicked id and wait for
  // it — otherwise every live guest rendered mock `guests[0]` (the detail looked
  // up the wrong id, so check-in feedback was for the wrong person).
  const { guest: liveGuest, isLoading } = useEventGuest(eventId, id ?? g.id);
  if (!eventId) return <GuestDetail g={g} />;
  if (!liveGuest) {
    return (
      <div className={col}>
        <Top onBack={nav.back} title="Gast" />
        <div className="flex flex-1 items-center justify-center px-6 text-center text-[13.5px] text-faint">
          {isLoading ? 'Laden…' : 'Deze gast staat niet (meer) op de lijst.'}
        </div>
      </div>
    );
  }
  return <GuestDetail g={liveGuest} eventId={eventId} />;
}

/** The guest detail itself, mounted once the guest is resolved so the +gasten
 *  stepper and task state init from the right person. */
function GuestDetail({ g: gx, eventId }: { g: GuestT; eventId?: string }): JSX.Element {
  const nav = useNav();
  // Check-in state: in an event context it comes from the outbox-backed door hook
  // so it actually PERSISTS (#25/#11); otherwise the in-memory mock. Uncheck isn't
  // an outbox op — it stays mock (rare door edge).
  const mock = usePo();
  const door = usePoDoor(eventId);
  const live = Boolean(eventId);
  const inside = live ? door.inside : mock.inside;
  const checkIn = live ? door.checkIn : mock.checkIn;
  const log = live ? door.log : mock.log;
  const taskDone = live ? door.taskDone : mock.taskDone;
  const ackTask = live ? door.ackTask : mock.ackTask;
  const uncheck = mock.uncheck;
  const { entries: auditLog } = useGuestLog(gx.id);
  const isIn = inside.has(gx.id) || gx.status === 'in';
  const [plus, setPlus] = useState(gx.plus);
  const hasTask = !!gx.note;
  const done = taskDone(gx.id);
  const [alertOpen, setAlertOpen] = useState(gx.flag === 'high' && !done);
  const entry = log[gx.id];
  const total = 1 + plus;
  // The curated summary rows already show "Toegevoegd" + the check-in; the audit
  // trail adds everything else that happened to this guest (tier moves, edits…).
  const extraLog = auditLog.filter((e) => e.action !== 'create' && e.action !== 'check_in');

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
          <Avatar name={gx.name} size={84} accent={gx.role === 'VIP'} />
          <h2 className="mb-0 mt-4 whitespace-nowrap font-display text-[28px] font-extrabold tracking-[-0.02em] text-text">{gx.name}</h2>
          <div className="mt-3 flex gap-[7px]">
            <RoleChip role={gx.role} />
            {gx.pay === 'pay' ? (
              <PayChip pay="pay" />
            ) : (
              <span className={cn('rounded-[7px] px-2 py-[3px] text-[11px] font-bold', gx.pay === 'paid' ? 'border border-transparent bg-acc-dim text-acc' : 'border border-line2 text-faint')}>
                {gx.pay === 'paid' ? 'BETAALD' : 'GRATIS'}
              </span>
            )}
          </div>
        </div>

        {hasTask && (
          <div className={cn('mb-[10px] rounded-[14px] p-[14px]', gx.flag === 'high' && !done ? 'border border-transparent bg-acc-dim' : 'border border-line bg-elev')}>
            <div className="mb-[7px] flex items-center justify-between">
              <span className="inline-flex items-center gap-[7px]">
                <Icon name="flag" size={15} stroke={gx.flag === 'high' ? '#B5A6FF' : 'rgba(255,255,255,0.40)'} fill={gx.flag === 'high' ? '#B5A6FF' : 'none'} />
                <Label className={gx.flag === 'high' ? 'text-acc-soft' : 'text-faint'}>{gx.flag === 'high' ? 'Belangrijke opdracht' : 'Opdracht'}</Label>
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
            <div className="mb-3 text-[15px] leading-[1.45] text-text">{gx.note}</div>
            <Btn sm full kind={done ? 'ghost' : 'primary'} icon={done ? 'history' : 'check2'} onClick={() => ackTask(gx.id, !done)}>
              {done ? 'Heropenen' : 'Markeer als opgepakt'}
            </Btn>
          </div>
        )}

        {gx.pay === 'pay' && (
          <div className="mb-[10px] flex items-center gap-[9px] rounded-[13px] border border-dashed border-line bg-elev px-[14px] py-[11px]">
            <Icon name="money" size={17} className="text-text" />
            <span className="text-[13.5px] font-semibold text-text">Betaalde gastenlijst — laat afrekenen aan de deur</span>
          </div>
        )}

        <Label className="mx-0.5 mb-[10px] mt-1.5">Logboek</Label>
        <div className="mb-4 rounded-[14px] border border-line bg-elev px-[14px] py-1">
          <LogRow icon="user" label="Toegevoegd" who={gx.by} when={gx.addedAt} />
          {gx.plus > 0 && <LogRow icon="users" label="Meegenomen gasten" who={`+${gx.plus} tickets`} />}
          {/* Live audit trail (#4): tier moves, edits, refusals — newest first. */}
          {extraLog.map((e) => (
            <LogRow key={e.id} icon="history" label={e.label} who={e.by} when={e.when} />
          ))}
          {isIn ? (
            <LogRow icon="check2" label="Ingecheckt" who={entry?.by ?? gx.inBy ?? '—'} when={entry?.at ?? gx.at} accent last />
          ) : (
            <LogRow icon="clock" label="Nog niet ingecheckt" who="onderweg" last />
          )}
        </div>

        {!isIn && (
          <>
            <Label className="mb-[9px]">Hoeveel komen er binnen?</Label>
            <div className="mb-4">
              {/* Capped at the guest's allotment (1 + plus_ones): you can't check in
                  more than they were given — edit the order to change that (#22). */}
              <Stepper value={plus + 1} min={1} max={gx.plus + 1} onChange={(v) => setPlus(Math.max(0, v - 1))} />
            </div>
          </>
        )}
      </Scroll>
      <BottomBar>
        {isIn ? (
          <Btn kind="ghost" full icon="back" onClick={() => uncheck(gx.id)}>
            Uitchecken
          </Btn>
        ) : (
          <Btn
            kind="primary"
            full
            icon="check"
            onClick={() => {
              checkIn(gx.id, total);
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
          <div className="mb-[14px] mt-0.5 text-[13px] text-faint">Opdracht voor {gx.name}</div>
          <div className="mb-[18px] w-full rounded-[14px] border border-line bg-elev p-[14px] text-left text-[15.5px] leading-[1.45] text-text">{gx.note}</div>
          <Btn
            full
            kind="primary"
            icon="check2"
            onClick={() => {
              ackTask(gx.id, true);
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
interface AddedGuest {
  name: string;
  plus: number;
  tier: Tier;
  id: number;
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

/** A mock-`ParsedGuest`-shaped view the QuickAdd/Bulk JSX already renders. The
 *  live parser produces a richer result; this keeps the screen JSX untouched. */
interface ParsedView {
  name: string;
  plus: number;
  tier: Tier;
  unknown: string[];
  ambiguous: boolean;
}

/** Mock parser result → the uniform ParsedView (used before an event is wired). */
function mockToView(p: ReturnType<typeof parseQuickAdd>): ParsedView | null {
  if (!p) return null;
  return { name: p.name, plus: p.plus, tier: p.tier, unknown: p.unknown, ambiguous: p.ambiguous };
}

/** Sentinel resolveTier value for the "Hoort bij de naam" choice (#33). */
const NAME_CHOICE = '__name__';

export function QuickAdd({ eventId }: { eventId?: string }): JSX.Element {
  const nav = useNav();
  const { events: liveEvents } = usePoEvents();
  const upcoming = (liveEvents.length ? liveEvents : events).filter((e) => e.when === 'upcoming');
  const [val, setVal] = useState('');
  const [added, setAdded] = useState<AddedGuest[]>([]);
  const [resolveTier, setResolveTier] = useState<string | null>(null);
  const initialEv = (eventId && upcoming.find((e) => e.id === eventId)) || upcoming[0];
  const [curEv, setCurEv] = useState<PoEvent | undefined>(initialEv);
  const [evPick, setEvPick] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const evId = curEv?.id;
  const { tiers: liveTiers } = useEventTiers(evId);
  const { quota } = useEventQuota(evId);
  const { add } = useGuestMutations(evId);

  // Default tier for a bare name / the "Hoort bij de naam" chip (#33).
  const defaultTierId = useMemo(
    () => resolveDefaultTierId(liveTiers.map((t) => ({ id: t.id, name: t.name, aliases: t.aliases }))),
    [liveTiers],
  );

  // Live parse, adapted to the shape the JSX expects. Falls back to the mock
  // parser only when no event/tiers are resolvable yet (graceful pre-wire).
  const live = useMemo<{ view: ParsedView; result: ParseResult } | null>(() => {
    if (!val || !defaultTierId || liveTiers.length === 0) return null;
    const result = parseQuickAddLive(
      val,
      liveTiers.map((t) => ({ id: t.id, name: t.name, aliases: t.aliases })),
      defaultTierId,
    );
    const chosenId = resolveTier ?? result.tierId ?? defaultTierId;
    const tier = liveTiers.find((t) => t.id === chosenId) ?? liveTiers.find((t) => t.id === defaultTierId) ?? liveTiers[0];
    return {
      result,
      view: {
        name: result.name,
        plus: result.plusOnes,
        tier,
        unknown: result.ambiguous ? result.ambiguous.text.split(/\s+/).filter(Boolean) : [],
        ambiguous: result.status === 'ambiguous',
      },
    };
  }, [val, liveTiers, defaultTierId, resolveTier]);

  const parsed: ParsedView | null = live ? live.view : val ? mockToView(parseQuickAdd(val)) : null;
  const usedSlots = added.reduce((a, g) => a + 1 + g.plus, 0);
  // Live: the quota engine is the source of truth (`remaining` already reflects
  // guests added this session after each invalidate); exempt = no limit. Mock: 5.
  const quotaTotal = quota ? quota.quota : 5;
  const quotaLeft = quota?.exempt
    ? Number.POSITIVE_INFINITY
    : quota
      ? quota.remaining
      : 5 - usedSlots;
  const effTier = parsed?.tier;
  const cost = parsed ? 1 + parsed.plus : 0;
  const needsAsk = !!(parsed && parsed.ambiguous && !resolveTier);

  useEffect(() => {
    setResolveTier(null);
    setErr(null);
  }, [val]);

  const commit = (): void => {
    if (!parsed || cost > quotaLeft || !effTier || busy) return;
    // Live path: persist through the server action (RLS + quota engine).
    if (evId && live) {
      // NAME_CHOICE folds the unknown words back into the name (#33); a real
      // tierId picks that tier and drops the words.
      const choice =
        resolveTier === NAME_CHOICE
          ? ({ kind: 'name' } as const)
          : resolveTier
            ? ({ kind: 'tier', tierId: resolveTier } as const)
            : null;
      const resolved = choice
        ? resolveAmbiguity(live.result, choice, defaultTierId ?? effTier.id)
        : { name: parsed.name, plusOnes: parsed.plus, tierId: effTier.id };
      const snapshot: AddedGuest = { name: resolved.name, plus: resolved.plusOnes, tier: effTier, id: Date.now() };
      setBusy(true);
      setErr(null);
      void add({ eventId: evId, tierId: resolved.tierId, fullName: resolved.name, plusOnes: resolved.plusOnes, source: 'app' }).then((res) => {
        setBusy(false);
        if (!res.ok) {
          setErr(res.message);
          return;
        }
        setAdded((a) => [snapshot, ...a]);
        setVal('');
        setResolveTier(null);
      });
      return;
    }
    // Mock fallback (no event wired yet): local-only preview.
    setAdded((a) => [{ name: parsed.name, plus: parsed.plus, tier: effTier, id: Date.now() }, ...a]);
    setVal('');
    setResolveTier(null);
  };

  // Ambiguity chips: live suggestions (or the two mock chips before wiring).
  const askTiers: Tier[] = live
    ? (live.result.ambiguous?.suggestions ?? [])
        .map((s) => liveTiers.find((t) => t.id === s.tierId))
        .filter((t): t is Tier => Boolean(t))
    : tiers.filter((t) => t.id === 'vip' || t.id === 'regular');

  return (
    <div className={col}>
      <Top onBack={nav.back} title="Gast toevoegen" sub={Number.isFinite(quotaLeft) ? `jouw quotum ${Math.max(0, quotaLeft)} van ${quotaTotal} over` : 'geen quotumlimiet'} right={<IconBtn name="paste" onClick={() => nav.push('bulk', evId ? { id: evId } : undefined)} />} />
      <Scroll bottom={120}>
        <Label className="mb-2">Evenement</Label>
        <button type="button" onClick={() => setEvPick(true)} className={cn('mb-4 flex w-full items-center gap-[13px] rounded-[14px] border border-line bg-elev px-[14px] py-[13px] text-left', press)}>
          <span className="w-[40px] shrink-0 text-center">
            <span className={cn('block font-display text-[18px] font-extrabold leading-none', curEv?.accent ? 'text-acc' : 'text-text')}>{curEv?.date ?? '—'}</span>
            <span className="mt-0.5 block text-[9.5px] font-bold tracking-[0.05em] text-faint">{curEv?.mon ?? ''}</span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-[15.5px] font-bold text-text">{curEv?.name ?? 'Kies evenement'}</span>
            <span className="mt-px block text-[12.5px] text-faint">
              {curEv ? `deur ${curEv.time} · ${curEv.venue}` : 'tik om te kiezen'}
            </span>
          </span>
          <span className="text-acc">
            <Icon name="chevD" size={18} />
          </span>
        </button>
        <Label className="mb-2">Typ vrij — naam, +gasten, tier</Label>
        <div className={cn('rounded-[16px] border bg-elev px-[15px] py-[14px] transition-colors', parsed ? 'border-acc' : 'border-line')}>
          <input
            autoFocus
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !needsAsk) commit();
            }}
            placeholder={'bv. "Juri Braakman +2 vip"'}
            className="w-full border-none bg-transparent font-display text-[18px] font-bold tracking-[-0.01em] text-text outline-none placeholder:text-faint"
          />
          {parsed && (
            <div className="mt-[13px] flex flex-wrap gap-[7px]">
              <PreviewChip icon="user" label={parsed.name || '—'} />
              {parsed.plus > 0 && <PreviewChip icon="users" label={`+${parsed.plus}`} />}
              {!needsAsk && effTier && <PreviewChip dot={effTier.color} label={effTier.short} />}
              {needsAsk && parsed.unknown.map((w) => <MiniChip key={w} className="border-dashed border-acc text-text">“{w}” ?</MiniChip>)}
            </div>
          )}
        </div>

        {needsAsk && parsed && (
          <div className="mt-3 rounded-[16px] bg-acc-dim p-[14px]">
            <div className="mb-[11px] text-[13.5px] leading-[1.45] text-text">
              <b>“{parsed.unknown.join(' ')}”</b> herken ik niet. Wat bedoel je?
            </div>
            <div className="flex flex-col gap-2">
              {askTiers.map((t) => (
                <button key={t.id} type="button" onClick={() => setResolveTier(t.id)} className={cn('flex items-center gap-[10px] rounded-[12px] border border-line bg-bg px-[13px] py-[12px] text-text', press)}>
                  <span className="h-[10px] w-[10px] rounded-full" style={{ background: t.color }} />
                  <span className="flex-1 text-left font-display text-[14.5px] font-bold">{t.short}</span>
                  <Icon name="chev" size={16} className="text-ghost" />
                </button>
              ))}
              <button type="button" onClick={() => setResolveTier(NAME_CHOICE)} className={cn('flex items-center gap-[10px] rounded-[12px] border border-line bg-bg px-[13px] py-[12px] text-text', press)}>
                <Icon name="user" size={15} className="text-faint" />
                <span className="flex-1 text-left font-display text-[14.5px] font-bold">Hoort bij de naam</span>
                <Icon name="chev" size={16} className="text-ghost" />
              </button>
            </div>
          </div>
        )}

        {parsed && !needsAsk && (
          <div className={cn('mt-3 flex items-center gap-[9px] rounded-[13px] px-[14px] py-[11px]', cost > quotaLeft ? 'border border-acc bg-white/[0.04]' : 'border border-line bg-elev')}>
            <Icon name="ticket" size={17} stroke={cost > quotaLeft ? '#B5A6FF' : 'rgba(255,255,255,0.40)'} />
            <span className="flex-1 text-[13.5px] text-text">
              Kost <b>{cost}</b> {cost === 1 ? 'plek' : 'plekken'}
              {Number.isFinite(quotaLeft) && ` · ${Math.max(0, quotaLeft - cost)} over na toevoegen`}
            </span>
            {cost > quotaLeft && <MiniChip className="border-acc text-acc">Quotum vol</MiniChip>}
          </div>
        )}

        {cost > quotaLeft && parsed && !needsAsk && (
          <Btn kind="ghost" full icon="plus" className="mt-[10px]" onClick={() => nav.push('aanvragen')}>
            Extra plekken aanvragen
          </Btn>
        )}

        {added.length > 0 && (
          <>
            <Label className="mx-0.5 mb-[10px] mt-[22px]">Net toegevoegd · {added.length}</Label>
            <div className="flex flex-col gap-2">
              {added.map((g) => (
                <div key={g.id} className="flex items-center gap-[11px] rounded-[14px] border border-line bg-elev p-[11px]">
                  <Avatar name={g.name} size={36} accent={g.tier.id === 'vip'} />
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-[14.5px] font-bold text-text">
                      {g.name}
                      {g.plus > 0 && <span className="text-faint"> +{g.plus}</span>}
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-faint">{g.tier.short}</div>
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

        {err && <p className="mt-3 text-[13px] text-acc-soft">{err}</p>}
      </Scroll>
      <BottomBar>
        <Btn kind="primary" full icon="plus" onClick={commit} className={parsed && !needsAsk && cost <= quotaLeft && !busy ? '' : 'opacity-[0.45]'}>
          {busy ? 'Bezig…' : parsed ? `Voeg toe · ${parsed.name || 'gast'}${parsed.plus ? ' +' + parsed.plus : ''}` : 'Typ een naam'}
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
                    setCurEv(e);
                    setEvPick(false);
                  }}
                  className={cn('flex items-center gap-[12px] rounded-[12px] border px-[13px] py-[12px] text-left', on ? 'border-transparent bg-acc-dim' : 'border-line bg-elev', press)}
                >
                  <span className="w-[38px] shrink-0 text-center">
                    <span className={cn('block font-display text-[16px] font-extrabold leading-none', e.accent ? 'text-acc' : 'text-text')}>{e.date}</span>
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
/** Uniform per-line view the bulk JSX renders, plus the resolved tierId so a
 *  confirmed/ready row can be submitted. */
interface BulkView {
  id: string;
  name: string;
  plus: number;
  tier: Tier;
  /** tierId the parser resolved to (default when ambiguous & unconfirmed). */
  tierId: string;
  unknown: string[];
  ambiguous: boolean;
}

export function BulkPaste({ eventId }: { eventId?: string }): JSX.Element {
  const nav = useNav();
  const { tiers: liveTiers } = useEventTiers(eventId);
  const { addBulk } = useGuestMutations(eventId);
  const sample = 'Juri Braakman +2 vip\nNoor de Wit\nSem Aaltink fles\nDJ Pelican artist\nFemke Bakker goldlounge\nLucas van Os +1';
  const [text, setText] = useState(sample);
  const [confirmed, setConfirmed] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const defaultTierId = useMemo(
    () => resolveDefaultTierId(liveTiers.map((t) => ({ id: t.id, name: t.name, aliases: t.aliases }))),
    [liveTiers],
  );
  const live = Boolean(eventId && liveTiers.length && defaultTierId);

  // Live: parse each line with the deterministic parser against the event's
  // tiers. Mock: the prototype parser (graceful fallback before wiring).
  const rows = useMemo<BulkView[]>(() => {
    if (live && defaultTierId) {
      const qaTiers = liveTiers.map((t) => ({ id: t.id, name: t.name, aliases: t.aliases }));
      return parseBulkLive(text, qaTiers, defaultTierId).map((r, i): BulkView => {
        const tierId = r.tierId ?? defaultTierId;
        const tier = liveTiers.find((t) => t.id === tierId) ?? liveTiers[0];
        return {
          id: 'bulk' + i,
          name: r.name,
          plus: r.plusOnes,
          tier,
          tierId,
          unknown: r.ambiguous ? r.ambiguous.text.split(/\s+/).filter(Boolean) : [],
          ambiguous: r.status === 'ambiguous',
        };
      });
    }
    return parseBulk(text).map((r): BulkView => ({
      id: r.id,
      name: r.name,
      plus: r.plus,
      tier: r.tier,
      tierId: r.tier.id,
      unknown: r.unknown,
      ambiguous: r.ambiguous,
    }));
  }, [text, live, liveTiers, defaultTierId]);

  const doubtful = rows.filter((r) => r.ambiguous && !confirmed[r.id]);
  const ready = rows.length - doubtful.length;

  // The chips the JSX offers for an ambiguous line (live tiers, or mock pair).
  const askTiers: Tier[] = live ? liveTiers : tiers.filter((t) => t.id === 'vip' || t.id === 'regular');

  const submit = (): void => {
    if (ready <= 0 || busy) return;
    if (live && eventId && defaultTierId) {
      // Only the resolved lines go in; ambiguous-unconfirmed are left behind (#33).
      const payload = rows
        .filter((r) => !(r.ambiguous && !confirmed[r.id]) && r.name.trim().length > 0)
        .map((r) => ({ tierId: confirmed[r.id] ?? r.tierId ?? defaultTierId, fullName: r.name, plusOnes: r.plus }));
      if (payload.length === 0) return;
      setBusy(true);
      setErr(null);
      void addBulk({ eventId, guests: payload, source: 'app' }).then((res) => {
        setBusy(false);
        if (!res.ok) {
          setErr(res.message);
          return;
        }
        nav.back();
      });
      return;
    }
    nav.back(); // mock fallback
  };

  return (
    <div className={col}>
      <Top onBack={nav.back} title="Plak een lijst" sub="Eén gast per regel — uit WhatsApp, mail of Notes" />
      <Scroll bottom={120}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          className="mb-4 w-full resize-y rounded-[14px] border border-line bg-elev p-[14px] font-body text-[14.5px] leading-[1.5] text-text outline-none"
        />
        <div className="mb-[10px] flex items-center justify-between">
          <Label>Preview · {rows.length} regels</Label>
          {doubtful.length > 0 && <MiniChip className="border-acc text-acc">{doubtful.length} te controleren</MiniChip>}
        </div>
        <div className="flex flex-col gap-2">
          {rows.map((r) => {
            const ask = r.ambiguous && !confirmed[r.id];
            const tier = confirmed[r.id] ? liveTiers.find((t) => t.id === confirmed[r.id]) ?? tiers.find((t) => t.id === confirmed[r.id]) ?? r.tier : r.tier;
            return (
              <div key={r.id} className={cn('rounded-[14px] border bg-elev p-[12px]', ask ? 'border-acc' : 'border-line')}>
                <div className="flex items-center gap-[11px]">
                  <Avatar name={r.name} size={34} accent={tier.role === 'VIP'} />
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-[14.5px] font-bold text-text">
                      {r.name}
                      {r.plus > 0 && <span className="text-faint"> +{r.plus}</span>}
                    </div>
                    <div className={cn('mt-0.5 text-[11.5px]', ask ? 'text-acc' : 'text-faint')}>{ask ? `“${r.unknown.join(' ')}” onbekend` : tier.short}</div>
                  </div>
                  {!ask && (
                    <span className="text-acc">
                      <Icon name="check2" size={17} stroke="#B5A6FF" sw={2.2} />
                    </span>
                  )}
                </div>
                {ask && (
                  <div className="mt-[11px] flex flex-wrap gap-[7px]">
                    {askTiers.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setConfirmed((c) => ({ ...c, [r.id]: t.id }))}
                        className={cn('flex-1 rounded-[10px] border border-line bg-elev2 py-[9px] font-display text-[12.5px] font-bold text-text', press)}
                      >
                        {t.short}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {err && <p className="mt-3 text-[13px] text-acc-soft">{err}</p>}
      </Scroll>
      <BottomBar>
        <Btn kind="primary" full icon="check" onClick={submit} className={ready > 0 && !busy ? '' : 'opacity-[0.45]'}>
          {busy ? 'Bezig…' : doubtful.length > 0 ? `Voeg ${ready} toe · ${doubtful.length} open` : `Voeg ${ready} gasten toe`}
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
