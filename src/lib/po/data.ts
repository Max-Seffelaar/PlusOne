/**
 * Mock data driving the PLUSONE prototype — ported verbatim from the Claude
 * Design handoff (`po-data.js` + `po-data2.js`) and typed. Shapes intentionally
 * map onto the eventual Supabase schema (tiers, quotas, audit, …) so wiring is a
 * swap, not a rewrite. UI copy is Dutch per project convention.
 */

import type {
  AllowanceRow,
  AuditEntry,
  Contact,
  Guest,
  GuestRequest,
  Invite,
  Invoice,
  PoEvent,
  Profile,
  QuotaRequest,
  Recap,
  Session,
  Stats,
  Subscription,
  TeamMember,
  Tier,
  Venue,
} from './types';

export const events: PoEvent[] = [
  { id: 'frenzy', name: 'FRENZY', venue: 'De Marktkantine', time: '23:00', date: '14', mon: 'DEC', month: 'December 2024', guests: 148, inside: 0, accent: true, when: 'upcoming', phase: 'upcoming', cancelled: false },
  { id: 'hunee', name: 'Hunée — All Night Long', venue: 'Paradiso', time: '22:00', date: '20', mon: 'DEC', month: 'December 2024', guests: 96, inside: 0, when: 'upcoming', phase: 'upcoming', cancelled: false },
  { id: 'zezout', name: 'ZEZOUT × LOFI', venue: 'Garage Noord', time: '23:30', date: '21', mon: 'DEC', month: 'December 2024', guests: 61, inside: 0, when: 'upcoming', phase: 'upcoming', cancelled: false },
  { id: 'mindscape', name: 'MINDSCAPE', venue: 'Shelter', time: '23:00', date: '27', mon: 'DEC', month: 'December 2024', guests: 110, inside: 0, when: 'upcoming', phase: 'upcoming', cancelled: false },
  { id: 'frenzy-j', name: 'FRENZY', venue: 'De Marktkantine', time: '23:00', date: '10', mon: 'JAN', month: 'Januari 2025', guests: 38, inside: 0, when: 'upcoming', phase: 'upcoming', cancelled: false },
  { id: 'nyd', name: "New Year's Day", venue: 'Radion', time: '08:00', date: '01', mon: 'JAN', month: 'Januari 2025', guests: 73, inside: 0, when: 'upcoming', phase: 'upcoming', cancelled: false },
  { id: 'lofi-nov', name: 'LOFI Nightcap', venue: 'Lofi', time: '23:00', date: '23', mon: 'NOV', month: 'November 2024', guests: 132, inside: 121, when: 'past', phase: 'past', cancelled: false },
  { id: 'warehouse', name: 'Warehouse 09', venue: 'NDSM-loods', time: '22:00', date: '09', mon: 'NOV', month: 'November 2024', guests: 210, inside: 188, when: 'past', phase: 'past', cancelled: false },
];

export const guests: Guest[] = [
  { id: '1', name: 'Lieke Hofman', role: 'VIP', pay: 'paid', plus: 2, note: 'Tafel 4 reserveren — staat op naam', flag: 'high', by: 'Max', addedAt: '28 nov', status: 'in', at: '23:42', inBy: 'Joris' },
  { id: '2', name: 'Daan Verhoeven', role: 'Artist', pay: 'free', plus: 3, note: 'Backstage — crew haalt op bij de deur', flag: 'high', by: 'Sanne', addedAt: '26 nov', status: 'wait' },
  { id: '3', name: 'Noor van Dijk', role: 'All Access', pay: 'free', plus: 1, note: 'Partner komt later — +1 apart inchecken', flag: 'low', by: 'Max', addedAt: '1 dec', status: 'wait' },
  { id: '4', name: 'Bram Jansen', role: 'Gast', pay: 'pay', plus: 0, note: 'Rekent €25 p.p. af aan de deur', flag: 'low', by: 'Joris', addedAt: '2 dec', status: 'wait' },
  { id: '5', name: 'Femke Bakker', role: 'VIP', pay: 'paid', plus: 0, note: '', flag: null, by: 'Max', addedAt: '27 nov', status: 'in', at: '23:10', inBy: 'Joris' },
  { id: '6', name: 'Sven Mulder', role: 'Pers', pay: 'free', plus: 1, note: 'Fotograaf — geen flits bij main stage', flag: 'low', by: 'Sanne', addedAt: '29 nov', status: 'wait' },
  { id: '7', name: 'Iris Peters', role: 'Gast', pay: 'pay', plus: 0, note: '', flag: null, by: 'Joris', addedAt: '3 dec', status: 'in', at: '00:01', inBy: 'Eva' },
  { id: '8', name: 'Anouk Smit', role: 'VIP', pay: 'paid', plus: 2, note: 'Verjaardag — fles champagne bij tafel 7', flag: 'high', by: 'Max', addedAt: '24 nov', status: 'wait' },
  { id: '9', name: 'Ruben Maas', role: 'Gast', pay: 'free', plus: 0, note: '', flag: null, by: 'Joris', addedAt: '2 dec', status: 'wait' },
  { id: '10', name: 'Julia Kok', role: 'All Access', pay: 'free', plus: 0, note: '', flag: null, by: 'Sanne', addedAt: '30 nov', status: 'in', at: '23:55', inBy: 'Joris' },
  { id: '11', name: 'Stijn Bos', role: 'Gast', pay: 'pay', plus: 1, note: '', flag: null, by: 'Joris', addedAt: '4 dec', status: 'wait' },
  { id: '12', name: 'Tim de Groot', role: 'Crew', pay: 'free', plus: 0, note: 'Op-/afbouw — hele avond in/uit', flag: 'low', by: 'Systeem', addedAt: '20 nov', status: 'in', at: '21:30', inBy: 'Systeem' },
];

