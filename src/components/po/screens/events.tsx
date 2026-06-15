'use client';

/** Events tab + event detail, event CRUD, tier/alias beheer, past-event recap. */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { events, guests, recap, stats } from '@/lib/po/data';
import type { PoEvent } from '@/lib/po/types';
import { usePoEvents, usePoTiers, useSession } from '@/features/po/PoLiveProvider';
import { createEvent, createTier, updateEvent } from '@/features/events/actions';
import { useNav, usePo } from '../context';
import { Icon, type IconName } from '../icon';
import { Avatar, Btn, Field, IconBtn, Label, MiniChip, Note, RoleChip, Scroll, ToggleRow, Top } from '../kit';
import { BottomBar } from '../shell';

const cardPress = 'transition-[border-color,transform] hover:border-white/[0.24] active:scale-[0.99]';
const press = 'transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]';
const col = 'flex h-full flex-col';

function heads(arr: { plus: number }[]): number {
  return arr.reduce((a, g) => a + 1 + g.plus, 0);
}

// ISO timestamp -> value for <input type="datetime-local"> (local wall-clock).
function toLocalInput(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const dtField =
  'w-full rounded-[14px] border border-line bg-elev2 px-[14px] py-3 text-[15px] text-text [color-scheme:dark] outline-none focus:border-acc';

// ── helpers ───────────────────────────────────────────────────────────────────
function Stat({ v, l, acc, big }: { v: number; l: string; acc?: boolean; big?: boolean }): JSX.Element {
  return (
    <div className="rounded-[18px] border border-line bg-elev p-4">
      <div className={cn('font-display font-extrabold leading-none', big ? 'text-[38px]' : 'text-[28px]', acc ? 'text-acc' : 'text-text')}>{v}</div>
      <div className="mt-1 text-[13px] text-dim">{l}</div>
    </div>
  );
}

function Alert({ icon, title, body }: { icon: IconName; title: string; body: string }): JSX.Element {
  return (
    <div className="flex gap-[12px] rounded-[14px] border border-line bg-elev p-[13px]">
      <span className="mt-px text-acc-soft">
        <Icon name={icon} size={19} />
      </span>
      <div>
        <div className="font-body text-[14px] font-bold text-text">{title}</div>
        <div className="mt-0.5 text-[12.5px] leading-[1.4] text-faint">{body}</div>
      </div>
    </div>
  );
}

// ── EVENTS (tab) ──────────────────────────────────────────────────────────────
export function Events(): JSX.Element {
  const nav = useNav();
  const { events: liveEvents, isLoading } = usePoEvents();
  const [when, setWhen] = useState<'upcoming' | 'past'>('upcoming');
  const evs = liveEvents.filter((e) => e.when === when);
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
        {isLoading && evs.length === 0 && (
          <p className="px-1 py-6 text-[13px] text-dim">Laden…</p>
        )}
        {!isLoading && evs.length === 0 && (
          <p className="px-1 py-6 text-[13px] text-dim">
            Geen {when === 'past' ? 'afgelopen' : 'komende'} events.
          </p>
        )}
        {months.map((m) => (
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
                      <div className="text-[11px] text-faint">{when === 'past' ? Math.round((e.inside / e.guests) * 100) + '% op' : 'gasten'}</div>
                    </div>
                  </button>
                ))}
            </div>
          </div>
        ))}
      </Scroll>
    </div>
  );
}

