'use client';

/**
 * Aanvragen (S5) — the approval inbox, wired live (STAP 3.6).
 *
 * VENUE-WIDE by default ("Alle events"), with a dropdown to pick one event and a
 * name search to find someone fast. Two queues: landing-page guest requests
 * (#12/#31 → approve/denyGuestRequest) and quota requests (#5 → decideQuotaRequest).
 * Refused landing requests stay visible under "Afgewezen" and can still be added
 * after all ("Alsnog toevoegen" → re-approve, #12).
 *
 * Reads + writes go through the user-scoped client, so RLS is the boundary: a
 * role that may not decide sees empty queues. Each request carries its own event,
 * so an approval targets that event's tiers and the right invalidation. Landing
 * approvals fall OUTSIDE the approver's personal quota (#31) but still count
 * toward tier-max. No payment / "notify the guest" copy — no ticketing/mail (#10).
 */
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  usePoEvents,
  usePoGuestRequests,
  usePoQuotaRequests,
  usePoTiers,
} from '@/features/po/hooks';
import { usePoApproveRequest, usePoDecideQuota, usePoDenyRequest } from '@/features/po/mutations';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import type { PoGuestRequest, PoQuotaRequest } from '@/features/po/adapters';
import type { Tier } from '@/lib/po/types';
import { useNav } from '../context';
import { Icon } from '../icon';
import { Avatar, Btn, Empty, Label, Note, Top } from '../kit';
import { Sheet } from '../shell';

const press = 'transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]';
const col = 'flex h-full flex-col';

type Tab = 'landing' | 'quota';
type DenyTarget = { kind: 'landing' | 'quota'; id: string; name: string; eventId: string };

function ErrLine({ msg }: { msg: string }): JSX.Element {
  return <div className="mb-3 text-[13px] font-semibold text-[#E89AC0]">{msg}</div>;
}

/** Small event tag shown on each card in "Alle events" mode. */
function EventTag({ name }: { name: string }): JSX.Element {
  return (
    <div className="mb-[8px] flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.04em] text-faint">
      <Icon name="cal" size={11} stroke="rgba(255,255,255,0.40)" />
      <span className="truncate">{name}</span>
    </div>
  );
}

