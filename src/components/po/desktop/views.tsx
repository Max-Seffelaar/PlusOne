'use client';

/** Desktop views: Dashboard-home, Statistieken, Audit log, Events, Gebruikers.
 *  Recreated from `dash.jsx` (PLUSONE tokens). Reads the shared mock data. */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { audit, events, guestRequests, invites, quotaRequests, team } from '@/lib/po/data';
import { Icon, type IconName } from '../icon';
import { Avatar, Label } from '../kit';
import { ActionChip, DBtn, DCard, MiniIconBtn, Tag } from './kit';

const pad = 'px-[34px] pb-10';

// ── DASHBOARD HOME ────────────────────────────────────────────────────────────
export function Home(): JSX.Element {
  const kpis: { v: string; l: string; s: string; ic: IconName; acc?: boolean; warn?: boolean }[] = [
    { v: '4', l: 'Events deze maand', s: '1 live vanavond', ic: 'cal' },
    { v: '415', l: 'Gasten op de lijst', s: '+38 vandaag', ic: 'users', acc: true },
    { v: '125', l: 'Binnen vanavond', s: 'van 415 verwacht', ic: 'check' },
    { v: '7', l: 'Open verzoeken', s: '3 quotum · 4 aanvragen', ic: 'bell', warn: true },
  ];
  const ev = events[0];
  const inn = 125;
  const total = 415;
  const pct = inn / total;
  return (
    <div className={cn('flex flex-col gap-[22px] pt-7', pad)}>
      <div className="grid grid-cols-4 gap-4">
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
          <div className="mb-5 flex items-center gap-3">
            <span className="inline-flex items-center gap-[7px] rounded-full bg-acc-dim px-[11px] py-[5px] font-body text-[12px] font-bold text-acc">
              <span className="h-[7px] w-[7px] rounded-full bg-acc" />
              LIVE
            </span>
            <div className="flex-1">
              <div className="font-display text-[22px] font-extrabold tracking-[-0.02em] text-text">{ev.name}</div>
              <div className="text-[13px] text-faint">
                {ev.venue} · deur {ev.time}
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-[10px] border border-line px-3 py-1.5 font-body text-[12.5px] font-bold text-dim">
              <Icon name="lock" size={14} stroke="#B5A6FF" />
              Lijst vergrendeld
            </span>
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
            {([['290', 'Onderweg', false], ['125', 'Binnen', true], ['6', 'Geweigerd', false]] as const).map(([v, l, a]) => (
              <div key={l} className={cn('rounded-[14px] border px-4 py-[14px]', a ? 'border-transparent bg-acc-dim' : 'border-line bg-elev2')}>
                <div className={cn('font-display text-[24px] font-extrabold', a ? 'text-acc' : 'text-text')}>{v}</div>
                <div className={cn('mt-0.5 text-[12.5px]', a ? 'text-dim' : 'text-faint')}>{l}</div>
              </div>
            ))}
          </div>
        </DCard>

        <DCard className="flex flex-col p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="font-display text-[17px] font-bold text-text">Wacht op jou</div>
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-acc px-[7px] font-display text-[13px] font-extrabold text-on-acc">7</span>
          </div>
          <div className="flex flex-1 flex-col gap-[10px]">
            {quotaRequests.slice(0, 2).map((r) => (
              <div key={r.id} className="flex items-center gap-[11px]">
                <Avatar name={r.who} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold text-text">{r.who}</div>
                  <div className="text-[11.5px] text-faint">
                    quotum {r.current}→{r.want}
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <MiniIconBtn name="check" accent />
                  <MiniIconBtn name="close" />
                </div>
              </div>
            ))}
            {guestRequests.slice(0, 2).map((r) => (
              <div key={r.id} className="flex items-center gap-[11px]">
                <Avatar name={r.name} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold text-text">
                    {r.name}
                    {r.plus > 0 && <span className="text-faint"> +{r.plus}</span>}
                  </div>
                  <div className="text-[11.5px] text-faint">landingpage-aanvraag</div>
                </div>
                <div className="flex gap-1.5">
                  <MiniIconBtn name="check" accent />
                  <MiniIconBtn name="close" />
                </div>
              </div>
            ))}
          </div>
          <DBtn kind="ghost" className="mt-4 w-full justify-center">
            Alle verzoeken
          </DBtn>
        </DCard>
      </div>

      <DCard className="px-6 pb-3 pt-2">
        <div className="flex items-center justify-between py-2 pt-4">
          <div className="font-display text-[17px] font-bold text-text">Recente activiteit</div>
          <DBtn sm kind="ghost" icon="history">
            Volledig audit log
          </DBtn>
        </div>
        {audit.slice(0, 5).map((a) => (
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

// ── AUDIT LOG ─────────────────────────────────────────────────────────────────
const AUDIT_GRID = 'grid-cols-[150px_130px_1fr_130px_110px]';
export function Audit(): JSX.Element {
  const [f, setF] = useState('all');
  const acts: [string, string][] = [
    ['all', 'Alle'],
    ['check_in', 'Check-ins'],
    ['quota_grant', 'Quotum'],
    ['tier_change', 'Tier'],
    ['approve', 'Goedkeuringen'],
    ['lock', 'Lock'],
  ];
  const rows = f === 'all' ? audit : audit.filter((r) => r.action === f);
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
          <input placeholder="Zoek op gast, gebruiker…" className="flex-1 border-none bg-transparent text-[13.5px] text-text outline-none placeholder:text-faint" />
        </div>
      </div>
      <DCard className="overflow-hidden p-0">
        <div className={cn('grid border-b border-line bg-bg px-[22px] py-[13px]', AUDIT_GRID)}>
          {['Wie', 'Actie', 'Wat', 'Wanneer', 'Device'].map((h) => (
            <Label key={h}>{h}</Label>
          ))}
        </div>
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
export function Events(): JSX.Element {
  return (
    <div className={cn('pt-6', pad)}>
      <DCard className="overflow-hidden p-0">
        <div className={cn('grid border-b border-line bg-bg px-[22px] py-[13px]', EVENT_GRID)}>
          {['Event', 'Venue', 'Gasten', 'Landingpage', 'Status', ''].map((h, i) => (
            <Label key={i}>{h}</Label>
          ))}
        </div>
        {events.map((e, i) => (
          <div key={e.id} className={cn('grid cursor-pointer items-center px-[22px] py-4 transition-colors hover:bg-white/[0.025]', EVENT_GRID, i < events.length - 1 && 'border-b border-line2')}>
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
          </div>
        ))}
      </DCard>
    </div>
  );
}

// ── GEBRUIKERS ────────────────────────────────────────────────────────────────
const USER_GRID = 'grid-cols-[1.4fr_1.4fr_130px_110px_40px]';
const ROLE_MAP: Record<string, string[]> = {
  Eigenaar: ['Admin', 'Finance'],
  Manager: ['User manager', 'Organisator'],
  Host: ['Doorhost', 'Staff'],
  Promotor: ['Staff'],
};
export function Users(): JSX.Element {
  return (
    <div className={cn('flex flex-col gap-[22px] pt-6', pad)}>
      <DCard className="overflow-hidden p-0">
        <div className={cn('grid border-b border-line bg-bg px-[22px] py-[13px]', USER_GRID)}>
          {['Gebruiker', 'Rollen', 'Quotum', 'Beveiliging', ''].map((h, i) => (
            <Label key={i}>{h}</Label>
          ))}
        </div>
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
              {(ROLE_MAP[t.role] ?? ['Staff']).map((r) => (
                <span key={r} className="whitespace-nowrap rounded-[7px] border border-line bg-elev2 px-[9px] py-1 font-body text-[11.5px] font-bold text-dim">
                  {r}
                </span>
              ))}
            </div>
            <div className="text-[13.5px] text-dim">
              {t.allow}
              {t.max ? ' · ' + t.used + ' gebruikt' : ''}
            </div>
            <div>
              {t.role === 'Eigenaar' ? (
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
      </div>
    </div>
  );
}
