'use client';

/** Events tab + event detail, event CRUD, tier/alias beheer, past-event recap. */
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { PoEvent } from '@/lib/po/types';
import {
  usePoEvent,
  usePoEventDetail,
  usePoEventForEdit,
  usePoEventRecap,
  usePoEvents,
  usePoTiers,
} from '@/features/po/hooks';
import {
  usePoChangeStatus,
  usePoCreateEvent,
  usePoCreateTier,
  usePoSetAutoLock,
  usePoSetLandingActive,
  usePoSetListLock,
  usePoUpdateEvent,
  usePoUpdateTier,
} from '@/features/po/mutations';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { allowedTransitions, STATUS_DESCRIPTIONS, STATUS_LABELS, type EventStatus } from '@/features/events/status';
import { isoToLocalInput, localInputToIso } from '@/features/events/datetime';
import { formatClock } from '@/features/stats/format';
import { useNav } from '../context';
import { Icon } from '../icon';
import { Avatar, Btn, Empty, Field, IconBtn, Label, MiniChip, Note, RoleChip, Scroll, ToggleRow, Top } from '../kit';
import { BottomBar } from '../shell';

const cardPress = 'transition-[border-color,transform] hover:border-white/[0.24] active:scale-[0.99]';
const press = 'transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]';
const col = 'flex h-full flex-col';

// ── helpers ───────────────────────────────────────────────────────────────────
function Stat({ v, l, acc, big }: { v: number; l: string; acc?: boolean; big?: boolean }): JSX.Element {
  return (
    <div className="rounded-[18px] border border-line bg-elev p-4">
      <div className={cn('font-display font-extrabold leading-none', big ? 'text-[38px]' : 'text-[28px]', acc ? 'text-acc' : 'text-text')}>{v}</div>
      <div className="mt-1 text-[13px] text-dim">{l}</div>
    </div>
  );
}

/** Full-screen loading / empty / error state with a back header (kit-only). */
function ScreenState({ onBack, title, text }: { onBack: () => void; title: string; text: string }): JSX.Element {
  return (
    <div className={col}>
      <Top onBack={onBack} title={title} />
      <Scroll bottom={28}>
        <Empty text={text} />
      </Scroll>
    </div>
  );
}

// ── EVENTS (tab) ──────────────────────────────────────────────────────────────
export function Events(): JSX.Element {
  const nav = useNav();
  const [when, setWhen] = useState<'upcoming' | 'past'>('upcoming');
  const { data, isLoading, isError } = usePoEvents();
  const evs = (data ?? []).filter((e) => e.when === when);
  const months = [...new Set(evs.map((e) => e.month))];
  return (
    <div className={col}>
      <Top big title="Events" right={<IconBtn name="search" />} />
      <div className="flex flex-none items-center gap-2 px-5 pb-[14px]">
        {([['upcoming', 'Komend'], ['past', 'Geweest']] as const).map(([k, l]) => (
          <button
            key={k}
            type="button"
            onClick={() => setWhen(k)}
            className={cn(
              'cursor-pointer rounded-full border px-4 py-2 font-display text-[13.5px] font-bold transition-[filter] hover:brightness-[1.07]',
              when === k ? 'border-transparent bg-text text-bg' : 'border-line bg-transparent text-dim',
            )}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="flex flex-none gap-2 px-5 pb-[14px]">
        <Btn sm kind="primary" icon="plus" onClick={() => nav.push('quickadd')}>
          Nieuwe gast
        </Btn>
        <Btn sm kind="ghost" icon="cal" onClick={() => nav.push('eventedit', { isNew: true })}>
          Nieuw event
        </Btn>
      </div>
      <Scroll bottom={100}>
        {isLoading ? (
          <Empty text="Events laden…" />
        ) : isError ? (
          <Empty text="Kon de events niet laden. Probeer het later opnieuw." />
        ) : evs.length === 0 ? (
          <Empty text={when === 'upcoming' ? 'Nog geen komende events.' : 'Nog geen afgelopen events.'} />
        ) : (
          months.map((m) => (
            <div key={m} className="mb-2">
              <Label className="mx-0.5 mb-[10px] mt-3">{m}</Label>
              <div className="flex flex-col gap-[10px]">
                {evs
                  .filter((e) => e.month === m)
                  .map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => nav.push(e.when === 'past' ? 'pastevent' : 'event', { id: e.id })}
                      className={cn('flex items-center gap-[14px] rounded-[18px] border border-line bg-elev p-[14px] text-left', cardPress)}
                    >
                      <div className="w-[52px] shrink-0 text-center">
                        <div className={cn('font-display text-[24px] font-extrabold leading-none', e.accent ? 'text-acc' : 'text-text')}>{e.date}</div>
                        <div className="mt-0.5 text-[11px] font-bold tracking-[0.05em] text-faint">{e.mon}</div>
                      </div>
                      <div className="w-px self-stretch bg-line2" />
                      <div className="min-w-0 flex-1">
                        <div className="overflow-hidden text-ellipsis whitespace-nowrap font-display text-[17px] font-bold text-text">{e.name}</div>
                        <div className="mt-[3px] flex items-center gap-1.5 text-[13px] text-faint">
                          <Icon name="clock" size={13} stroke="rgba(255,255,255,0.40)" />
                          Deur {e.time} · {e.venue}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-display text-[16px] font-bold text-text">{e.guests}</div>
                        <div className="text-[11px] text-faint">{when === 'past' ? (e.guests > 0 ? Math.round((e.inside / e.guests) * 100) : 0) + '% op' : 'gasten'}</div>
                      </div>
                    </button>
                  ))}
              </div>
            </div>
          ))
        )}
      </Scroll>
    </div>
  );
}