// ── EVENT detail (pushed) ───────────────────────────────────────────────────────
export function EventView({ ev }: { ev: PoEvent }): JSX.Element {
  const nav = useNav();
  const { inside } = usePo();
  const gs = guests;
  const inn = gs.filter((g) => inside.has(g.id));
  const total = heads(gs) + 130;
  const inH = heads(inn) + 96;
  const pct = inH / total;
  const recent = inn
    .slice()
    .sort((a, b) => ((a.at ?? '') < (b.at ?? '') ? 1 : -1))
    .slice(0, 3);
  return (
    <div className={col}>
      <Top onBack={nav.back} title={ev.name} sub={`${ev.venue} · ${ev.date} ${ev.mon}`} right={<IconBtn name="dots" onClick={() => nav.push('eventedit', { id: ev.id })} />} />
      <Scroll bottom={28}>
        <div className="mb-3 grid grid-cols-2 gap-[10px]">
          <Stat big v={total - inH} l="Onderweg" />
          <Stat big v={inH} l="Binnen" acc />
        </div>
        <div className="mb-3 rounded-[18px] border border-line bg-elev p-4">
          <div className="mb-[9px] flex justify-between">
            <Label>Opkomst gastenlijst</Label>
            <span className="font-display font-bold text-acc">{Math.round(pct * 100)}%</span>
          </div>
          <div className="h-[10px] overflow-hidden rounded-[6px] bg-elev2">
            <div className="h-full rounded-[6px] bg-acc" style={{ width: pct * 100 + '%' }} />
          </div>
          <div className="mt-[9px] text-[12.5px] text-faint">{total} koppen op de lijst · incl. meegenomen gasten</div>
        </div>
        <div className="mb-4 flex gap-[10px]">
          <Btn kind="primary" full icon="user" onClick={() => nav.setTab('deur')}>
            Check-in
          </Btn>
          <Btn kind="dark" full icon="users" onClick={() => nav.push('lijst', { id: ev.id })}>
            Gastenlijst
          </Btn>
        </div>
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
              <div className="font-body text-[14px] font-bold text-text">3 quotum-verzoeken + 4 aanvragen</div>
              <div className="mt-0.5 text-[12.5px] leading-[1.4] text-faint">Wachten op jouw goedkeuring — tik om af te handelen</div>
            </div>
            <span className="self-center text-acc">
              <Icon name="chev" size={20} />
            </span>
          </button>
          <Alert icon="crown" title="VIP onderweg" body="Anouk Smit +2 — host wordt gewaarschuwd aan de deur" />
          <Alert icon="money" title="3 gasten moeten betalen" body="Betaalde gastenlijst — afrekenen bij binnenkomst" />
        </div>
        <Label className="mb-[10px]">Laatst binnen</Label>
        <div className="flex flex-col">
          {recent.map((g) => (
            <div key={g.id} className="flex items-center gap-[12px] border-b border-line2 py-[10px]">
              <Avatar name={g.name} size={38} />
              <div className="flex-1">
                <div className="text-[14.5px] font-semibold text-text">
                  {g.name}
                  {g.plus > 0 && <span className="text-faint"> +{g.plus}</span>}
                </div>
              </div>
              <span className="font-display text-[13px] font-bold text-acc">{g.at}</span>
            </div>
          ))}
        </div>
      </Scroll>
    </div>
  );
}