export const contacts: Contact[] = [
  { name: 'Anouk Smit', events: 21, role: 'VIP', vast: true },
  { name: 'Femke Bakker', events: 17, role: 'VIP', vast: true },
  { name: 'Lieke Hofman', events: 14, role: 'VIP', vast: true },
  { name: 'Julia Kok', events: 11, role: 'All Access', vast: false },
  { name: 'Daan Verhoeven', events: 9, role: 'Artist', vast: false },
  { name: 'Noor van Dijk', events: 8, role: 'All Access', vast: false },
  { name: 'Sven Mulder', events: 6, role: 'Pers', vast: false },
  { name: 'Bram Jansen', events: 3, role: 'Gast', vast: false },
  { name: 'Ruben Maas', events: 2, role: 'Gast', vast: false },
];

export const team: TeamMember[] = [
  { name: 'Max Seffelaar', role: 'Eigenaar', allow: 'Unlimited', used: 42, max: null },
  { name: 'Sanne de Vries', role: 'Manager', allow: '10', used: 7, max: 10 },
  { name: 'Joris Willems', role: 'Host', allow: '5', used: 5, max: 5 },
  { name: 'Eva Timmermans', role: 'Promotor', allow: '10', used: 3, max: 10 },
];

export const account = { ws: 'LOFI', plan: 'Premium', user: 'Max Seffelaar' };

// Per-event guest tiers. aliases[] feed the deterministic quick-add parser (#33).
// door_price hangs on the TIER per spec #34 (prototype showed it per guest — spec wins).
export const tiers: Tier[] = [
  { id: 'vip', name: 'VIP — fles op tafel', short: 'VIP', role: 'VIP', color: '#B5A6FF', max: 30, used: 18, doorPrice: 0, aliases: ['vip', 'fles', 'tafel', 'champagne', 'bottle'] },
  { id: 'aa', name: 'All Access', short: 'All Access', role: 'All Access', color: '#C9BEFF', max: 20, used: 11, doorPrice: 0, aliases: ['aa', 'allaccess', 'all access', 'backstage', 'all'] },
  { id: 'artist', name: 'Artist / Gasten DJ', short: 'Artist', role: 'Artist', color: '#9DE0C0', max: 15, used: 6, doorPrice: 0, aliases: ['artist', 'artiest', 'dj', 'act', 'guest'] },
  { id: 'pers', name: 'Pers & media', short: 'Pers', role: 'Pers', color: '#E8C98A', max: 10, used: 4, doorPrice: 0, aliases: ['pers', 'press', 'media', 'fotograaf', 'foto'] },
  { id: 'crew', name: 'Crew & productie', short: 'Crew', role: 'Crew', color: '#9FB8E8', max: null, used: 9, doorPrice: 0, aliases: ['crew', 'productie', 'techniek', 'staff', 'prod'] },
  { id: 'regular', name: 'Regular', short: 'Gast', role: 'Gast', color: '#8E8E93', max: 120, used: 86, doorPrice: 25, aliases: ['regular', 'gast', 'normaal', 'betaald', 'deur'], isDefault: true },
];