// ── EVENT detail (pushed) ───────────────────────────────────────────────────────
export function EventView({ id }: { id?: string }): JSX.Element {
  const nav = useNav();
  const { event, isLoading, isError, notFound } = usePoEvent(id ?? '');
  const { data: detail } = usePoEventDetail(id ?? '');

  if (isLoading) return <ScreenState onBack={nav.back} title="Event" text="Laden…" />;
  if (isError || notFound || !event) {
    return <ScreenState onBack={nav.back} title="Event" text="Dit event is niet (meer) beschikbaar." />;
  }

  const ev = event;
  const onweg = Math.max(0, ev.guests - ev.inside);
  const pct = ev.guests > 0 ? ev.inside / ev.guests : 0;
  const recent = detail?.recent ?? [];
  const openRequests = detail?.openRequests ?? 0;

  return (
    <div className={col}>
      <Top onBack={nav.back} title={ev.name} sub={`${ev.venue} · ${ev.date} ${ev.mon}`} right={<IconBtn name="dots" onClick={() => nav.push('eventedit', { id: ev.id })} />} />
      <Scroll bottom={28}>
        <div className="mb-3 grid grid-cols-2 gap-[10px]">
          <Stat big v={onweg} l="Onderweg" />
          <Stat big v={ev.inside} l="Binnen" acc />
        </div>
        <div className="mb-3 rounded-[18px] border border-line bg-elev p-4">
          <div className="mb-[9px] flex justify-between">
            <Label>Opkomst gastenlijst</Label>
            <span className="font-display font-bold text-acc">{Math.round(pct * 100)}%</span>
          </div>
          <div className="h-[10px] overflow-hidden rounded-[6px] bg-elev2">
            <div className="h-full rounded-[6px] bg-acc" style={{ width: pct * 100 + '%' }} />
          </div>
          <div className="mt-[9px] text-[12.5px] text-faint">{ev.guests} koppen op de lijst · incl. meegenomen gasten</div>
        </div>
        <div className="mb-4 flex gap-[10px]">
          <Btn kind="primary" full icon="user" onClick={() => nav.setTab('deur')}>
            Check-in
          </Btn>
          <Btn kind="dark" full icon="users" onClick={() => nav.push('lijst', { id: ev.id })}>
            Gastenlijst
          </Btn>
        </div>
        {openRequests > 0 && (
          <>
            <Label className="mb-[10px]">Aandacht nodig</Label>
            <div className="mb-[18px] flex flex-col gap-[9px]">
              <button
                type="button"
                onClick={() => nav.push('aanvragen')}
                className={cn('flex w-full gap-[12px] rounded-[14px] border bg-elev p-[13px] text-left', cardPress)}
                style={{ borderColor: 'rgba(181,166,255,0.4)' }}
              >
                <span className="mt-px text-acc-soft">
                  <Icon name="bell" size={19} />
                </span>
                <div className="flex-1">
                  <div className="font-body text-[14px] font-bold text-text">
                    {openRequests} open {openRequests === 1 ? 'aanvraag' : 'aanvragen'}
                  </div>
                  <div className="mt-0.5 text-[12.5px] leading-[1.4] text-faint">Wachten op jouw goedkeuring — tik om af te handelen</div>
                </div>
                <span className="self-center text-acc">
                  <Icon name="chev" size={20} />
                </span>
              </button>
            </div>
          </>
        )}
        <Label className="mb-[10px]">Laatst binnen</Label>
        {recent.length === 0 ? (
          <Empty text="Nog niemand ingecheckt." />
        ) : (
          <div className="flex flex-col">
            {recent.map((g) => (
              <div key={g.guestId} className="flex items-center gap-[12px] border-b border-line2 py-[10px]">
                <Avatar name={g.name} size={38} />
                <div className="flex-1">
                  <div className="text-[14.5px] font-semibold text-text">
                    {g.name}
                    {g.plus > 0 && <span className="text-faint"> +{g.plus}</span>}
                  </div>
                </div>
                <span className="font-display text-[13px] font-bold text-acc">{formatClock(g.at)}</span>
              </div>
            ))}
          </div>
        )}
      </Scroll>
    </div>
  );
}