// ── EVENT edit / create (pushed) ─────────────────────────────────────────────────
export function EventEdit({ ev, isNew }: { ev?: PoEvent; isNew?: boolean }): JSX.Element {
  const nav = useNav();
  const qc = useQueryClient();
  const { currentVenue } = useSession();
  const [name, setName] = useState(isNew ? '' : ev?.name ?? '');
  const [startsAt, setStartsAt] = useState(toLocalInput(ev?.startsAtISO));
  const [endsAt, setEndsAt] = useState(toLocalInput(ev?.endsAtISO));
  const [landing, setLanding] = useState(false);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canSave = name.trim().length > 0 && startsAt.length > 0 && Boolean(currentVenue);

  async function save(): Promise<void> {
    if (!canSave || busy) return;
    setBusy(true);
    setErr(null);
    const start = new Date(startsAt);
    const end = endsAt ? new Date(endsAt) : null;
    const res = isNew
      ? await createEvent({
          venueId: currentVenue!.id,
          name,
          startsAt: start,
          endsAt: end,
          landingActive: landing,
        })
      : await updateEvent({ eventId: ev!.id, name, startsAt: start, endsAt: end });
    setBusy(false);
    if (!res.ok) {
      setErr(res.message);
      return;
    }
    await qc.invalidateQueries({ queryKey: ['po', 'events'] });
    nav.back();
  }

  return (
    <div className={col}>
      <Top onBack={nav.back} title={isNew ? 'Nieuw event' : 'Event bewerken'} />
      <Scroll bottom={120}>
        <Label className="mb-2">Naam</Label>
        <Field placeholder="bv. FRENZY" value={name} onChange={setName} className="mb-[14px]" />
        <Label className="mb-2">Venue</Label>
        <div className="mb-[14px] flex items-center gap-[10px] rounded-[14px] border border-line bg-elev px-[14px] py-3 text-[15px] text-dim">
          <Icon name="building" size={17} className="text-faint" />
          {currentVenue?.name ?? 'Geen venue geselecteerd'}
        </div>
        <Label className="mb-2">Deur open</Label>
        <input
          type="datetime-local"
          className={cn(dtField, 'mb-[14px]')}
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
        />
        <Label className="mb-2">Einde (optioneel)</Label>
        <input
          type="datetime-local"
          className={cn(dtField, 'mb-[18px]')}
          value={endsAt}
          onChange={(e) => setEndsAt(e.target.value)}
        />
        <button
          type="button"
          onClick={() => ev?.id && nav.push('tiers', { id: ev.id })}
          disabled={isNew}
          className="mb-[18px] flex w-full items-center gap-[13px] rounded-[14px] border border-line bg-elev px-[14px] py-[15px] text-left transition-colors hover:bg-white/[0.03] disabled:opacity-50"
        >
          <span className="flex h-[38px] w-[38px] items-center justify-center rounded-[11px] border border-line bg-elev2 text-acc">
            <Icon name="ticket" size={18} />
          </span>
          <span className="flex-1">
            <span className="block font-body text-[15px] font-semibold text-text">Tiers & aliassen</span>
            <span className="mt-px block text-[12.5px] text-faint">
              {isNew ? 'Bewaar het event eerst' : 'Voeden de quick-add'}
            </span>
          </span>
          <Icon name="chev" size={18} className="text-ghost" />
        </button>

        <Label className="mb-[10px]">Landingpage</Label>
        <div className="mb-[18px] rounded-[16px] border border-line bg-elev px-[14px] py-1">
          <ToggleRow title="Aanvraaglink actief" sub="Gasten kunnen zich aanmelden via de link" on={landing} set={setLanding} last />
        </div>

        <Label className="mb-[10px]">Aan de deur</Label>
        <div className="rounded-[16px] border border-line bg-elev px-[14px] py-1">
          <ToggleRow title="Lijst vergrendelen" sub={locked ? 'Staff kan niet meer muteren — admin/host/deur wel' : 'Typisch bij deuropening'} on={locked} set={setLocked} last />
        </div>

        {err && <p className="mt-3 text-[13px] text-acc-soft">{err}</p>}
      </Scroll>
      <BottomBar>
        <Btn kind="primary" full icon="check" onClick={save} className={canSave && !busy ? '' : 'opacity-50'}>
          {busy ? 'Bezig…' : isNew ? 'Event aanmaken' : 'Opslaan'}
        </Btn>
      </BottomBar>
    </div>
  );
}