// Quota requests — staff asking the admin for more guest slots for an event (#4, #5).
export const quotaRequests: QuotaRequest[] = [
  { id: 'qr1', who: 'Joris Willems', role: 'Host', event: 'FRENZY', current: 5, want: 8, reason: 'Twee extra promo-koppels + DJ-vriend', at: '2 uur geleden', status: 'open' },
  { id: 'qr2', who: 'Eva Timmermans', role: 'Promotor', event: 'FRENZY', current: 10, want: 16, reason: 'Guestlist-actie liep harder dan verwacht', at: 'vandaag 14:02', status: 'open' },
  { id: 'qr3', who: 'Sanne de Vries', role: 'Manager', event: 'Hunée', current: 10, want: 12, reason: 'Label stuurt 2 extra gasten', at: 'gisteren', status: 'open' },
];

// Landing-page guest requests awaiting approval (#12, #31). Outside personal quota.
export const guestRequests: GuestRequest[] = [
  { id: 'gr1', name: 'Mara Visser', plus: 1, phone: '•••• 4821', motivation: 'Vriendin van de DJ, kom met +1', at: '18 min geleden', status: 'open' },
  { id: 'gr2', name: 'Tobias Reijn', plus: 0, phone: '•••• 1190', motivation: '', at: '41 min geleden', status: 'open' },
  { id: 'gr3', name: 'Indy Konings', plus: 3, phone: '•••• 7732', motivation: 'Verjaardag, kom met 3 vrienden', at: '1 uur geleden', status: 'open', flag: 'Groot gezelschap (+3)' },
  { id: 'gr4', name: 'Lieke Hofman', plus: 0, phone: '•••• 2034', motivation: 'Sta vaker op de lijst', at: '1 uur geleden', status: 'open', flag: 'Staat al op de lijst (VIP)' },
];

// Readable audit log — triggers translate diffs to sentences (#15). Desktop + per-guest.
export const audit: AuditEntry[] = [
  { id: 'a1', actor: 'Max', action: 'tier_change', entity: 'Juri Braakman', text: 'verplaatste Juri Braakman van Regular naar VIP', event: 'FRENZY', when: 'Vandaag 22:14', device: 'web' },
  { id: 'a2', actor: 'Joris', action: 'check_in', entity: 'Lieke Hofman +2', text: 'checkte Lieke Hofman +2 in aan de deur', event: 'FRENZY', when: 'Vandaag 23:42', device: 'deur-iPad' },
  { id: 'a3', actor: 'Max', action: 'lock', entity: 'FRENZY', text: 'vergrendelde de gastenlijst', event: 'FRENZY', when: 'Vandaag 22:58', device: 'web' },
  { id: 'a4', actor: 'Max', action: 'quota_grant', entity: 'Joris Willems', text: 'kende Joris 3 extra plekken toe (5 → 8)', event: 'FRENZY', when: 'Vandaag 21:30', device: 'web' },
  { id: 'a5', actor: 'Eva', action: 'create', entity: 'Bram Jansen', text: 'voegde Bram Jansen toe (Regular, deurbetaling)', event: 'FRENZY', when: 'Vandaag 19:11', device: 'iPhone' },
  { id: 'a6', actor: 'Joris', action: 'refuse', entity: 'Onbekend', text: 'weigerde een gast — reden: niet op de lijst', event: 'FRENZY', when: 'Vandaag 23:55', device: 'deur-iPad' },
  { id: 'a7', actor: 'Sanne', action: 'approve', entity: 'Mara Visser', text: 'keurde landingpage-aanvraag Mara Visser +1 goed', event: 'FRENZY', when: 'Vandaag 18:40', device: 'web' },
  { id: 'a8', actor: 'Systeem', action: 'delete', entity: 'Test Gast', text: 'verwijderde Test Gast (soft delete, status removed)', event: 'FRENZY', when: 'Gisteren 16:02', device: 'web' },
];

// Stats for desktop statistieken (#6 §6). Check-ins per kwartier + per tier.
export const stats: Stats = {
  perKwartier: [
    { t: '22:00', n: 4 }, { t: '22:15', n: 9 }, { t: '22:30', n: 14 }, { t: '22:45', n: 22 },
    { t: '23:00', n: 38 }, { t: '23:15', n: 31 }, { t: '23:30', n: 19 }, { t: '23:45', n: 12 },
    { t: '00:00', n: 16 }, { t: '00:15', n: 8 }, { t: '00:30', n: 5 }, { t: '00:45', n: 3 },
  ],
  perTier: [
    { tier: 'VIP', aangemeld: 30, binnen: 22 },
    { tier: 'All Access', aangemeld: 20, binnen: 16 },
    { tier: 'Artist', aangemeld: 15, binnen: 11 },
    { tier: 'Pers', aangemeld: 10, binnen: 6 },
    { tier: 'Crew', aangemeld: 12, binnen: 9 },
    { tier: 'Regular', aangemeld: 86, binnen: 61 },
  ],
  perUser: [
    { who: 'Max Seffelaar', added: 42, in: 33 },
    { who: 'Sanne de Vries', added: 28, in: 21 },
    { who: 'Eva Timmermans', added: 19, in: 14 },
    { who: 'Joris Willems', added: 8, in: 8 },
  ],
};