// ── EVENT edit / create (pushed) ─────────────────────────────────────────────────
/** ISO instant → [date, time] local strings for the date/time inputs. */
function splitLocal(iso: string | null): [string, string] {
  const [d = '', t = ''] = isoToLocalInput(iso).split('T');
  return [d, t];
}

export function EventEdit({ id, isNew }: { id?: string; isNew?: boolean }): JSX.Element {
  const nav = useNav();
  const { venueId, venueName, roles } = usePoIdentity();
  const isAdmin = roles.includes('admin');
  const editId = isNew ? '' : id ?? '';
  const { data: ev, isLoading, isError, canManage } = usePoEventForEdit(editId);

  const createEvent = usePoCreateEvent();
  const updateEvent = usePoUpdateEvent(editId);
  const changeStatus = usePoChangeStatus(editId);
  const setLandingActive = usePoSetLandingActive(editId);
  const setListLock = usePoSetListLock(editId);
  const setAutoLock = usePoSetAutoLock(editId);

  const [name, setName] = useState('');
  const [dateStr, setDateStr] = useState('');
  const [timeStr, setTimeStr] = useState('');
  const [landingOn, setLandingOn] = useState(false);
  const [autoOn, setAutoOn] = useState(false);
  const [autoDate, setAutoDate] = useState('');
  const [autoTime, setAutoTime] = useState('');
  const [locked, setLocked] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Hydrate the form once the event identity loads / changes (edit mode only).
  useEffect(() => {
    if (!ev) return;
    setName(ev.name);
    const [d, t] = splitLocal(ev.startsAt);
    setDateStr(d);
    setTimeStr(t);
    setLandingOn(ev.landingActive);
    setLocked(ev.listLocked);
    const [ad, at] = splitLocal(ev.autoLockAt);
    setAutoOn(!!ev.autoLockAt);
    setAutoDate(ad);
    setAutoTime(at);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ev?.id]);

  if (!isNew && isLoading) return <ScreenState onBack={nav.back} title="Event bewerken" text="Laden…" />;
  if (!isNew && (isError || !ev)) {
    return <ScreenState onBack={nav.back} title="Event bewerken" text="Dit event is niet (meer) beschikbaar." />;
  }

  const writable = isNew ? isAdmin : canManage;
  const venueLabel = isNew ? venueName ?? '' : ev?.venueName ?? '';
  const saving = createEvent.isPending || updateEvent.isPending;

  // Name + start (+ landing/auto-lock as config) commit together on save; list-lock
  // and status are immediate operational controls (mirrors the desktop split).
  const save = async (): Promise<void> => {
    setErr(null);
    const startsAt = localInputToIso(`${dateStr}T${timeStr}`);
    if (!name.trim() || !startsAt) {
      setErr('Vul een naam, datum en tijd in.');
      return;
    }
    const autoIso = autoOn ? localInputToIso(`${autoDate}T${autoTime}`) : null;
    if (autoOn && !autoIso) {
      setErr('Vul de sluitdatum en -tijd in (of zet automatisch sluiten uit).');
      return;
    }
    try {
      if (isNew) {
        if (!venueId) {
          setErr('Geen actieve venue gevonden.');
          return;
        }
        await createEvent.mutateAsync({ venueId, name: name.trim(), startsAt, landingActive: landingOn });
      } else {
        await updateEvent.mutateAsync({ eventId: editId, name: name.trim(), startsAt });
        if (ev && landingOn !== ev.landingActive) {
          await setLandingActive.mutateAsync({ eventId: editId, active: landingOn });
        }
        if (autoIso !== (ev?.autoLockAt ?? null)) {
          await setAutoLock.mutateAsync({ eventId: editId, autoLockAt: autoIso });
        }
      }
      nav.back();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Opslaan is mislukt. Probeer het opnieuw.');
    }
  };

  const toggleLock = async (v: boolean): Promise<void> => {
    setLocked(v);
    setErr(null);
    try {
      await setListLock.mutateAsync({ eventId: editId, locked: v });
    } catch (e) {
      setLocked(!v);
      setErr(e instanceof Error ? e.message : 'Kon de lijst niet (ont)grendelen.');
    }
  };

  const doStatus = async (to: EventStatus): Promise<void> => {
    setErr(null);
    try {
      await changeStatus.mutateAsync({ eventId: editId, status: to });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Kon de status niet wijzigen.');
    }
  };

  const copyLink = async (): Promise<void> => {
    if (!ev?.landingSlug) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/e/${ev.landingSlug}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked (rare in webviews) — silently ignore; the slug is visible.
    }
  };

  return (
    <div className={col}>
      <Top onBack={nav.back} title={isNew ? 'Nieuw event' : 'Event bewerken'} sub={isNew ? undefined : ev?.name} />
      <Scroll bottom={120}>
        {err && <div className="mb-3 text-[13px] font-semibold text-[#E89AC0]">{err}</div>}
        {!writable && (
          <Note icon="shield">
            {isNew
              ? 'Alleen beheerders kunnen events aanmaken.'
              : 'Je kunt dit event alleen bekijken — wijzigen vereist beheerder- of organisator-rechten.'}
          </Note>
        )}

        <Label className="mb-2">Naam</Label>
        <Field placeholder="bv. FRENZY" value={name} onChange={writable ? setName : undefined} className="mb-[14px]" />

        <Label className="mb-2">Venue</Label>
        <Field icon="building" value={venueLabel} placeholder="Onbekende venue" className="mb-[14px]" />

        <div className="mb-[14px] flex gap-[10px]">
          <div className="flex-1">
            <Label className="mb-2">Datum</Label>
            <Field icon="cal" type="date" value={dateStr} onChange={writable ? setDateStr : undefined} />
          </div>
          <div className="flex-1">
            <Label className="mb-2">Deur open</Label>
            <Field icon="clock" type="time" value={timeStr} onChange={writable ? setTimeStr : undefined} />
          </div>
        </div>

        {!isNew && (
          <button
            type="button"
            onClick={() => nav.push('tiers', { id: editId })}
            className="mb-[18px] flex w-full items-center gap-[13px] rounded-[14px] border border-line bg-elev px-[14px] py-[15px] text-left transition-colors hover:bg-white/[0.03]"
          >
            <span className="flex h-[38px] w-[38px] items-center justify-center rounded-[11px] border border-line bg-elev2 text-acc">
              <Icon name="ticket" size={18} />
            </span>
            <span className="flex-1">
              <span className="block font-body text-[15px] font-semibold text-text">Tiers & aliassen</span>
              <span className="mt-px block text-[12.5px] text-faint">Voeden de quick-add</span>
            </span>
            <Icon name="chev" size={18} className="text-ghost" />
          </button>
        )}

        {!isNew && ev && (
          <>
            <Label className="mb-[10px]">Status</Label>
            <div className="mb-[18px] rounded-[16px] border border-line bg-elev p-[14px]">
              <div className="font-display text-[15px] font-bold text-text">{STATUS_LABELS[ev.status]}</div>
              <div className="mt-0.5 text-[12.5px] leading-[1.4] text-faint">{STATUS_DESCRIPTIONS[ev.status]}</div>
              {writable && allowedTransitions(ev.status, { isAdmin }).length > 0 && (
                <div className="mt-3 flex flex-col gap-2.5">
                  {allowedTransitions(ev.status, { isAdmin }).map((tr) => (
                    <div key={tr.to}>
                      {tr.warning && <div className="mb-1.5 text-[12px] leading-[1.4] text-faint">{tr.warning}</div>}
                      <Btn
                        kind={tr.to === 'closed' ? 'dark' : 'primary'}
                        sm
                        full
                        icon="check"
                        onClick={() => void doStatus(tr.to)}
                        disabled={changeStatus.isPending}
                      >
                        {tr.label}
                      </Btn>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        <Label className="mb-[10px]">Landingpage</Label>
        <div className="mb-[18px] rounded-[16px] border border-line bg-elev px-[14px] py-1">
          <ToggleRow
            title="Aanvraaglink actief"
            sub="Gasten kunnen zich aanmelden via de link"
            on={landingOn}
            set={(v) => writable && setLandingOn(v)}
            last={!landingOn || isNew}
          />
          {!isNew && landingOn && ev?.landingSlug && (
            <div className="flex items-center gap-[9px] border-t border-line2 pb-[14px] pt-3">
              <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[12.5px] text-dim">/e/{ev.landingSlug}</span>
              <button
                type="button"
                onClick={() => void copyLink()}
                aria-label="Kopieer aanmeldlink"
                className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] border border-line text-faint transition-[filter] hover:brightness-[1.2]"
              >
                <Icon name={copied ? 'check' : 'share'} size={16} />
              </button>
            </div>
          )}
          {!isNew && landingOn && (
            <div className="border-t border-line2">
              <ToggleRow
                title="Sluit aanmelden automatisch"
                sub={autoOn ? 'Na dit moment kan niemand zich meer aanmelden' : 'Link blijft open tot je hem handmatig sluit'}
                on={autoOn}
                set={(v) => writable && setAutoOn(v)}
                last={!autoOn}
              />
              {autoOn && (
                <div className="flex gap-[10px] pb-[14px]">
                  <div className="flex-1">
                    <Label className="mb-2">Sluit op</Label>
                    <Field icon="cal" type="date" value={autoDate} onChange={writable ? setAutoDate : undefined} />
                  </div>
                  <div className="flex-1">
                    <Label className="mb-2">Om</Label>
                    <Field icon="clock" type="time" value={autoTime} onChange={writable ? setAutoTime : undefined} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {!isNew && (
          <>
            <Label className="mb-[10px]">Aan de deur</Label>
            <div className="rounded-[16px] border border-line bg-elev px-[14px] py-1">
              <ToggleRow
                title="Lijst vergrendelen"
                sub={locked ? 'Staff kan niet meer muteren — admin/host/deur wel' : 'Typisch bij deuropening'}
                on={locked}
                set={(v) => writable && void toggleLock(v)}
                last
              />
            </div>
          </>
        )}
      </Scroll>
      <BottomBar>
        <Btn
          kind="primary"
          full
          icon="check"
          onClick={() => void save()}
          disabled={!writable || saving}
          className={!writable || saving ? 'opacity-50' : ''}
        >
          {saving ? 'Bezig…' : isNew ? 'Event aanmaken' : 'Opslaan'}
        </Btn>
      </BottomBar>
    </div>
  );
}

// ── TIERS & aliases (pushed) ─────────────────────────────────────────────────────
const TIER_COLORS = ['#B5A6FF', '#9DE0C0', '#E8C98A', '#9FB8E8', '#E89AC0', '#8E8E93'];

export function Tiers({ eventId }: { eventId?: string }): JSX.Element {
  const nav = useNav();
  const id = eventId ?? '';
  const { event } = usePoEvent(id);
  const { data: tierList, isLoading, isError } = usePoTiers(id);
  const createTier = usePoCreateTier(id);
  const updateTier = usePoUpdateTier(id);

  const [adding, setAdding] = useState(false);
  const [nm, setNm] = useState('');
  const [color, setColor] = useState('#B5A6FF');
  const [max, setMax] = useState('');
  const [aliasText, setAliasText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [aliasFor, setAliasFor] = useState<string | null>(null);
  const [newAlias, setNewAlias] = useState('');

  const resetForm = (): void => {
    setNm('');
    setColor('#B5A6FF');
    setMax('');
    setAliasText('');
  };

  const submit = async (): Promise<void> => {
    if (!nm.trim() || createTier.isPending) return;
    setErr(null);
    const maxNum = Number.parseInt(max, 10);
    try {
      await createTier.mutateAsync({
        eventId: id,
        name: nm.trim(),
        color,
        maxGuests: Number.isFinite(maxNum) && maxNum > 0 ? maxNum : null,
        aliases: aliasText.split(',').map((a) => a.trim()).filter(Boolean),
      });
      resetForm();
      setAdding(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Kon de tier niet aanmaken.');
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
      setErr(e instanceof Error ? e.message : 'Kon de alias niet opslaan.');
    }
  };

  return (
    <div className={col}>
      <Top
        onBack={nav.back}
        title="Tiers & aliassen"
        sub={event?.name}
        right={<IconBtn name={adding ? 'close' : 'plus'} onClick={() => setAdding((a) => !a)} />}
      />
      <Scroll bottom={adding ? 120 : 24}>
        {err && <div className="mb-3 text-[13px] font-semibold text-[#E89AC0]">{err}</div>}
        {adding && (
          <div className="mb-[14px] rounded-[18px] border border-acc bg-elev p-4">
            <Label className="mb-[10px]">Nieuwe tier</Label>
            <Field placeholder="Naam, bv. “Backstage”" value={nm} onChange={setNm} autoFocus className="mb-3" />
            <Label className="mb-2">Kleur</Label>
            <div className="mb-[14px] flex gap-[9px]">
              {TIER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className="h-[34px] w-[34px] cursor-pointer rounded-full transition-[filter] hover:brightness-[1.1]"
                  style={{ background: c, border: '2px solid ' + (color === c ? '#FFFFFF' : 'transparent') }}
                  aria-label={`Kleur ${c}`}
                />
              ))}
            </div>
            <Label className="mb-2">Max (optioneel)</Label>
            <Field placeholder="∞ — geen maximum" value={max} onChange={setMax} inputMode="numeric" className="mb-[14px]" />
            <Label className="mb-2">Aliassen · voeden de quick-add</Label>
            <Field icon="spark" placeholder="backstage, bs, prod…" value={aliasText} onChange={setAliasText} />
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
          </div>
        )}
        <Note icon="spark">Aliassen bepalen wat de quick-add herkent. “fles” of “champagne” → VIP. Onbekende woorden vraagt de app na — nooit stil naar Regular.</Note>
        {isLoading ? (
          <Empty text="Tiers laden…" />
        ) : isError ? (
          <Empty text="Kon de tiers niet laden. Probeer het later opnieuw." />
        ) : (tierList ?? []).length === 0 ? (
          <Empty text="Nog geen tiers — voeg er één toe met +." />
        ) : (
          <div className="flex flex-col gap-[11px]">
            {(tierList ?? []).map((t) => (
              <div key={t.id} className="rounded-[18px] border border-line bg-elev p-[15px]">
                <div className="mb-3 flex items-center gap-[11px]">
                  <span className="h-[14px] w-[14px] shrink-0 rounded-full" style={{ background: t.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-[15.5px] font-bold text-text">{t.name}</div>
                    <div className="mt-px text-[12px] text-faint">{t.max ? `${t.used} / ${t.max} gebruikt` : `${t.used} · geen max`}</div>
                  </div>
                  {t.isDefault && <MiniChip>STANDAARD</MiniChip>}
                </div>
                {t.max && (
                  <div className="mb-3 h-[6px] overflow-hidden rounded-[4px] bg-elev2">
                    <div className="h-full rounded-[4px]" style={{ width: Math.min(100, (t.used / t.max) * 100) + '%', background: t.color }} />
                  </div>
                )}
                <Label className="mb-2">Aliassen</Label>
                <div className="flex flex-wrap gap-1.5">
                  {t.aliases.map((a) => (
                    <span key={a} className="inline-flex items-center gap-[5px] rounded-[8px] border border-line bg-elev2 px-[9px] py-[5px] font-mono text-[12px] text-dim">
                      {a}
                    </span>
                  ))}
                  {aliasFor === t.id ? (
                    <input
                      autoFocus
                      value={newAlias}
                      onChange={(e) => setNewAlias(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void commitAlias(t.id, t.aliases);
                        if (e.key === 'Escape') {
                          setAliasFor(null);
                          setNewAlias('');
                        }
                      }}
                      onBlur={() => {
                        setAliasFor(null);
                        setNewAlias('');
                      }}
                      placeholder="alias…"
                      className="w-[120px] rounded-[8px] border border-acc bg-elev2 px-[9px] py-[5px] font-mono text-[12px] text-text outline-none placeholder:text-faint"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setAliasFor(t.id);
                        setNewAlias('');
                      }}
                      className="inline-flex items-center gap-1 rounded-[8px] border border-dashed border-line bg-transparent px-[9px] py-[5px] font-body text-[12px] text-faint transition-[filter] hover:brightness-[1.2]"
                    >
                      <Icon name="plus" size={12} sw={2.4} />
                      alias
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Scroll>
      {adding && (
        <BottomBar>
          <Btn kind="primary" full icon="check" onClick={() => void submit()} disabled={!nm.trim() || createTier.isPending} className={nm.trim() && !createTier.isPending ? '' : 'opacity-50'}>
            {createTier.isPending ? 'Bezig…' : 'Tier aanmaken'}
          </Btn>
        </BottomBar>
      )}
    </div>
  );
}

// ── PAST EVENT recap (pushed) ────────────────────────────────────────────────────
const RECAP_CAP = 8;

export function PastEvent({ id }: { id?: string }): JSX.Element {
  const nav = useNav();
  const { event, isLoading: evLoading, isError: evError, notFound } = usePoEvent(id ?? '');
  const { data: r, isLoading: rLoading, isError: rError } = usePoEventRecap(id ?? '');
  const [showAllIn, setShowAllIn] = useState(false);
  const [showAllNo, setShowAllNo] = useState(false);

  if (evLoading || rLoading) return <ScreenState onBack={nav.back} title="Recap" text="Laden…" />;
  if (evError || rError || notFound || !event || !r) {
    return <ScreenState onBack={nav.back} title="Recap" text="Deze recap is niet beschikbaar." />;
  }

  const ev = event;
  const pct = r.listed > 0 ? Math.round((r.arrived / r.listed) * 100) : 0;
  const maxT = Math.max(1, ...r.perTier.map((x) => x.aangemeld));
  const inList = showAllIn ? r.checkedIn : r.checkedIn.slice(0, RECAP_CAP);
  const noList = showAllNo ? r.noShows : r.noShows.slice(0, RECAP_CAP);

  return (
    <div className={col}>
      <Top onBack={nav.back} title={ev.name} sub={`${ev.venue} · ${ev.date} ${ev.mon}`} right={<IconBtn name="share" />} />
      <Scroll bottom={28}>
        <div className="mb-[14px] rounded-[18px] bg-acc-dim p-[18px]">
          <Label className="mb-[10px] text-acc-soft">Afgelopen event · samenvatting</Label>
          <div className="flex items-end gap-[10px]">
            <div className="font-display text-[54px] font-extrabold leading-[0.9] text-text">{pct}%</div>
            <div className="pb-1.5">
              <div className="text-[14px] font-semibold text-text">opkomst</div>
              <div className="text-[12.5px] text-dim">
                {r.arrived} van {r.listed} koppen
              </div>
            </div>
          </div>
          <div className="mt-[14px] h-[8px] overflow-hidden rounded-[5px] bg-white/[0.12]">
            <div className="h-full rounded-[5px] bg-acc" style={{ width: pct + '%' }} />
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-[10px]">
          <div className="rounded-[18px] border border-line bg-elev px-4 py-[14px]">
            <div className="font-display text-[30px] font-extrabold leading-none text-acc">{r.arrived}</div>
            <div className="mt-1 text-[12.5px] text-dim">Ingecheckt</div>
          </div>
          <div className="rounded-[18px] border border-line bg-elev px-4 py-[14px]">
            <div className="font-display text-[30px] font-extrabold leading-none text-text">{r.noShow}</div>
            <div className="mt-1 text-[12.5px] text-faint">Niet verschenen</div>
          </div>
        </div>

        <Label className="mb-[10px]">Ingecheckt · {r.checkedIn.length}</Label>
        {r.checkedIn.length === 0 ? (
          <div className="mb-4">
            <Empty text="Niemand ingecheckt." />
          </div>
        ) : (
          <div className="mb-4 rounded-[18px] border border-line bg-elev px-[14px] py-0.5">
            {inList.map((g, i) => (
              <div key={`${g.name}-${i}`} className={cn('flex items-center gap-[12px] py-[11px]', i < inList.length - 1 && 'border-b border-line2')}>
                <Avatar name={g.name} size={36} accent={g.role === 'VIP'} />
                <div className="min-w-0 flex-1">
                  <div className="font-display text-[14.5px] font-bold text-text">
                    {g.name}
                    {g.plus > 0 && <span className="font-semibold text-faint"> +{g.plus}</span>}
                  </div>
                  <div className="mt-1">
                    <RoleChip role={g.role} />
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 font-display text-[13px] font-bold text-acc">
                  <Icon name="check2" size={14} stroke="#B5A6FF" sw={2.4} />
                  {g.at ?? '—'}
                </span>
              </div>
            ))}
            {!showAllIn && r.checkedIn.length > RECAP_CAP && (
              <button
                type="button"
                onClick={() => setShowAllIn(true)}
                className="w-full border-t border-line2 py-3 font-body text-[13.5px] font-bold text-dim transition-[filter] hover:brightness-[1.2]"
              >
                Toon alle {r.checkedIn.length} ingecheckt
              </button>
            )}
          </div>
        )}

        <Label className="mb-[10px]">Niet verschenen · {r.noShows.length}</Label>
        {r.noShows.length === 0 ? (
          <div className="mb-[18px]">
            <Empty text="Iedereen kwam opdagen." />
          </div>
        ) : (
          <div className="mb-[18px] rounded-[18px] border border-line bg-elev px-[14px] py-0.5">
            {noList.map((g, i) => (
              <div key={`${g.name}-${i}`} className={cn('flex items-center gap-[12px] py-[11px] opacity-[0.72]', i < noList.length - 1 && 'border-b border-line2')}>
                <Avatar name={g.name} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="font-display text-[14.5px] font-bold text-dim">
                    {g.name}
                    {g.plus > 0 && <span className="font-semibold text-faint"> +{g.plus}</span>}
                  </div>
                  {g.by && <div className="mt-[3px] text-[12px] text-faint">toegevoegd door {g.by}</div>}
                </div>
                <span className="text-[12px] font-bold text-faint">no-show</span>
              </div>
            ))}
            {!showAllNo && r.noShows.length > RECAP_CAP && (
              <button
                type="button"
                onClick={() => setShowAllNo(true)}
                className="w-full border-t border-line2 py-3 font-body text-[13.5px] font-bold text-dim transition-[filter] hover:brightness-[1.2]"
              >
                Toon alle {r.noShows.length} no-shows
              </button>
            )}
          </div>
        )}

        <Label className="mb-[10px]">Opkomst per tier</Label>
        <div className="mb-[14px] rounded-[18px] border border-line bg-elev p-4">
          {r.perTier.length === 0 ? (
            <div className="py-[14px] text-center text-[13px] text-faint">Geen tierdata.</div>
          ) : (
            r.perTier.map((t, i) => (
              <div key={t.tier} className={i < r.perTier.length - 1 ? 'mb-[13px]' : ''}>
                <div className="mb-1.5 flex justify-between">
                  <span className="text-[13px] font-semibold text-text">{t.tier}</span>
                  <span className="font-display text-[12px] text-faint">
                    <b className="text-acc">{t.binnen}</b>/{t.aangemeld}
                  </span>
                </div>
                <div className="relative h-[8px] overflow-hidden rounded-[5px] bg-elev2">
                  <div className="absolute inset-0 bg-white/[0.08]" style={{ width: (t.aangemeld / maxT) * 100 + '%' }} />
                  <div className="absolute inset-0 rounded-[5px] bg-acc" style={{ width: (t.binnen / maxT) * 100 + '%' }} />
                </div>
              </div>
            ))
          )}
        </div>
        <div className="mb-4 grid grid-cols-2 gap-[10px]">
          <div className="rounded-[18px] border border-line bg-elev px-4 py-[14px]">
            <div className="font-display text-[24px] font-extrabold text-text">{r.refused}</div>
            <div className="mt-[3px] text-[12px] text-faint">Geweigerd</div>
          </div>
          <div className="rounded-[18px] border border-line bg-elev px-4 py-[14px]">
            <div className="font-display text-[24px] font-extrabold text-text">{r.peak}</div>
            <div className="mt-[3px] text-[12px] text-faint">Piek instroom</div>
          </div>
        </div>
        <div className="flex gap-[10px]">
          <Btn kind="dark" full icon="users" onClick={() => nav.push('lijst', { id: ev.id })}>
            Gastenlijst
          </Btn>
          <Btn kind="quiet" full icon="dl">
            Export
          </Btn>
        </div>
      </Scroll>
    </div>
  );
}

// ── EVENTS & TIERS hub (pushed) ──────────────────────────────────────────────────
export function EventBeheer(): JSX.Element {
  const nav = useNav();
  const { data, isLoading, isError } = usePoEvents();
  const upcoming = (data ?? []).filter((e) => e.when === 'upcoming');
  const past = (data ?? []).filter((e) => e.when === 'past');
  const evRow = (e: PoEvent, dim: boolean): JSX.Element => (
    <button
      key={e.id}
      type="button"
      onClick={() => nav.push(dim ? 'pastevent' : 'eventedit', { id: e.id })}
      className={cn('flex w-full items-center gap-[13px] rounded-[16px] border border-line bg-elev p-[13px] text-left', cardPress, dim && 'opacity-[0.72]')}
    >
      <span className="w-[44px] shrink-0 text-center">
        <span className={cn('block font-display text-[20px] font-extrabold leading-none', e.accent ? 'text-acc' : 'text-text')}>{e.date}</span>
        <span className="mt-0.5 block text-[9.5px] font-bold tracking-[0.05em] text-faint">{e.mon}</span>
      </span>
      <span className="w-px self-stretch bg-line2" />
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[15.5px] font-bold text-text">{e.name}</span>
        <span className="mt-px block text-[12.5px] text-faint">
          {e.venue} · {e.guests} gasten
        </span>
      </span>
      <Icon name="chev" size={18} className="text-ghost" />
    </button>
  );
  return (
    <div className={col}>
      <Top onBack={nav.back} title="Events & tiers" sub="Maak en beheer je evenementen" />
      <Scroll bottom={24}>
        <button type="button" onClick={() => nav.push('eventedit', { isNew: true })} className={cn('mb-5 flex w-full items-center gap-[13px] rounded-[16px] bg-acc p-4 text-left', press)}>
          <span className="flex h-[40px] w-[40px] items-center justify-center rounded-[12px] bg-on-acc/[0.14] text-on-acc">
            <Icon name="plus" size={22} sw={2.4} />
          </span>
          <span className="flex-1">
            <span className="block font-display text-[16px] font-extrabold text-on-acc">Nieuw evenement</span>
            <span className="mt-px block text-[12.5px] text-on-acc/70">Naam, datum, tiers & landingpage</span>
          </span>
          <span className="text-on-acc">
            <Icon name="arrowR" size={20} />
          </span>
        </button>
        {isLoading ? (
          <Empty text="Events laden…" />
        ) : isError ? (
          <Empty text="Kon de events niet laden. Probeer het later opnieuw." />
        ) : (
          <>
            <Label className="mb-[10px]">Komende events · {upcoming.length}</Label>
            {upcoming.length === 0 ? (
              <div className="mb-5">
                <Empty text="Nog geen komende events." />
              </div>
            ) : (
              <div className="mb-5 flex flex-col gap-[9px]">{upcoming.map((e) => evRow(e, false))}</div>
            )}
            <Label className="mb-[10px]">Afgelopen</Label>
            {past.length === 0 ? (
              <Empty text="Nog geen afgelopen events." />
            ) : (
              <div className="flex flex-col gap-[9px]">{past.map((e) => evRow(e, true))}</div>
            )}
          </>
        )}
      </Scroll>
    </div>
  );
}