export function Aanvragen({ eventId }: { eventId?: string }): JSX.Element {
  const nav = useNav();
  const { venueId } = usePoIdentity();
  const eventsQuery = usePoEvents();
  const events = eventsQuery.data ?? [];
  const gReqs = usePoGuestRequests();
  const qReqs = usePoQuotaRequests();

  const [sel, setSel] = useState<string>(eventId ?? ''); // '' = Alle events
  const [tab, setTab] = useState<Tab>('landing');
  const [search, setSearch] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showDenied, setShowDenied] = useState(false);
  const [assign, setAssign] = useState<PoGuestRequest | null>(null);
  const [deny, setDeny] = useState<DenyTarget | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const tiersQuery = usePoTiers(assign?.eventId ?? '');
  const approve = usePoApproveRequest();
  const denyReq = usePoDenyRequest();
  const decideQuota = usePoDecideQuota();

  const allG = gReqs.data ?? [];
  const allQ = qReqs.data ?? [];
  const nameById = new Map(events.map((e) => [e.id, e.name]));

  const q = search.trim().toLowerCase();
  const matches = (name: string): boolean => !q || name.toLowerCase().includes(q);

  // scope (event) → search filter
  const scopeG = (sel ? allG.filter((r) => r.eventId === sel) : allG).filter((r) => matches(r.name));
  const scopeQ = (sel ? allQ.filter((r) => r.eventId === sel) : allQ).filter((r) => matches(r.who));
  const pendingG = scopeG.filter((r) => r.status === 'pending');
  const deniedG = scopeG.filter((r) => r.status === 'denied');
  const openG = pendingG.length;
  const openQ = scopeQ.length;
  const showAllEvents = !sel;

  // Event picker list: every event with a request (open or refused) + the
  // selected one, with a per-event "open" count (pending landing + quota).
  const reqEventIds = new Set<string>([...allG, ...allQ].map((r) => r.eventId));
  if (sel) reqEventIds.add(sel);
  const pickerEvents = events.filter((e) => reqEventIds.has(e.id));
  const openByEvent = new Map<string, number>();
  for (const r of allG) if (r.status === 'pending') openByEvent.set(r.eventId, (openByEvent.get(r.eventId) ?? 0) + 1);
  for (const r of allQ) openByEvent.set(r.eventId, (openByEvent.get(r.eventId) ?? 0) + 1);
  const totalOpen = [...openByEvent.values()].reduce((a, b) => a + b, 0);

  const landingBusy = approve.isPending || denyReq.isPending;
  const quotaBusy = decideQuota.isPending;
  const loading = eventsQuery.isLoading || gReqs.isLoading || qReqs.isLoading;
  const isError = eventsQuery.isError || gReqs.isError || qReqs.isError;

  const pickScope = (id: string): void => {
    setSel(id);
    setPickerOpen(false);
    setShowDenied(false);
    setErr(null);
  };
  const switchTab = (t: Tab): void => {
    setTab(t);
    setErr(null);
  };
  const openDeny = (target: DenyTarget): void => {
    setErr(null);
    setDeny(target);
  };
  const openAssign = (req: PoGuestRequest): void => {
    setErr(null);
    setAssign(req);
  };
  const createTierFor = (eid: string): void => {
    setAssign(null);
    nav.push('tiers', { id: eid });
  };

  const confirmApproveLanding = async (tierId: string): Promise<void> => {
    if (!assign) return;
    setErr(null);
    try {
      await approve.mutateAsync({ requestId: assign.id, tierId, eventId: assign.eventId });
      setAssign(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Goedkeuren is mislukt.');
    }
  };

  const confirmDeny = async (reason: string): Promise<void> => {
    if (!deny) return;
    setErr(null);
    try {
      if (deny.kind === 'landing') {
        await denyReq.mutateAsync({ requestId: deny.id, reason, eventId: deny.eventId });
      } else {
        await decideQuota.mutateAsync({ requestId: deny.id, decision: 'denied', reason, eventId: deny.eventId });
      }
      setDeny(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Afwijzen is mislukt.');
    }
  };

  const approveQuota = async (req: PoQuotaRequest): Promise<void> => {
    setErr(null);
    try {
      await decideQuota.mutateAsync({ requestId: req.id, decision: 'approved', eventId: req.eventId });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Goedkeuren is mislukt. Vereist mogelijk MFA.');
    }
  };

  if (!venueId) {
    return (
      <div className={col}>
        <Top onBack={nav.back} title="Aanvragen" />
        <div className="po-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-[28px]">
          <Empty text="Geen actieve venue geselecteerd." />
        </div>
      </div>
    );
  }

  const scopeLabel = sel ? nameById.get(sel) ?? 'Event' : 'Alle events';
  const scopeCount = sel ? openByEvent.get(sel) ?? 0 : totalOpen;

  return (
    <div className={col}>
      <Top onBack={nav.back} title="Aanvragen" sub={scopeLabel} />

      {/* Event dropdown */}
      <div className="flex-none px-5 pb-[10px]">
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="flex w-full items-center gap-[10px] rounded-[14px] border border-line bg-elev px-[14px] py-[12px] text-left transition-colors hover:bg-white/[0.03]"
        >
          <Icon name="cal" size={18} className="text-acc" />
          <span className="min-w-0 flex-1 truncate font-display text-[14.5px] font-bold text-text">{scopeLabel}</span>
          {scopeCount > 0 && (
            <span className="inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-acc-dim px-[6px] text-[11px] font-extrabold text-acc">{scopeCount}</span>
          )}
          <Icon name="chevD" size={16} className="text-ghost" />
        </button>
      </div>

      {/* Name search */}
      <div className="flex-none px-5 pb-[12px]">
        <div className="flex items-center gap-[11px] rounded-field border border-line bg-elev px-[15px] py-[11px]">
          <Icon name="search" size={18} className="text-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Zoek op naam…"
            aria-label="Zoek op naam"
            className="min-w-0 flex-1 border-none bg-transparent font-body text-[15px] text-text outline-none placeholder:text-faint"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} aria-label="Wis zoekopdracht" className={cn('shrink-0 text-faint', press)}>
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-none gap-1.5 px-5 pb-[14px]">
        {([['landing', 'Landingpage', openG], ['quota', 'Quotum', openQ]] as const).map(([k, l, n]) => (
          <button
            key={k}
            type="button"
            onClick={() => switchTab(k)}
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
        {err && !assign && !deny && <ErrLine msg={err} />}

        {loading ? (
          <Empty text="Aanvragen laden…" />
        ) : isError ? (
          <Empty text="Kon de aanvragen niet laden. Probeer het later opnieuw." />
        ) : tab === 'landing' ? (
          <div className="flex flex-col gap-[11px]">
            <Note icon="user">
              Landingpage-aanvragen vallen <b>buiten</b> je eigen quotum (#31) — goedkeuren kost jou geen plek, maar telt wel mee in de tier-max.
            </Note>
            {openG === 0 ? (
              <Empty text={q ? `Geen open aanvragen voor “${search.trim()}”.` : 'Geen open aanvragen 🎉'} />
            ) : (
              <div className="flex flex-col gap-[11px] lg:grid lg:grid-cols-2 lg:gap-[11px] lg:items-start">
              {pendingG.map((r) => (
                <div
                  key={r.id}
                  className="rounded-[18px] border border-line bg-elev p-[15px]"
                  style={{ borderColor: r.flag ? 'rgba(181,166,255,0.4)' : undefined }}
                >
                  {showAllEvents && <EventTag name={nameById.get(r.eventId) ?? 'Event'} />}
                  <div className={cn('flex items-center gap-[11px]', r.motivation || r.flag ? 'mb-[11px]' : 'mb-[13px]')}>
                    <Avatar name={r.name} size={40} />
                    <div className="min-w-0 flex-1">
                      <div className="font-display text-[15.5px] font-bold text-text">
                        {r.name}
                        {r.plus > 0 && <span className="text-faint"> +{r.plus}</span>}
                      </div>
                      <div className="truncate text-[12px] text-faint">
                        {r.phoneLast4 && <>tel. •••• {r.phoneLast4} · </>}via landingpage · {r.at}
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
                  <div className="flex gap-2">
                    <Btn sm kind="dark" full icon="close" disabled={landingBusy} onClick={() => openDeny({ kind: 'landing', id: r.id, name: r.name, eventId: r.eventId })}>
                      Afwijzen
                    </Btn>
                    <Btn sm kind="primary" full icon="check2" disabled={landingBusy} onClick={() => openAssign(r)}>
                      Toevoegen…
                    </Btn>
                  </div>
                </div>
              ))}
              </div>
            )}

            {deniedG.length > 0 && (
              <div className="mt-1">
                <button
                  type="button"
                  onClick={() => setShowDenied((s) => !s)}
                  className="mb-[10px] flex w-full items-center justify-between rounded-[12px] px-1 py-1.5 text-left"
                >
                  <Label>Afgewezen · {deniedG.length}</Label>
                  <Icon name="chevD" size={16} className={cn('text-ghost transition-transform', showDenied && 'rotate-180')} />
                </button>
                {showDenied && (
                  <div className="flex flex-col gap-[11px] lg:grid lg:grid-cols-2 lg:gap-[11px] lg:items-start">
                    {deniedG.map((r) => (
                      <div key={r.id} className="rounded-[18px] border border-line bg-elev p-[15px]">
                        {showAllEvents && <EventTag name={nameById.get(r.eventId) ?? 'Event'} />}
                        <div className="mb-[9px] flex items-center gap-[11px]">
                          <Avatar name={r.name} size={38} />
                          <div className="min-w-0 flex-1">
                            <div className="font-display text-[15px] font-bold text-dim">
                              {r.name}
                              {r.plus > 0 && <span className="text-faint"> +{r.plus}</span>}
                            </div>
                            <div className="truncate text-[12px] text-faint">{r.phoneLast4 && <>tel. •••• {r.phoneLast4} · </>}{r.at}</div>
                          </div>
                        </div>
                        <div className="mb-[12px] flex items-start gap-[7px] rounded-[9px] bg-elev2 px-[11px] py-[8px] text-[12.5px] leading-[1.4] text-faint">
                          <Icon name="close" size={13} stroke="rgba(255,255,255,0.40)" className="mt-px shrink-0" />
                          <span>Afgewezen{r.denyReason ? <> — “{r.denyReason}”</> : ''}</span>
                        </div>
                        <Btn sm kind="primary" full icon="check2" disabled={landingBusy} onClick={() => openAssign(r)}>
                          Alsnog toevoegen
                        </Btn>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-[11px]">
            {openQ === 0 ? (
              <Empty text={q ? `Geen verzoeken voor “${search.trim()}”.` : 'Geen open quotum-verzoeken.'} />
            ) : (
              <div className="flex flex-col gap-[11px] lg:grid lg:grid-cols-2 lg:gap-[11px] lg:items-start">
              {scopeQ.map((r) => (
                <div key={r.id} className="rounded-[18px] border border-line bg-elev p-[15px]">
                  {showAllEvents && <EventTag name={nameById.get(r.eventId) ?? 'Event'} />}
                  <div className="mb-[11px] flex items-center gap-[11px]">
                    <Avatar name={r.who} size={40} />
                    <div className="min-w-0 flex-1">
                      <div className="font-display text-[15.5px] font-bold text-text">{r.who}</div>
                      <div className="text-[12px] text-faint">{r.at}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-display text-[18px] font-extrabold text-acc">+{r.extra}</div>
                      <div className="text-[10.5px] text-faint">{r.extra === 1 ? 'plek' : 'plekken'}</div>
                    </div>
                  </div>
                  {r.reason && <div className="mb-[13px] pl-0.5 text-[13.5px] leading-[1.45] text-dim">“{r.reason}”</div>}
                  <div className="flex gap-2">
                    <Btn sm kind="dark" full icon="close" disabled={quotaBusy} onClick={() => openDeny({ kind: 'quota', id: r.id, name: r.who, eventId: r.eventId })}>
                      Afwijzen
                    </Btn>
                    <Btn sm kind="primary" full icon="check2" disabled={quotaBusy} onClick={() => void approveQuota(r)}>
                      Keur +{r.extra} goed
                    </Btn>
                  </div>
                </div>
              ))}
              </div>
            )}
          </div>
        )}
      </div>

      {pickerOpen && (
        <EventPickerSheet
          events={pickerEvents}
          counts={openByEvent}
          total={totalOpen}
          sel={sel}
          onPick={pickScope}
          onClose={() => setPickerOpen(false)}
        />
      )}
      {assign && (
        <AssignSheet
          req={assign}
          eventName={nameById.get(assign.eventId) ?? ''}
          tiers={tiersQuery.data ?? []}
          tiersLoading={tiersQuery.isLoading}
          pending={approve.isPending}
          error={err}
          onClose={() => {
            setAssign(null);
            setErr(null);
          }}
          onConfirm={(tierId) => void confirmApproveLanding(tierId)}
          onCreateTier={() => createTierFor(assign.eventId)}
        />
      )}
      {deny && (
        <DenySheet
          target={deny}
          pending={deny.kind === 'landing' ? denyReq.isPending : decideQuota.isPending}
          error={err}
          onClose={() => {
            setDeny(null);
            setErr(null);
          }}
          onConfirm={(reason) => void confirmDeny(reason)}
        />
      )}
    </div>
  );
}

function EventPickerSheet({
  events,
  counts,
  total,
  sel,
  onPick,
  onClose,
}: {
  events: { id: string; name: string }[];
  counts: Map<string, number>;
  total: number;
  sel: string;
  onPick: (id: string) => void;
  onClose: () => void;
}): JSX.Element {
  const row = (id: string, label: string, count: number, active: boolean): JSX.Element => (
    <button
      key={id || 'all'}
      type="button"
      onClick={() => onPick(id)}
      className={cn('flex items-center gap-[11px] rounded-[12px] border px-[13px] py-[12px] text-left', active ? 'border-transparent bg-acc-dim' : 'border-line bg-elev', press)}
    >
      <span className="min-w-0 flex-1 truncate font-display text-[14.5px] font-bold text-text">{label}</span>
      {count > 0 && (
        <span className="inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-acc-dim px-[6px] text-[11px] font-extrabold text-acc">{count}</span>
      )}
      <span className={cn('flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full border-2', active ? 'border-acc bg-acc' : 'border-ghost bg-transparent')}>
        {active && <Icon name="check" size={12} stroke="#16132B" sw={3} />}
      </span>
    </button>
  );
  return (
    <Sheet onClose={onClose} center={false}>
      <div className="mb-[14px] font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">Kies event</div>
      <div className="flex flex-col gap-[7px]">
        {row('', 'Alle events', total, sel === '')}
        {events.map((e) => row(e.id, e.name, counts.get(e.id) ?? 0, sel === e.id))}
      </div>
      <button type="button" onClick={onClose} className={cn('mt-4 cursor-pointer self-center border-none bg-transparent font-body text-[13.5px] font-semibold text-faint', press)}>
        Sluiten
      </button>
    </Sheet>
  );
}

function AssignSheet({
  req,
  eventName,
  tiers,
  tiersLoading,
  pending,
  error,
  onClose,
  onConfirm,
  onCreateTier,
}: {
  req: PoGuestRequest;
  eventName: string;
  tiers: Tier[];
  tiersLoading: boolean;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (tierId: string) => void;
  onCreateTier: () => void;
}): JSX.Element {
  const [tierId, setTierId] = useState('');
  // Default to the first tier once they load (the event's tiers fetch on open).
  useEffect(() => {
    if (tierId === '' && tiers.length > 0) setTierId(tiers[0].id);
  }, [tiers, tierId]);

  const tier = tiers.find((t) => t.id === tierId);
  const heads = 1 + req.plus;
  const noTiers = !tiersLoading && tiers.length === 0;
  return (
    <Sheet onClose={onClose} center={false}>
      <div className="mb-4 flex items-center gap-[12px]">
        <Avatar name={req.name} size={44} />
        <div className="min-w-0 flex-1">
          <div className="font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">
            {req.name}
            {req.plus > 0 && <span className="text-faint"> +{req.plus}</span>}
          </div>
          <div className="truncate text-[12.5px] text-faint">
            {eventName ? `${eventName} · ` : ''}
            {heads} {heads === 1 ? 'persoon' : 'personen'}
          </div>
        </div>
      </div>
      <Label className="mb-[10px]">Op welke tier komt deze gast?</Label>
      {tiersLoading ? (
        <div className="mb-[14px] py-[18px] text-center text-[13px] text-faint">Tiers laden…</div>
      ) : noTiers ? (
        <div className="mb-[14px]">
          <Note icon="ticket">Dit event heeft nog geen tiers. Maak er één aan zodat we de gast op de juiste plek kunnen zetten.</Note>
          <Btn kind="primary" full icon="plus" onClick={onCreateTier}>
            Tier aanmaken
          </Btn>
        </div>
      ) : (
        <div className="mb-[14px] flex flex-col gap-[7px]">
          {tiers.map((t) => {
            const on = t.id === tierId;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTierId(t.id)}
                className={cn('flex items-center gap-[11px] rounded-[12px] border px-[13px] py-[12px] text-left', on ? 'border-transparent bg-acc-dim' : 'border-line bg-elev', press)}
              >
                <span className="h-[12px] w-[12px] shrink-0 rounded-full" style={{ background: t.color }} />
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-[14.5px] font-bold text-text">{t.short}</span>
                  <span className="block text-[11.5px] text-faint">{t.max != null ? `${t.used}/${t.max} bezet` : 'Geen maximum'}</span>
                </span>
                <span className={cn('flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full border-2', on ? 'border-acc bg-acc' : 'border-ghost bg-transparent')}>
                  {on && <Icon name="check" size={12} stroke="#16132B" sw={3} />}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {!noTiers && !tiersLoading && (
        <div className="mb-4 flex items-center gap-[10px] rounded-[13px] bg-acc-dim px-[14px] py-[13px]">
          <Icon name="check2" size={18} stroke="#B5A6FF" sw={2.4} />
          <span className="text-[13.5px] leading-[1.4] text-text">
            {heads} {heads === 1 ? 'persoon komt' : 'personen komen'} op de lijst{tier && <> onder <b>{tier.short}</b></>}.
          </span>
        </div>
      )}
      {error && <ErrLine msg={error} />}
      {!noTiers && (
        <Btn kind="primary" full icon="check" disabled={pending || tiersLoading || !tierId} onClick={() => onConfirm(tierId)} className={pending || tiersLoading || !tierId ? 'opacity-50' : ''}>
          {pending ? 'Bezig…' : 'Toevoegen aan lijst'}
        </Btn>
      )}
      <button type="button" onClick={onClose} className={cn('mt-3 cursor-pointer self-center border-none bg-transparent font-body text-[13.5px] font-semibold text-faint', press)}>
        Annuleren
      </button>
    </Sheet>
  );
}

function DenySheet({
  target,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  target: DenyTarget;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}): JSX.Element {
  const [reason, setReason] = useState('');
  const trimmed = reason.trim();
  return (
    <Sheet onClose={onClose} center={false}>
      <div className="mb-1 font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">Afwijzen</div>
      <div className="mb-4 text-[13px] text-faint">
        {target.kind === 'landing' ? `Aanvraag van ${target.name}` : `Quotum-verzoek van ${target.name}`}
      </div>
      <Label className="mb-[10px]">
        Reden <span className="font-normal normal-case text-faint">· verplicht, de aanvrager ziet dit</span>
      </Label>
      <textarea
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
        placeholder="bv. lijst zit vol — geen plek meer voor dit event"
        className="mb-4 min-h-[88px] w-full resize-none rounded-field border border-line bg-elev px-[15px] py-[13px] font-body text-[15px] leading-[1.4] text-text outline-none placeholder:text-faint focus:border-acc"
      />
      {error && <ErrLine msg={error} />}
      <Btn kind="primary" full icon="close" disabled={pending || !trimmed} onClick={() => onConfirm(trimmed)} className={pending || !trimmed ? 'opacity-50' : ''}>
        {pending ? 'Bezig…' : 'Afwijzen bevestigen'}
      </Btn>
      <button type="button" onClick={onClose} className={cn('mt-3 cursor-pointer self-center border-none bg-transparent font-body text-[13.5px] font-semibold text-faint', press)}>
        Annuleren
      </button>
    </Sheet>
  );
}