export const invites: Invite[] = [
  { email: 'nina@marktkantine.nl', roles: ['staff'], status: 'pending', at: 'gisteren' },
  { email: 'floor@lofi.amsterdam', roles: ['doorhost'], status: 'pending', at: '2 dagen' },
];

// Venues the current user is a member of (#1, #24) — for the venue switcher.
export const venues: Venue[] = [
  { id: 'lofi', name: 'LOFI', city: 'Amsterdam', plan: 'Premium', roles: ['Admin', 'Finance'], events: 14, current: true },
  { id: 'marktkantine', name: 'De Marktkantine', city: 'Amsterdam', plan: 'Premium', roles: ['Organisator'], events: 8 },
  { id: 'garagenoord', name: 'Garage Noord', city: 'Amsterdam', plan: 'Starter', roles: ['Doorhost'], events: 3 },
];

// Profile + active sessions (#20 §5 — sessiebeheer + remote logout).
export const profile: Profile = { name: 'Max Seffelaar', email: 'max@lofi.amsterdam', phone: '06 24 88 19 03', role: 'Eigenaar · Admin + Finance', mfa: true };

export const sessions: Session[] = [
  { id: 's1', device: 'iPhone 15 — PLUSONE PWA', where: 'Amsterdam · NL', last: 'Nu actief', current: true },
  { id: 's2', device: 'iPad — deurapparaat', where: 'De Marktkantine', last: '3 min geleden' },
  { id: 's3', device: 'MacBook Pro — Safari', where: 'Amsterdam · NL', last: 'Gisteren 23:50' },
];

// Billing (#32) — app reads only this status; Stripe is implementatiedetail.
export const subscription: Subscription = { plan: 'Premium', price: '€49', period: 'maand', status: 'active', renews: '1 jan 2025', method: 'SEPA-incasso', mandate: 'NL•• ABNA •••• •• 4821', events: 'Onbeperkt', venues: '3 van 3' };

export const invoices: Invoice[] = [
  { id: 'PLUS-2024-012', date: '1 dec 2024', amount: '€49,00', status: 'paid', method: 'SEPA' },
  { id: 'PLUS-2024-011', date: '1 nov 2024', amount: '€49,00', status: 'paid', method: 'SEPA' },
  { id: 'PLUS-2024-010', date: '1 okt 2024', amount: '€49,00', status: 'paid', method: 'iDEAL' },
  { id: 'PLUS-2024-009', date: '1 sep 2024', amount: '€49,00', status: 'paid', method: 'iDEAL' },
];

// Per-event allowance overrides (#4) — staff get a default, raisable per event.
export const allowance: { event: string; rows: AllowanceRow[] } = {
  event: 'FRENZY',
  rows: [
    { name: 'Sanne de Vries', role: 'Manager', base: 10, override: 10 },
    { name: 'Joris Willems', role: 'Host', base: 5, override: 20 },
    { name: 'Eva Timmermans', role: 'Promotor', base: 10, override: 10 },
  ],
};

// Recap data for a finished event (#26, #6) — who came, who didn't.
export const recap: Recap = {
  event: 'Warehouse 09', venue: 'NDSM-loods', date: '9 nov 2024',
  listed: 210, arrived: 188, noShow: 22, refused: 4, peak: '00:30',
  checkedIn: [
    { name: 'Anouk Smit', plus: 2, role: 'VIP', at: '23:14' },
    { name: 'Lieke Hofman', plus: 0, role: 'VIP', at: '23:31' },
    { name: 'Daan Verhoeven', plus: 3, role: 'Artist', at: '22:50' },
    { name: 'Julia Kok', plus: 0, role: 'All Access', at: '23:58' },
    { name: 'Sven Mulder', plus: 1, role: 'Pers', at: '22:40' },
    { name: 'Tim de Groot', plus: 0, role: 'Crew', at: '21:30' },
    { name: 'Iris Peters', plus: 0, role: 'Gast', at: '00:42' },
  ],
  noShows: [
    { name: 'Bram Jansen', plus: 0, role: 'Gast', by: 'Joris' },
    { name: 'Femke Bakker', plus: 0, role: 'VIP', by: 'Max' },
    { name: 'Ruben Maas', plus: 0, role: 'Gast', by: 'Joris' },
    { name: 'Stijn Bos', plus: 1, role: 'Gast', by: 'Joris' },
  ],
};