// ── TIERS & aliases (pushed) ─────────────────────────────────────────────────────
export function Tiers({ eventId }: { eventId?: string }): JSX.Element {
  const nav = useNav();
  const qc = useQueryClient();
  const { tiers: liveTiers, isLoading } = usePoTiers(eventId);
  const [adding, setAdding] = useState(false);
  const [nm, setNm] = useState('');
  const [color, setColor] = useState('#9DE0C0');
  const [max, setMax] = useState('');
  const [price, setPrice] = useState('');
  const [aliasText, setAliasText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const colors = ['#B5A6FF', '#9DE0C0', '#E8C98A', '#9FB8E8', '#E89AC0', '#8E8E93'];

  async function createNewTier(): Promise<void> {
    if (!eventId || !nm.trim() || busy) return;
    setBusy(true);
    setErr(null);
    const aliases = aliasText
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    const res = await createTier({
      eventId,
      name: nm,
      color,
      maxGuests: max.trim() ? Number(max) : null,
      aliases,
    });
    setBusy(false);
    if (!res.ok) {
      setErr(res.message);
      return;
    }
    await qc.invalidateQueries({ queryKey: ['po', 'tiers', eventId] });
    setNm('');
    setMax('');
    setPrice('');
    setAliasText('');
    setAdding(false);
  }

  return (
    <div className={col}>
      <Top onBack={nav.back} title="Tiers & aliassen" sub={`${liveTiers.length} tiers`} right={<IconBtn name={adding ? 'close' : 'plus'} onClick={() => setAdding((a) => !a)} />} />
      <Scroll bottom={adding ? 120 : 24}>
        {adding && (
          <div className="mb-[14px] rounded-[18px] border border-acc bg-elev p-4">
            <Label className="mb-[10px]">Nieuwe tier</Label>
            <Field placeholder="Naam, bv. “Backstage”" value={nm} onChange={setNm} autoFocus className="mb-3" />
            <Label className="mb-2">Kleur</Label>
            <div className="mb-[14px] flex gap-[9px]">
              {colors.map((c) => (
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
            <div className="mb-[14px] flex gap-[10px]">
              <div className="flex-1">
                <Label className="mb-2">Max (optioneel)</Label>
                <Field placeholder="∞" value={max} onChange={setMax} inputMode="numeric" />
              </div>
              <div className="flex-1">
                <Label className="mb-2">Deurprijs €</Label>
                <Field placeholder="0" value={price} onChange={setPrice} inputMode="numeric" />
              </div>
            </div>
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
            {err && <p className="mt-3 text-[13px] text-acc-soft">{err}</p>}
          </div>
        )}
        <Note icon="spark">Aliassen bepalen wat de quick-add herkent. “fles” of “champagne” → VIP. Onbekende woorden vraagt de app na — nooit stil naar Regular.</Note>
        {isLoading && liveTiers.length === 0 && (
          <p className="px-1 py-4 text-[13px] text-dim">Laden…</p>
        )}
        {!isLoading && liveTiers.length === 0 && !adding && (
          <p className="px-1 py-4 text-[13px] text-dim">Nog geen tiers — tik op + om er een toe te voegen.</p>
        )}
        <div className="flex flex-col gap-[11px]">
          {liveTiers.map((t) => (
            <div key={t.id} className="rounded-[18px] border border-line bg-elev p-[15px]">
              <div className="mb-3 flex items-center gap-[11px]">
                <span className="h-[14px] w-[14px] shrink-0 rounded-full" style={{ background: t.color }} />
                <div className="min-w-0 flex-1">
                  <div className="font-display text-[15.5px] font-bold text-text">{t.name}</div>
                  <div className="mt-px text-[12px] text-faint">
                    {t.max ? `${t.used} / ${t.max} gebruikt` : `${t.used} · geen max`}
                    {t.doorPrice > 0 && ` · € ${t.doorPrice} aan de deur`}
                  </div>
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
                <button type="button" className="inline-flex items-center gap-1 rounded-[8px] border border-dashed border-line bg-transparent px-[9px] py-[5px] font-body text-[12px] text-faint">
                  <Icon name="plus" size={12} sw={2.4} />
                  alias
                </button>
              </div>
              {t.doorPrice > 0 && (
                <div className="mt-3 flex items-center gap-2 border-t border-line2 pt-3">
                  <Icon name="money" size={16} className="text-faint" />
                  <span className="flex-1 text-[13px] text-dim">Deurprijs</span>
                  <span className="font-display font-bold text-text">€ {t.doorPrice}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </Scroll>
      {adding && (
        <BottomBar>
          <Btn kind="primary" full icon="check" onClick={createNewTier} className={nm.trim() && !busy ? '' : 'opacity-50'}>
            {busy ? 'Bezig…' : 'Tier aanmaken'}
          </Btn>
        </BottomBar>
      )}
    </div>
  );
}

// ── PAST EVENT recap (pushed) ────────────────────────────────────────────────────
export function PastEvent({ ev }: { ev?: PoEvent }): JSX.Element {
  const nav = useNav();
  const r = recap;
  const pct = Math.round((r.arrived / r.listed) * 100);
  const maxT = Math.max(...stats.perTier.map((x) => x.aangemeld));
  return (
    <div className={col}>
      <Top onBack={nav.back} title={ev ? ev.name : r.event} sub={`${ev ? ev.venue : r.venue} · ${r.date}`} right={<IconBtn name="share" />} />
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

        <Label className="mb-[10px]">Ingecheckt · {r.arrived}</Label>
        <div className="mb-4 rounded-[18px] border border-line bg-elev px-[14px] py-0.5">
          {r.checkedIn.map((g, i) => (
            <div key={g.name} className={cn('flex items-center gap-[12px] py-[11px]', i < r.checkedIn.length - 1 && 'border-b border-line2')}>
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
                {g.at}
              </span>
            </div>
          ))}
          <button type="button" className="w-full border-t border-line2 py-3 font-body text-[13.5px] font-bold text-dim transition-[filter] hover:brightness-[1.2]">
            Toon alle {r.arrived} ingecheckt
          </button>
        </div>

        <Label className="mb-[10px]">Niet verschenen · {r.noShow}</Label>
        <div className="mb-[18px] rounded-[18px] border border-line bg-elev px-[14px] py-0.5">
          {r.noShows.map((g, i) => (
            <div key={g.name} className={cn('flex items-center gap-[12px] py-[11px] opacity-[0.72]', i < r.noShows.length - 1 && 'border-b border-line2')}>
              <Avatar name={g.name} size={36} />
              <div className="min-w-0 flex-1">
                <div className="font-display text-[14.5px] font-bold text-dim">
                  {g.name}
                  {g.plus > 0 && <span className="font-semibold text-faint"> +{g.plus}</span>}
                </div>
                <div className="mt-[3px] text-[12px] text-faint">toegevoegd door {g.by}</div>
              </div>
              <span className="text-[12px] font-bold text-faint">no-show</span>
            </div>
          ))}
          <button type="button" className="w-full border-t border-line2 py-3 font-body text-[13.5px] font-bold text-dim transition-[filter] hover:brightness-[1.2]">
            Toon alle {r.noShow} no-shows
          </button>
        </div>

        <Label className="mb-[10px]">Opkomst per tier</Label>
        <div className="mb-[14px] rounded-[18px] border border-line bg-elev p-4">
          {stats.perTier.map((t, i) => (
            <div key={t.tier} className={i < stats.perTier.length - 1 ? 'mb-[13px]' : ''}>
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
          ))}
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
          <Btn kind="dark" full icon="users" onClick={() => nav.push('lijst', { id: ev?.id ?? 'warehouse' })}>
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
  const upcoming = events.filter((e) => e.when === 'upcoming');
  const past = events.filter((e) => e.when === 'past');
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
        <Label className="mb-[10px]">Komende events · {upcoming.length}</Label>
        <div className="mb-5 flex flex-col gap-[9px]">{upcoming.map((e) => evRow(e, false))}</div>
        <Label className="mb-[10px]">Afgelopen</Label>
        <div className="flex flex-col gap-[9px]">{past.map((e) => evRow(e, true))}</div>
      </Scroll>
    </div>
  );
}
