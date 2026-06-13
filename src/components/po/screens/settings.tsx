'use client';

/** Settings cluster: Meer (hub), gebruikers/rollen, toelage, venue switch/beheer,
 *  persoonlijke gegevens + sessies, abonnement & facturen, importeren. */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { account, allowance as allowanceData, invites, invoices, profile, sessions, subscription, team, venues } from '@/lib/po/data';
import type { Venue } from '@/lib/po/types';
import { useNav, usePo } from '../context';
import { Icon, type IconName } from '../icon';
import { Avatar, Btn, Field, IconBtn, Label, MiniChip, Note, Row, Scroll, ToggleRow, Top } from '../kit';
import { BottomBar } from '../shell';

const press = 'transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]';
const cardPress = 'transition-[border-color,transform] hover:border-white/[0.24] active:scale-[0.99]';
const col = 'flex h-full flex-col';
const iconSm = 'flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] border border-line text-faint';

// ── MEER (settings tab) ──────────────────────────────────────────────────────
export function Meer(): JSX.Element {
  const nav = useNav();
  const { venue } = usePo();
  const v = venue;
  return (
    <div className={col}>
      <Top big title="Instellingen" />
      <Scroll bottom={100}>
        <button type="button" onClick={() => nav.push('venueswitch')} className={cn('mb-5 flex w-full items-center gap-[14px] rounded-[18px] border border-line bg-elev p-4 text-left', cardPress)}>
          <Avatar name={v.name} size={48} accent />
          <div className="min-w-0 flex-1">
            <div className="font-display text-[18px] font-bold text-text">{v.name}</div>
            <div className="text-[12.5px] text-faint">{account.user} · wissel van venue</div>
          </div>
          <span className="inline-flex items-center gap-[7px]">
            <span className="rounded-full bg-acc px-[11px] py-[5px] font-display text-[11px] font-bold text-on-acc">{v.plan}</span>
            <span className="text-ghost">
              <Icon name="swap" size={18} />
            </span>
          </span>
        </button>
        <Label className="mb-1">Jouw bedrijf</Label>
        <Row
          icon="bell"
          title="Aanvragen & verzoeken"
          sub="3 quotum-verzoeken · 4 landingpage-aanvragen"
          onClick={() => nav.push('aanvragen')}
          accent
          right={<span className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-acc px-1.5 font-display text-[12px] font-extrabold text-on-acc">7</span>}
        />
        <Row icon="user" title="Persoonlijke gegevens" sub="Profiel, e-mail & sessies" onClick={() => nav.push('profile')} />
        <Row icon="cal" title="Events & tiers" sub="Events aanmaken, tiers en aliassen" onClick={() => nav.push('eventbeheer')} />
        <Row icon="building" title="Venues" sub={`${venues.length} locaties · wisselen`} onClick={() => nav.push('venueswitch')} />
        <Row icon="cog" title="Venue beheren" sub="Naam, AVG-bewaartermijn, standaarden" onClick={() => nav.push('venuesettings')} />
        <Row icon="users" title="Gebruikers" sub="Uitnodigen, rollen en MFA" onClick={() => nav.push('gebruikers')} accent />
        <Row icon="ticket" title="Toelage per event" sub="Gasten-per-event per teamlid" onClick={() => nav.push('allowance')} />
        <Row icon="star" title="Permanente gasten" sub="12 gasten staan altijd op de lijst" onClick={() => nav.push('vaste')} accent />
        <Row icon="contact" title="Adresboek" sub="1.284 opgeslagen contacten" onClick={() => nav.push('contacten')} accent />
        <Row icon="upload" title="Importeren" sub="Plak, CSV of telefooncontacten" onClick={() => nav.push('import')} />
        <Label className="mb-1 mt-[22px]">Abonnement</Label>
        <Row icon="spark" title="Abonnement & facturen" sub="Premium · €49 / maand" onClick={() => nav.push('billing')} accent right={<Icon name="chev" size={18} className="text-ghost" />} />
      </Scroll>
    </div>
  );
}

// ── GEBRUIKERS (pushed) ──────────────────────────────────────────────────────
export function Gebruikers(): JSX.Element {
  const nav = useNav();
  const [invite, setInvite] = useState(false);
  const [email, setEmail] = useState('');
  const [roles, setRoles] = useState<string[]>(['staff']);
  const [venueFlow, setVenueFlow] = useState(false);
  const isPlatformAdmin = true; // mock: huidige user is platform super-admin (#40b)
  const allRoles: [string, string][] = [
    ['admin', 'Admin'],
    ['user_manager', 'User manager'],
    ['finance', 'Finance'],
    ['organizer', 'Organisator'],
    ['staff', 'Staff'],
    ['doorhost', 'Doorhost'],
  ];
  const toggleRole = (r: string): void => setRoles((s) => (s.includes(r) ? s.filter((x) => x !== r) : [...s, r]));
  const sensitive = roles.includes('admin') || roles.includes('finance');

  if (invite) {
    return (
      <div className={col}>
        <Top onBack={() => setInvite(false)} title="Gebruiker uitnodigen" />
        <Scroll bottom={120}>
          <Label className="mb-2">E-mailadres</Label>
          <Field icon="contact" placeholder="naam@venue.nl" value={email} onChange={setEmail} inputMode="email" autoFocus className="mb-[18px]" />
          <Label className="mb-[10px]">Rollen · meerdere mogelijk</Label>
          <div className="flex flex-col gap-2">
            {allRoles.map(([k, l]) => {
              const on = roles.includes(k);
              return (
                <button key={k} type="button" onClick={() => toggleRole(k)} className={cn('flex items-center gap-[12px] rounded-[13px] border px-[14px] py-[13px] text-left', on ? 'border-transparent bg-acc-dim' : 'border-line bg-elev', press)}>
                  <span className={cn('flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] border-2', on ? 'border-acc bg-acc' : 'border-ghost bg-transparent')}>{on && <Icon name="check" size={13} stroke="#16132B" sw={3} />}</span>
                  <span className="flex-1 font-display text-[14.5px] font-bold text-text">{l}</span>
                </button>
              );
            })}
          </div>
          {sensitive && (
            <Note icon="shield">
              Admin en Finance krijgen <b>verplichte MFA</b>. Bij eerste login stelt de gebruiker een authenticator-app in.
            </Note>
          )}
          {isPlatformAdmin && (
            <>
              <Label className="mb-[10px] mt-[18px]">Platform (super-admin)</Label>
              <div className="rounded-[18px] border border-line bg-elev px-4 py-1">
                <ToggleRow title="Direct naar venue-aanmaak" sub="Na de eerste OTP-login belandt deze gebruiker meteen in de venue-aanmaakflow (#40b)" on={venueFlow} set={setVenueFlow} last />
              </div>
            </>
          )}
        </Scroll>
        <BottomBar>
          <Btn kind="primary" full icon="arrowR" onClick={() => setInvite(false)} className={/.+@.+\..+/.test(email) && roles.length ? '' : 'opacity-[0.45]'}>
            Verstuur uitnodiging
          </Btn>
        </BottomBar>
      </div>
    );
  }

  return (
    <div className={col}>
      <Top onBack={nav.back} title="Gebruikers" sub={`${team.length} teamleden · ${invites.length} uitnodigingen open`} right={<IconBtn name="plus" onClick={() => setInvite(true)} />} />
      <Scroll bottom={24}>
        <Btn kind="dark" full icon="plus" className="mb-[18px]" onClick={() => setInvite(true)}>
          Gebruiker uitnodigen
        </Btn>
        <Label className="mb-[10px]">Team</Label>
        <div className="mb-5 flex flex-col gap-[9px]">
          {team.map((t) => (
            <div key={t.name} className="flex items-center gap-[12px] rounded-[16px] border border-line bg-elev p-[13px]">
              <Avatar name={t.name} size={42} />
              <div className="min-w-0 flex-1">
                <div className="font-display text-[15px] font-bold text-text">{t.name}</div>
                <div className="mt-0.5 text-[12px] text-faint">
                  {t.role} · quotum {t.allow}
                </div>
              </div>
              {t.role === 'Eigenaar' && (
                <MiniChip className="border-transparent bg-acc-dim text-acc">
                  <Icon name="shield" size={11} stroke="#B5A6FF" />
                  MFA
                </MiniChip>
              )}
              <button type="button" className={cn(iconSm, press)}>
                <Icon name="dots" size={16} />
              </button>
            </div>
          ))}
        </div>
        <Label className="mb-[10px]">Openstaande uitnodigingen</Label>
        <div className="flex flex-col gap-[9px]">
          {invites.map((iv) => (
            <div key={iv.email} className="flex items-center gap-[12px] rounded-[16px] border border-dashed border-line bg-elev p-[13px]">
              <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[13px] border border-line bg-elev2 text-faint">
                <Icon name="contact" size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="overflow-hidden text-ellipsis whitespace-nowrap font-body text-[14px] font-semibold text-text">{iv.email}</div>
                <div className="mt-0.5 text-[12px] text-faint">verstuurd {iv.at} · wacht op acceptatie</div>
              </div>
              <MiniChip onClick={() => undefined}>Opnieuw</MiniChip>
            </div>
          ))}
        </div>
      </Scroll>
    </div>
  );
}

// ── ROLLEN & TOELAGES (pushed) ───────────────────────────────────────────────
export function Rollen(): JSX.Element {
  const nav = useNav();
  return (
    <div className={col}>
      <Top onBack={nav.back} title="Gebruikers & toelages" />
      <Scroll bottom={24}>
        <div className="mb-4 text-[13.5px] leading-[1.5] text-faint">Elk teamlid mag standaard een aantal gasten per event toevoegen. Per event op te hogen.</div>
        <div className="mb-[22px] flex flex-col gap-[11px]">
          {team.map((t) => (
            <div key={t.name} className="rounded-[16px] border border-line bg-elev p-[14px]">
              <div className="mb-3 flex items-center gap-[12px]">
                <Avatar name={t.name} size={40} />
                <div className="flex-1">
                  <div className="font-display text-[15.5px] font-bold text-text">{t.name}</div>
                  <div className="text-[12px] text-faint">{t.role}</div>
                </div>
              </div>
              <div className={cn('flex gap-1.5', t.max && 'mb-[11px]')}>
                {['Unlimited', '10', '5'].map((o) => (
                  <span key={o} className={cn('flex-1 rounded-[10px] border py-2 text-center font-display text-[13px] font-bold', t.allow === o ? 'border-transparent bg-acc text-on-acc' : 'border-line bg-elev2 text-dim')}>
                    {o}
                  </span>
                ))}
              </div>
              {t.max && (
                <div>
                  <div className="mb-[5px] flex justify-between">
                    <span className="text-[11.5px] text-faint">gebruikt dit event</span>
                    <span className={cn('text-[12px] font-bold', t.used >= t.max ? 'text-acc' : 'text-dim')}>
                      {t.used}/{t.max}
                    </span>
                  </div>
                  <div className="h-[6px] overflow-hidden rounded-[4px] bg-elev2">
                    <div className="h-full rounded-[4px] bg-acc" style={{ width: (t.used / t.max) * 100 + '%' }} />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="mb-[10px] flex items-center justify-between">
          <Label>Extra plekken per event</Label>
          <Btn sm kind="quiet" icon="plus">
            Override
          </Btn>
        </div>
        <div className="flex flex-col gap-2">
          {([['FRENZY', 'Joris', '+15'], ['Hunée', 'Eva', '+5'], ['MINDSCAPE', 'Sanne', '∞']] as const).map(([e, w, x]) => (
            <div key={e + w} className="flex items-center gap-[12px] rounded-[13px] border border-line bg-elev px-[14px] py-[12px]">
              <span className="flex-1 text-[14px] font-semibold text-text">{e}</span>
              <span className="text-[12.5px] text-faint">{w}</span>
              <span className="font-display text-[12.5px] font-bold text-acc">{x} extra</span>
            </div>
          ))}
        </div>
      </Scroll>
    </div>
  );
}

// ── TOELAGE PER EVENT (pushed) ───────────────────────────────────────────────
export function Allowance(): JSX.Element {
  const nav = useNav();
  const [rows, setRows] = useState(allowanceData.rows.map((r) => ({ ...r })));
  const set = (name: string, v: number): void => setRows((rs) => rs.map((r) => (r.name === name ? { ...r, override: Math.max(0, v) } : r)));
  const stepBtn = cn('flex h-[46px] w-[46px] items-center justify-center rounded-[14px] border border-line bg-elev2 text-text', press);
  return (
    <div className={col}>
      <Top onBack={nav.back} title="Toelage per event" sub={allowanceData.event} right={<IconBtn name="cal" />} />
      <Scroll bottom={120}>
        <Note icon="ticket">
          Iedereen heeft een standaardquotum. Hier verhoog of verlaag je het <b>alleen voor dit event</b> — elke wijziging komt in het audit log.
        </Note>
        <Label className="mb-[10px]">Teamleden · {allowanceData.event}</Label>
        <div className="flex flex-col gap-[10px]">
          {rows.map((r) => {
            const changed = r.override !== r.base;
            return (
              <div key={r.name} className="rounded-[18px] border border-line bg-elev p-[14px]">
                <div className="mb-3 flex items-center gap-[12px]">
                  <Avatar name={r.name} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-[15px] font-bold text-text">{r.name}</div>
                    <div className="text-[12px] text-faint">
                      {r.role} · standaard {r.base}
                    </div>
                  </div>
                  {changed && <MiniChip className="border-transparent bg-acc-dim text-acc">{r.override > r.base ? '+' + (r.override - r.base) : r.override - r.base} override</MiniChip>}
                </div>
                <div className="flex items-center justify-between gap-[14px] rounded-[16px] bg-acc-dim p-[9px]">
                  <button type="button" onClick={() => set(r.name, r.override - 1)} className={stepBtn} aria-label="Minder">
                    <Icon name="minus" size={20} sw={2.4} />
                  </button>
                  <div className="text-center">
                    <div className="font-display text-[26px] font-extrabold leading-none text-text">{r.override}</div>
                    <div className="mt-0.5 text-[11px] text-dim">plekken</div>
                  </div>
                  <button type="button" onClick={() => set(r.name, r.override + 1)} className={stepBtn} aria-label="Meer">
                    <Icon name="plus" size={20} sw={2.4} stroke="#B5A6FF" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Scroll>
      <BottomBar>
        <Btn kind="primary" full icon="check" onClick={() => nav.back()}>
          Toelages opslaan
        </Btn>
      </BottomBar>
    </div>
  );
}

// ── VENUE SWITCHER (pushed) ──────────────────────────────────────────────────
export function VenueSwitch(): JSX.Element {
  const nav = useNav();
  const { venue, switchVenue } = usePo();
  return (
    <div className={col}>
      <Top onBack={nav.back} title="Venues" sub="Wissel tussen je locaties" right={<IconBtn name="plus" onClick={() => nav.push('venuecreate')} />} />
      <Scroll bottom={24}>
        <Note icon="building">
          Je werkt nu in <b>{venue.name}</b>. Je account staat los van de venue — wisselen verandert niets aan je toegang elders.
        </Note>
        <Label className="mb-[10px]">Jouw venues · {venues.length}</Label>
        <div className="flex flex-col gap-[10px]">
          {venues.map((v) => {
            const cur = v.id === venue.id;
            return (
              <div key={v.id} className={cn('rounded-[18px] border p-[15px]', cur ? 'border-transparent bg-acc-dim' : 'border-line bg-elev')}>
                <div className="flex items-center gap-[13px]">
                  <Avatar name={v.name} size={46} accent={cur} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="font-display text-[16.5px] font-bold text-text">{v.name}</div>
                      {cur && <MiniChip className="border-transparent bg-white/[0.10] text-acc">HUIDIG</MiniChip>}
                    </div>
                    <div className={cn('mt-0.5 text-[12.5px]', cur ? 'text-dim' : 'text-faint')}>
                      {v.city} · {v.plan} · {v.events} events
                    </div>
                  </div>
                </div>
                <div className="mt-[13px] flex flex-wrap items-center gap-[7px]">
                  <div className="flex flex-1 flex-wrap gap-1.5">
                    {v.roles.map((ro) => (
                      <MiniChip key={ro}>{ro}</MiniChip>
                    ))}
                  </div>
                  {cur ? (
                    <Btn sm kind="ghost" icon="cog" onClick={() => nav.push('venuesettings', { id: v.id })}>
                      Beheren
                    </Btn>
                  ) : (
                    <Btn sm kind="primary" icon="swap" onClick={() => switchVenue(v)}>
                      Wissel
                    </Btn>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <Btn kind="dark" full icon="plus" className="mt-[14px]" onClick={() => nav.push('venuecreate')}>
          Nieuwe venue toevoegen
        </Btn>
      </Scroll>
    </div>
  );
}

// ── VENUE SETTINGS (pushed) ──────────────────────────────────────────────────
export function VenueSettings({ venue }: { venue: Venue }): JSX.Element {
  const nav = useNav();
  const [name, setName] = useState(venue.name);
  const [retention, setRetention] = useState('12');
  const [defaultQuota, setDefaultQuota] = useState(5);
  const [landingBrand, setLandingBrand] = useState(true);
  return (
    <div className={col}>
      <Top onBack={nav.back} title="Venue beheren" sub={venue.name} />
      <Scroll bottom={120}>
        <Label className="mb-2">Naam</Label>
        <Field icon="building" value={name} onChange={setName} className="mb-[14px]" />
        <Label className="mb-2">Stad</Label>
        <Field icon="pin" value="Amsterdam" placeholder="Stad" className="mb-[14px]" />
        <Label className="mb-2">Landingpage-basis</Label>
        <Field icon="link" value="plus.one/lofi" className="mb-[18px]" />

        <Label className="mb-[10px]">Gastenlijst-standaarden</Label>
        <div className="mb-[18px] rounded-[18px] border border-line bg-elev px-4 py-1">
          <div className="flex items-center gap-[12px] border-b border-line2 py-[14px]">
            <div className="flex-1">
              <div className="text-[14.5px] font-semibold text-text">Standaard quotum per teamlid</div>
              <div className="mt-0.5 text-[12px] text-faint">Gasten-per-event, per persoon te overschrijven</div>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setDefaultQuota((q) => Math.max(0, q - 1))} className={cn(iconSm, press)}>
                <Icon name="minus" size={16} />
              </button>
              <span className="min-w-[22px] text-center font-display text-[18px] font-extrabold text-text">{defaultQuota}</span>
              <button type="button" onClick={() => setDefaultQuota((q) => q + 1)} className={cn(iconSm, press, 'text-acc')}>
                <Icon name="plus" size={16} />
              </button>
            </div>
          </div>
          <ToggleRow title="Venue-branding op landingpage" sub="Logo & kleuren op het aanvraagformulier" on={landingBrand} set={setLandingBrand} last />
        </div>

        <Label className="mb-[10px]">AVG & bewaartermijn</Label>
        <div className="mb-[18px] rounded-[18px] border border-line bg-elev p-4">
          <div className="mb-[14px] text-[13.5px] leading-[1.5] text-dim">Gastdata wordt na deze termijn automatisch geanonimiseerd tot “Gast #X”. Het audit log blijft intact.</div>
          <div className="flex gap-[7px]">
            {['6', '12', '24'].map((m) => (
              <button key={m} type="button" onClick={() => setRetention(m)} className={cn('flex-1 rounded-[11px] border py-[11px] font-display text-[14px] font-bold', press, retention === m ? 'border-transparent bg-acc text-on-acc' : 'border-line bg-elev2 text-dim')}>
                {m} mnd
              </button>
            ))}
          </div>
        </div>

        <Label className="mb-[10px]">Gevarenzone</Label>
        <button type="button" className="flex w-full items-center gap-[12px] rounded-[14px] border border-line bg-transparent px-4 py-[14px] text-left transition-colors hover:bg-white/[0.03]">
          <span className="text-faint">
            <Icon name="warn" size={18} />
          </span>
          <div className="flex-1">
            <div className="text-[14.5px] font-semibold text-text">Venue deactiveren</div>
            <div className="mt-0.5 text-[12px] text-faint">Data blijft bewaard · nooit hard verwijderd</div>
          </div>
        </button>
      </Scroll>
      <BottomBar>
        <Btn kind="primary" full icon="check" onClick={() => nav.back()}>
          Opslaan
        </Btn>
      </BottomBar>
    </div>
  );
}

// ── PERSOONLIJKE GEGEVENS (pushed) ───────────────────────────────────────────
export function Profile(): JSX.Element {
  const nav = useNav();
  const p = profile;
  const [email, setEmail] = useState(p.email);
  const [phone, setPhone] = useState(p.phone);
  const sessionIcon = (device: string): IconName => (device.includes('deur') ? 'ticket' : device.includes('Mac') ? 'grid' : 'user');
  return (
    <div className={col}>
      <Top onBack={nav.back} title="Persoonlijke gegevens" />
      <Scroll bottom={120}>
        <div className="flex flex-col items-center px-0 pb-5 pt-1 text-center">
          <Avatar name={p.name} size={84} accent />
          <h2 className="mb-0 mt-4 font-display text-[26px] font-extrabold tracking-[-0.02em] text-text">{p.name}</h2>
          <div className="mt-1 text-[13px] text-faint">{p.role}</div>
        </div>

        <Label className="mb-2">Naam</Label>
        <Field icon="user" value={p.name} placeholder="Naam" className="mb-[14px]" />
        <Label className="mb-2">E-mailadres</Label>
        <Field icon="mail" value={email} onChange={setEmail} inputMode="email" className="mb-1.5" />
        <div className="mb-[14px] pl-0.5 text-[12px] leading-[1.4] text-faint">Alleen jij kunt je e-mailadres wijzigen — nooit een venue-admin.</div>
        <Label className="mb-2">Telefoon</Label>
        <Field icon="phone" value={phone} onChange={setPhone} inputMode="tel" className="mb-[18px]" />

        <Label className="mb-[10px]">Beveiliging</Label>
        <div className="mb-[18px] rounded-[18px] border border-line bg-elev px-4 py-1">
          <div className="flex items-center gap-[12px] border-b border-line2 py-[14px]">
            <span className="text-acc">
              <Icon name="shield" size={19} />
            </span>
            <div className="flex-1">
              <div className="text-[14.5px] font-semibold text-text">Tweestapsverificatie</div>
              <div className="mt-0.5 text-[12px] text-faint">Verplicht voor jouw rol · authenticator-app</div>
            </div>
            <MiniChip className="border-transparent bg-acc-dim text-acc">AAN</MiniChip>
          </div>
          <div className="flex items-center gap-[12px] py-[14px]">
            <span className="text-faint">
              <Icon name="mail" size={19} />
            </span>
            <div className="flex-1">
              <div className="text-[14.5px] font-semibold text-text">Inlogmethode</div>
              <div className="mt-0.5 text-[12px] text-faint">Passwordless · e-mailcode (OTP)</div>
            </div>
          </div>
        </div>

        <Label className="mb-[10px]">Actieve sessies</Label>
        <div className="mb-3 rounded-[18px] border border-line bg-elev px-4 py-0.5">
          {sessions.map((se, i) => (
            <div key={se.id} className={cn('flex items-center gap-[12px] py-[13px]', i < sessions.length - 1 && 'border-b border-line2')}>
              <span className={cn('flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-[11px] border border-line bg-elev2', se.current ? 'text-acc' : 'text-faint')}>
                <Icon name={sessionIcon(se.device)} size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold text-text">{se.device}</div>
                <div className={cn('mt-0.5 text-[12px]', se.current ? 'text-acc' : 'text-faint')}>
                  {se.where} · {se.last}
                </div>
              </div>
              {!se.current && <MiniChip onClick={() => undefined}>Uitloggen</MiniChip>}
            </div>
          ))}
        </div>
        <Btn kind="ghost" full icon="logout" className="mb-[18px]">
          Alle andere apparaten uitloggen
        </Btn>
      </Scroll>
      <BottomBar>
        <Btn kind="primary" full icon="check" onClick={() => nav.back()}>
          Opslaan
        </Btn>
      </BottomBar>
    </div>
  );
}

// ── ABONNEMENT & FACTUREN (pushed) ───────────────────────────────────────────
export function Billing(): JSX.Element {
  const nav = useNav();
  const sub = subscription;
  return (
    <div className={col}>
      <Top onBack={nav.back} title="Abonnement & facturen" />
      <Scroll bottom={24}>
        <div className="mb-[14px] rounded-[18px] bg-acc-dim p-5">
          <div className="mb-[14px] flex items-center justify-between">
            <div className="flex items-center gap-[10px]">
              <Icon name="spark" size={20} stroke="#B5A6FF" />
              <span className="font-display text-[20px] font-extrabold text-text">{sub.plan}</span>
            </div>
            <MiniChip className="border-transparent bg-white/[0.12] text-acc">ACTIEF</MiniChip>
          </div>
          <div className="mb-4 flex items-end gap-1.5">
            <span className="font-display text-[36px] font-extrabold leading-none text-text">{sub.price}</span>
            <span className="pb-[5px] text-[14px] text-dim">/ {sub.period}</span>
          </div>
          <div className="grid grid-cols-2 gap-[10px]">
            {([['Events', sub.events], ['Venues', sub.venues], ['Verlengt', sub.renews], ['Methode', sub.method]] as const).map(([k, val]) => (
              <div key={k}>
                <div className="text-[11.5px] text-dim">{k}</div>
                <div className="mt-0.5 font-display text-[14px] font-bold text-text">{val}</div>
              </div>
            ))}
          </div>
        </div>

        <Label className="mb-[10px]">Betaalmethode</Label>
        <div className="mb-2 flex items-center gap-[13px] rounded-[18px] border border-line bg-elev p-4">
          <span className="flex h-[42px] w-[42px] items-center justify-center rounded-[12px] border border-line bg-elev2 text-acc">
            <Icon name="card" size={20} />
          </span>
          <div className="flex-1">
            <div className="text-[14.5px] font-semibold text-text">SEPA-incasso</div>
            <div className="mt-0.5 font-mono text-[12.5px] text-faint">{sub.mandate}</div>
          </div>
          <MiniChip onClick={() => undefined}>Wijzig</MiniChip>
        </div>
        <div className="mb-[18px] flex items-start gap-[7px] pl-0.5 text-[12px] text-faint">
          <Icon name="shield" size={13} className="text-ghost" />
          <span className="leading-[1.45]">Betalingen via SEPA-incasso &amp; iDEAL. We bewaren nooit zelf je IBAN — dat regelt de betaalprovider.</span>
        </div>

        <div className="mb-[10px] flex items-center justify-between">
          <Label>Facturen</Label>
          <MiniChip onClick={() => undefined}>Alles downloaden</MiniChip>
        </div>
        <div className="mb-[18px] rounded-[18px] border border-line bg-elev px-4 py-0.5">
          {invoices.map((inv, i) => (
            <div key={inv.id} className={cn('flex items-center gap-[12px] py-[13px]', i < invoices.length - 1 && 'border-b border-line2')}>
              <div className="min-w-0 flex-1">
                <div className="font-display text-[14px] font-semibold text-text">{inv.amount}</div>
                <div className="mt-0.5 text-[12px] text-faint">
                  {inv.date} · {inv.method} · {inv.id}
                </div>
              </div>
              <span className="inline-flex items-center gap-[5px] font-body text-[11.5px] font-bold text-acc">
                <Icon name="check2" size={12} stroke="#B5A6FF" sw={2.4} />
                Betaald
              </span>
              <button type="button" className={cn(iconSm, press)}>
                <Icon name="dl" size={16} />
              </button>
            </div>
          ))}
        </div>

        <Btn kind="dark" full icon="link">
          Beheer in betaalportaal
        </Btn>
        <div className="mt-3 text-center">
          <button type="button" className={cn('cursor-pointer border-none bg-transparent font-body text-[13px] font-semibold text-faint', press)}>
            Abonnement opzeggen
          </button>
        </div>
      </Scroll>
    </div>
  );
}

// ── IMPORTEREN (pushed) ──────────────────────────────────────────────────────
export function Import(): JSX.Element {
  const nav = useNav();
  const rows: [string, 'dup' | 'new', string?][] = [
    ['Anouk Smit', 'dup', '21×'],
    ['Pim Scholten', 'new'],
    ['Femke Bakker', 'dup', '17×'],
    ['Teun Postma', 'new'],
    ['Wout Dekker', 'new'],
    ['Lieke Hofman', 'dup', '14×'],
  ];
  const sources: [IconName, string, boolean][] = [
    ['paste', 'Plak lijst', true],
    ['upload', 'CSV', false],
    ['contact', 'Contacten', false],
    ['ticket', 'Vorig event', false],
  ];
  return (
    <div className={col}>
      <Top onBack={nav.back} title="Importeren" />
      <Scroll bottom={100}>
        <div className="mb-[14px] text-[13.5px] leading-[1.5] text-faint">Iedereen die ooit op een lijst stond in één keer in je adresboek.</div>
        <div className="po-scroll mb-4 flex gap-2 overflow-x-auto">
          {sources.map(([ic, l, on]) => (
            <span key={l} className={cn('inline-flex shrink-0 items-center gap-[7px] rounded-full border px-[14px] py-[9px] font-display text-[13px] font-bold', on ? 'border-transparent bg-acc text-on-acc' : 'border-line text-dim')}>
              <Icon name={ic} size={15} sw={2.1} stroke={on ? '#16132B' : 'rgba(255,255,255,0.58)'} />
              {l}
            </span>
          ))}
        </div>
        <Label className="mb-[9px]">Herkend · dubbele worden gekoppeld</Label>
        <div className="flex flex-col gap-2">
          {rows.map(([n, s, m]) => (
            <div key={n} className="flex items-center gap-[11px] rounded-[13px] border border-line bg-elev px-[12px] py-[10px]">
              <Avatar name={n} size={34} accent={s === 'dup'} />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold text-text">{n}</div>
                {m && <div className="text-[11.5px] text-faint">match · {m} op lijst</div>}
              </div>
              <span className={cn('rounded-[7px] px-2 py-[3px] text-[10.5px] font-bold', s === 'dup' ? 'bg-acc-dim text-acc' : 'border border-line text-text')}>{s === 'dup' ? 'BESTAAT AL' : 'NIEUW'}</span>
            </div>
          ))}
        </div>
      </Scroll>
      <BottomBar>
        <Btn kind="primary" full icon="check" onClick={() => nav.back()}>
          Importeer 142 gasten
        </Btn>
      </BottomBar>
    </div>
  );
}
