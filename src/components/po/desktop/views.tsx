'use client';

/** Desktop views: Dashboard-home, Statistieken, Audit log, Events, Gebruikers.
 *  Recreated from `dash.jsx` (PLUSONE tokens). Home/Events/Audit/Users read LIVE
 *  Supabase data via the desktop hooks; Statistieken stays mock until an
 *  aggregation backend exists (honest "Binnenkort" placeholder). */
import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { stats } from '@/lib/po/data';
import { usePoEvents } from '@/features/po/PoLiveProvider';
import { usePoAudit, usePoTeam } from '@/features/po/desktop-live';
import type { PoEvent } from '@/lib/po/types';
import { Icon, type IconName } from '../icon';
import { Avatar, Label } from '../kit';
import { ActionChip, DBtn, DCard, Tag } from './kit';

const pad = 'px-[34px] pb-10';

// Is this event's start in the current venue-local month? (KPI "deze maand").
function inCurrentMonth(e: PoEvent, now: Date): boolean {
  if (!e.startsAtISO) return false;
  const d = new Date(e.startsAtISO);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

// ── DASHBOARD HOME ────────────────────────────────────────────────────────────
export function Home(): JSX.Element {
  const { events, isLoading } = usePoEvents();
  const { entries: auditEntries } = usePoAudit();

  const now = new Date();
  const monthEvents = events.filter((e) => inCurrentMonth(e, now));
  const liveEvent = events.find((e) => e.accent) ?? null;
  // Aggregate the (RLS-scoped) guest/inside counts across this month's events.
  const totalGuests = monthEvents.reduce((a, e) => a + e.guests, 0);
  const totalInside = monthEvents.reduce((a, e) => a + e.inside, 0);

  const kpis: { v: string; l: string; s: string; ic: IconName; acc?: boolean; warn?: boolean }[] = [
    { v: String(monthEvents.length), l: 'Events deze maand', s: liveEvent ? '1 live nu' : 'geen live event', ic: 'cal' },
    { v: String(totalGuests), l: 'Gasten op de lijst', s: 'deze maand', ic: 'users', acc: true },
    { v: String(totalInside), l: 'Binnen nu', s: liveEvent ? `op ${liveEvent.name}` : '—', ic: 'check' },
  ];

  // Headline event for the live card: the live one, else the next upcoming.
  const headline = liveEvent ?? events.find((e) => e.when === 'upcoming') ?? null;
  const inn = headline?.inside ?? 0;
  const total = headline?.guests ?? 0;
  const pct = total > 0 ? inn / total : 0;

  return (
    <div className={cn('flex flex-col gap-[22px] pt-7', pad)}>
      <div className="grid grid-cols-3 gap-4">
        {kpis.map((k) => (
          <DCard key={k.l} className="p-5">
            <div className="flex items-start justify-between">
              <div className={cn('font-display text-[38px] font-extrabold leading-none tracking-[-0.02em]', k.acc ? 'text-acc' : 'text-text')}>{k.v}</div>
              <span className={cn('flex h-9 w-9 items-center justify-center rounded-[11px] border', k.warn ? 'border-transparent bg-acc-dim text-acc' : 'border-line bg-elev2 text-dim')}>
                <Icon name={k.ic} size={18} />
              </span>
            </div>
            <div className="mt-[14px] text-[14.5px] font-semibold text-text">{k.l}</div>
            <div className="mt-0.5 text-[12.5px] text-faint">{k.s}</div>
          </DCard>
        ))}
      </div>

      <div className="grid grid-cols-[1.55fr_1fr] gap-4">
        <DCard className="p-6">
          {headline ? (
            <>
              <div className="mb-5 flex items-center gap-3">
                {headline.accent ? (
                  <span className="inline-flex items-center gap-[7px] rounded-full bg-acc-dim px-[11px] py-[5px] font-body text-[12px] font-bold text-acc">
                    <span className="h-[7px] w-[7px] rounded-full bg-acc" />
                    LIVE
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-[7px] rounded-full border border-line px-[11px] py-[5px] font-body text-[12px] font-bold text-dim">
                    Eerstvolgend
                  </span>
                )}
                <div className="flex-1">
                  <div className="font-display text-[22px] font-extrabold tracking-[-0.02em] text-text">{headline.name}</div>
                  <div className="text-[13px] text-faint">
                    {headline.venue} · deur {headline.time}
                  </div>
                </div>
              </div>
              <div className="mb-[9px] flex justify-between">
                <Label>Opkomst</Label>
                <span className="font-display font-bold text-acc">
                  {inn} / {total} · {Math.round(pct * 100)}%
                </span>
              </div>
              <div className="mb-[22px] h-3 overflow-hidden rounded-[7px] bg-elev2">
                <div className="h-full rounded-[7px] bg-acc" style={{ width: pct * 100 + '%' }} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                {([[String(Math.max(0, total - inn)), 'Onderweg', false], [String(inn), 'Binnen', true], ['—', 'Geweigerd', false]] as const).map(([v, l, a]) => (
                  <div key={l} className={cn('rounded-[14px] border px-4 py-[14px]', a ? 'border-transparent bg-acc-dim' : 'border-line bg-elev2')}>
                    <div className={cn('font-display text-[24px] font-extrabold', a ? 'text-acc' : 'text-text')}>{v}</div>
                    <div className={cn('mt-0.5 text-[12.5px]', a ? 'text-dim' : 'text-faint')}>{l}</div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex min-h-[180px] items-center justify-center text-[13.5px] text-faint">
              {isLoading ? 'Laden…' : 'Geen events gepland'}
            </div>
          )}
        </DCard>

        <DCard className="flex flex-col p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="font-display text-[17px] font-bold text-text">Wacht op jou</div>
          </div>
          {/* TODO: approvals-aggregatie (quota- + landingpage-verzoeken) heeft nog
              geen desktop-hook — bewust geen verzonnen lijst. */}
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-[12px] border border-line bg-elev2 text-faint">
              <Icon name="bell" size={18} />
            </span>
            <div className="text-[13px] text-faint">Verzoeken verschijnen hier zodra de approvals-module live is.</div>
          </div>
        </DCard>
      </div>

      <DCard className="px-6 pb-3 pt-2">
        <div className="flex items-center justify-between py-2 pt-4">
          <div className="font-display text-[17px] font-bold text-text">Recente activiteit</div>
          <DBtn sm kind="ghost" icon="history">
            Volledig audit log
          </DBtn>
        </div>
        {auditEntries.length === 0 && (
          <div className="border-t border-line2 py-[13px] text-[13px] text-faint">Nog geen activiteit — of geen inzage (Admin/Finance + MFA vereist).</div>
        )}
        {auditEntries.slice(0, 5).map((a) => (
          <div key={a.id} className="-mx-2 flex items-center gap-[14px] border-t border-line2 px-2 py-[13px] transition-colors hover:bg-white/[0.025]">
            <Avatar name={a.actor} size={32} />
            <ActionChip action={a.action} />
            <div className="flex-1 text-[14px] text-text">
              <b className="font-bold">{a.actor}</b> {a.text}
            </div>
            <span className="whitespace-nowrap font-display text-[12.5px] text-faint">{a.when}</span>
          </div>
        ))}
      </DCard>
    </div>
  );
}

// ── STATISTIEKEN ──────────────────────────────────────────────────────────────
// NB: no aggregation backend exists yet (per-kwartier instroom, per-tier
// opkomst). This view stays on mock data behind the topbar "Binnenkort" pill —
// numbers are illustrative, NOT live. Wiring needs a stats RPC first.
export function Stats(): JSX.Element {
  const s = stats;
  const maxK = Math.max(...s.perKwartier.map((x) => x.n));
  const maxT = Math.max(...s.perTier.map((x) => x.aangemeld));
  return (
    <div className={cn('flex flex-col gap-[22px] pt-7', pad)}>
      <div className="rounded-[14px] border border-acc/40 bg-acc-dim px-[18px] py-[13px] text-[13px] text-acc-soft">
        Voorbeeldcijfers — de statistiek-aggregatie is nog niet aangesloten op live data.
      </div>
      <div className="grid grid-cols-4 gap-4">
        {([['72%', 'Gem. opkomst', '+6% vs vorige'], ['23:00', 'Piek instroom', '38 in 15 min'], ['6', 'Weigeringen', '1,4% van check-ins'], ['28%', 'No-show', '117 niet verschenen']] as const).map(([v, l, sub]) => (
          <DCard key={l} className="p-5">
            <div className="font-display text-[32px] font-extrabold tracking-[-0.02em] text-text">{v}</div>
            <div className="mt-[10px] text-[14px] font-semibold text-text">{l}</div>
            <div className="mt-0.5 text-[12.5px] text-faint">{sub}</div>
          </DCard>
        ))}
      </div>

      <DCard className="p-6">
        <div className="mb-[22px] flex items-center justify-between">
          <div>
            <div className="font-display text-[17px] font-bold text-text">Instroom per kwartier</div>
            <div className="mt-0.5 text-[12.5px] text-faint">Check-ins aan de deur · FRENZY</div>
          </div>
          <DBtn sm kind="ghost" icon="dl">
            Export CSV
          </DBtn>
        </div>
        <div className="flex h-[180px] items-end gap-[10px]">
          {s.perKwartier.map((b) => (
            <div key={b.t} className="flex flex-1 flex-col items-center gap-2">
              <div className="font-display text-[11px] font-bold text-dim">{b.n}</div>
              <div className={cn('w-full max-w-[38px] rounded-[7px] border', b.n === maxK ? 'border-transparent bg-acc' : 'border-line bg-elev2')} style={{ height: (b.n / maxK) * 130 }} />
              <div className="font-display text-[10.5px] text-faint">{b.t}</div>
            </div>
          ))}
        </div>
      </DCard>

      <div className="grid grid-cols-[1.3fr_1fr] gap-4">
        <DCard className="p-6">
          <div className="mb-5 font-display text-[17px] font-bold text-text">Aanwezig vs. aangemeld per tier</div>
          <div className="flex flex-col gap-4">
            {s.perTier.map((t) => (
              <div key={t.tier}>
                <div className="mb-[7px] flex justify-between">
                  <span className="text-[13.5px] font-semibold text-text">{t.tier}</span>
                  <span className="font-display text-[12.5px] text-faint">
                    <b className="text-acc">{t.binnen}</b> / {t.aangemeld}
                  </span>
                </div>
                <div className="relative h-[10px] overflow-hidden rounded-[6px] bg-elev2">
                  <div className="absolute inset-0 rounded-[6px] bg-white/[0.08]" style={{ width: (t.aangemeld / maxT) * 100 + '%' }} />
                  <div className="absolute inset-0 rounded-[6px] bg-acc" style={{ width: (t.binnen / maxT) * 100 + '%' }} />
                </div>
              </div>
            ))}
          </div>
        </DCard>
        <DCard className="p-6">
          <div className="mb-4 font-display text-[17px] font-bold text-text">Toevoegingen per gebruiker</div>
          <div className="flex flex-col">
            {s.perUser.map((u, i) => (
              <div key={u.who} className={cn('flex items-center gap-3 py-3', i < s.perUser.length - 1 && 'border-b border-line2')}>
                <Avatar name={u.who} size={34} />
                <div className="flex-1">
                  <div className="text-[13.5px] font-semibold text-text">{u.who}</div>
                  <div className="text-[11.5px] text-faint">
                    {u.in} binnen van {u.added}
                  </div>
                </div>
                <div className="font-display text-[20px] font-extrabold text-text">{u.added}</div>
              </div>
            ))}
          </div>
        </DCard>
      </div>
    </div>
  );
}

// ── AUDIT LOG ─────────────────────────────────────────────────────────────────
const AUDIT_GRID = 'grid-cols-[150px_130px_1fr_130px_110px]';
export function Audit(): JSX.Element {
  const { entries, isLoading, isError } = usePoAudit();
  const [f, setF] = useState('all');
  const [q, setQ] = useState('');
  const acts: [string, string][] = [
    ['all', 'Alle'],
    ['check_in', 'Check-ins'],
    ['quota_grant', 'Quotum'],
    ['tier_change', 'Tier'],
    ['approve', 'Goedkeuringen'],
    ['lock', 'Lock'],
  ];
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return entries.filter((r) => {
      if (f !== 'all' && r.action !== f) return false;
      if (term && !(`${r.actor} ${r.text} ${r.entity}`.toLowerCase().includes(term))) return false;
      return true;
    });
  }, [entries, f, q]);
  return (
    <div className={cn('pt-6', pad)}>
      <div className="mb-[18px] flex flex-wrap items-center gap-2">
        {acts.map(([k, l]) => (
          <button key={k} type="button" onClick={() => setF(k)} className={cn('cursor-pointer rounded-full border px-[15px] py-2 font-display text-[13px] font-bold transition-[filter] hover:brightness-[1.08]', f === k ? 'border-transparent bg-text text-bg' : 'border-line bg-transparent text-dim')}>
            {l}
          </button>
        ))}
        <div className="flex-1" />
        <div className="inline-flex min-w-[220px] items-center gap-2 rounded-[11px] border border-line bg-elev px-[13px] py-[9px] text-faint">
          <Icon name="search" size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek op gast, gebruiker…" className="flex-1 border-none bg-transparent text-[13.5px] text-text outline-none placeholder:text-faint" />
        </div>
      </div>
      <DCard className="overflow-hidden p-0">
        <div className={cn('grid border-b border-line bg-bg px-[22px] py-[13px]', AUDIT_GRID)}>
          {['Wie', 'Actie', 'Wat', 'Wanneer', 'Device'].map((h) => (
            <Label key={h}>{h}</Label>
          ))}
        </div>
        {isLoading && rows.length === 0 && (
          <div className="px-[22px] py-[18px] text-[13.5px] text-faint">Laden…</div>
        )}
        {!isLoading && isError && (
          <div className="px-[22px] py-[18px] text-[13.5px] text-acc-soft">Kon het audit log niet laden.</div>
        )}
        {!isLoading && !isError && rows.length === 0 && (
          <div className="px-[22px] py-[18px] text-[13.5px] text-faint">
            Geen audit-regels. Inzage vereist Admin/Finance + MFA (AAL2).
          </div>
        )}
        {rows.map((a, i) => (
          <div key={a.id} className={cn('grid items-center px-[22px] py-[14px] transition-colors hover:bg-white/[0.025]', AUDIT_GRID, i < rows.length - 1 && 'border-b border-line2')}>
            <div className="flex items-center gap-[10px]">
              <Avatar name={a.actor} size={30} />
              <span className="text-[13.5px] font-semibold text-text">{a.actor}</span>
            </div>
            <div>
              <ActionChip action={a.action} />
            </div>
            <div className="pr-4 text-[14px] text-dim">{a.text}</div>
            <div className="font-display text-[13px] text-faint">{a.when}</div>
            <div className="flex items-center gap-1.5 text-[12px] text-faint">
              <span className={cn('h-1.5 w-1.5 rounded-full', a.device.includes('deur') ? 'bg-acc' : 'bg-ghost')} />
              {a.device}
            </div>
          </div>
        ))}
      </DCard>
      <div className="mt-4 flex items-center gap-2 text-[12.5px] text-faint">
        <Icon name="shield" size={14} className="text-faint" />
        Append-only · geschreven door database-triggers, nooit door app-code (#15). Inzage vereist Admin/Finance + MFA.
      </div>
    </div>
  );
}

// ── EVENTS ────────────────────────────────────────────────────────────────────
const EVENT_GRID = 'grid-cols-[1.5fr_1fr_110px_130px_120px_40px]';
export function Events({ onSelect }: { onSelect?: (eventId: string) => void }): JSX.Element {
  const { events, isLoading } = usePoEvents();
  return (
    <div className={cn('pt-6', pad)}>
      <DCard className="overflow-hidden p-0">
        <div className={cn('grid border-b border-line bg-bg px-[22px] py-[13px]', EVENT_GRID)}>
          {['Event', 'Venue', 'Gasten', 'Landingpage', 'Status', ''].map((h, i) => (
            <Label key={i}>{h}</Label>
          ))}
        </div>
        {isLoading && events.length === 0 && (
          <div className="px-[22px] py-[18px] text-[13.5px] text-faint">Laden…</div>
        )}
        {!isLoading && events.length === 0 && (
          <div className="px-[22px] py-[18px] text-[13.5px] text-faint">Nog geen events voor deze venue.</div>
        )}
        {events.map((e, i) => (
          <button
            type="button"
            key={e.id}
            onClick={() => onSelect?.(e.id)}
            className={cn('grid w-full cursor-pointer items-center px-[22px] py-4 text-left transition-colors hover:bg-white/[0.025]', EVENT_GRID, i < events.length - 1 && 'border-b border-line2')}
          >
            <div className="flex items-center gap-[14px]">
              <div className="w-[46px] shrink-0 text-center">
                <div className={cn('font-display text-[20px] font-extrabold leading-none', e.accent ? 'text-acc' : 'text-text')}>{e.date}</div>
                <div className="text-[10px] font-bold tracking-[0.05em] text-faint">{e.mon}</div>
              </div>
              <div>
                <div className="font-display text-[15.5px] font-bold text-text">{e.name}</div>
                <div className="text-[12px] text-faint">deur {e.time}</div>
              </div>
            </div>
            <div className="text-[13.5px] text-dim">{e.venue}</div>
            <div className="font-display text-[15px] font-bold text-text">{e.guests}</div>
            <div>
              {e.when === 'upcoming' ? (
                <span className="inline-flex items-center gap-1.5 font-body text-[12px] font-bold text-acc">
                  <span className="h-[7px] w-[7px] rounded-full bg-acc" />
                  Actief
                </span>
              ) : (
                <span className="text-[12px] text-faint">Gesloten</span>
              )}
            </div>
            <div>{e.when === 'past' ? <Tag t="Closed" /> : e.accent ? <Tag t="Live" acc /> : <Tag t="Open" />}</div>
            <div className="text-ghost">
              <Icon name="chev" size={18} />
            </div>
          </button>
        ))}
      </DCard>
    </div>
  );
}

// ── GEBRUIKERS ────────────────────────────────────────────────────────────────
const USER_GRID = 'grid-cols-[1.4fr_1.4fr_130px_110px_40px]';
export function Users(): JSX.Element {
  const { team, invites, isLoading } = usePoTeam();
  return (
    <div className={cn('flex flex-col gap-[22px] pt-6', pad)}>
      <DCard className="overflow-hidden p-0">
        <div className={cn('grid border-b border-line bg-bg px-[22px] py-[13px]', USER_GRID)}>
          {['Gebruiker', 'Rollen', 'Quotum', 'Beveiliging', ''].map((h, i) => (
            <Label key={i}>{h}</Label>
          ))}
        </div>
        {isLoading && team.length === 0 && (
          <div className="px-[22px] py-[18px] text-[13.5px] text-faint">Laden…</div>
        )}
        {!isLoading && team.length === 0 && (
          <div className="px-[22px] py-[18px] text-[13.5px] text-faint">Nog geen teamleden voor deze venue.</div>
        )}
        {team.map((t, i) => (
          <div key={t.name} className={cn('grid items-center px-[22px] py-[15px] transition-colors hover:bg-white/[0.025]', USER_GRID, i < team.length - 1 && 'border-b border-line2')}>
            <div className="flex items-center gap-3">
              <Avatar name={t.name} size={36} />
              <div>
                <div className="font-display text-[14.5px] font-bold text-text">{t.name}</div>
                <div className="text-[12px] text-faint">{t.role}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(t.roleChips.length ? t.roleChips : ['Staff']).map((r) => (
                <span key={r} className="whitespace-nowrap rounded-[7px] border border-line bg-elev2 px-[9px] py-1 font-body text-[11.5px] font-bold text-dim">
                  {r}
                </span>
              ))}
            </div>
            <div className="text-[13.5px] text-dim">{t.allow}</div>
            <div>
              {t.mfa ? (
                <span className="inline-flex items-center gap-[5px] font-body text-[12px] font-bold text-acc">
                  <Icon name="shield" size={13} stroke="#B5A6FF" />
                  MFA aan
                </span>
              ) : (
                <span className="text-[12px] text-faint">OTP</span>
              )}
            </div>
            <div className="text-ghost">
              <Icon name="chev" size={18} />
            </div>
          </div>
        ))}
      </DCard>
      <div>
        <Label className="mb-3">Openstaande uitnodigingen</Label>
        {invites.length === 0 ? (
          <div className="rounded-[16px] border border-dashed border-line bg-elev px-[18px] py-[14px] text-[13px] text-faint">
            Geen openstaande uitnodigingen.
          </div>
        ) : (
          <div className="flex flex-col gap-[10px]">
            {invites.map((iv) => (
              <DCard key={iv.email} className="flex items-center gap-[14px] border-dashed px-[18px] py-[14px]">
                <span className="flex h-[38px] w-[38px] items-center justify-center rounded-[11px] border border-line bg-elev2 text-faint">
                  <Icon name="user" size={18} />
                </span>
                <div className="flex-1">
                  <div className="text-[14px] font-semibold text-text">{iv.email}</div>
                  <div className="text-[12px] text-faint">
                    {iv.roles.join(', ')} · verstuurd {iv.at}
                  </div>
                </div>
                <span className="whitespace-nowrap rounded-[8px] border border-line px-[11px] py-[5px] text-[11.5px] font-bold text-faint">Wacht op acceptatie</span>
                <DBtn sm kind="ghost">
                  Opnieuw sturen
                </DBtn>
              </DCard>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
