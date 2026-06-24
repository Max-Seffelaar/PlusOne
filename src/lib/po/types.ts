/**
 * Domain types for the PLUSONE mobile prototype.
 *
 * These mirror the shapes used by the Claude Design handoff (`po-data.js` /
 * `po-data2.js`). They describe the MOCK data that drives the navigable
 * prototype — when screens are later wired to Supabase, the real row types come
 * from `src/lib/database.types.ts` and these become a thin view layer.
 */

export type Role = 'VIP' | 'All Access' | 'Artist' | 'Pers' | 'Crew' | 'Gast';

/** `paid` = settled up front, `free` = comp, `pay` = must settle at the door. */
export type PayStatus = 'paid' | 'free' | 'pay';

export type GuestStatus = 'in' | 'wait' | 'refused';

export type Priority = 'high' | 'low';

export type EventWhen = 'upcoming' | 'past';

/** Time-derived lifecycle phase (src/features/po/event-phase.ts). Replaces the
 *  retired manual status machine for everything the UI shows. */
export type EventPhase = 'upcoming' | 'live' | 'past';

export interface PoEvent {
  id: string;
  name: string;
  venue: string;
  time: string;
  date: string;
  mon: string;
  month: string;
  guests: number;
  inside: number;
  accent?: boolean;
  when: EventWhen;
  /** Time-derived phase; `live` drives the "happening now" badge. */
  phase: EventPhase;
  /** The event was cancelled (admin action) — shown as a badge, blocks the door. */
  cancelled: boolean;
}

export interface Guest {
  id: string;
  name: string;
  role: Role;
  pay: PayStatus;
  plus: number;
  note: string;
  flag: Priority | null;
  by: string;
  addedAt: string;
  status: GuestStatus;
  at?: string;
  inBy?: string;
  /** Linked address-book contact (live data); absent in the mock. */
  contactId?: string | null;
}

export interface Contact {
  name: string;
  events: number;
  role: Role;
  vast: boolean;
}

export interface TeamMember {
  name: string;
  role: string;
  allow: string;
  used: number;
  max: number | null;
}

export interface Tier {
  id: string;
  name: string;
  short: string;
  role: Role;
  color: string;
  max: number | null;
  used: number;
  doorPrice: number;
  aliases: string[];
  isDefault?: boolean;
}

export interface QuotaRequest {
  id: string;
  who: string;
  role: string;
  event: string;
  current: number;
  want: number;
  reason: string;
  at: string;
  status: 'open' | 'ok' | 'no';
}

export interface GuestRequest {
  id: string;
  name: string;
  plus: number;
  phone: string;
  motivation: string;
  at: string;
  status: 'open' | 'ok' | 'no';
  flag?: string;
}

export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  entity: string;
  text: string;
  event: string;
  when: string;
  device: string;
}

export interface TierStat {
  tier: string;
  aangemeld: number;
  binnen: number;
}

export interface Stats {
  perKwartier: { t: string; n: number }[];
  perTier: TierStat[];
  perUser: { who: string; added: number; in: number }[];
}

export interface Invite {
  email: string;
  roles: string[];
  status: string;
  at: string;
}

export interface Venue {
  id: string;
  name: string;
  city: string;
  plan: string;
  roles: string[];
  events: number;
  current?: boolean;
}

export interface Profile {
  name: string;
  email: string;
  phone: string;
  role: string;
  mfa: boolean;
}

export interface Session {
  id: string;
  device: string;
  where: string;
  last: string;
  current?: boolean;
}

export interface Subscription {
  plan: string;
  price: string;
  period: string;
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'comped';
  renews: string;
  method: string;
  mandate: string;
  events: string;
  venues: string;
}

export interface Invoice {
  id: string;
  date: string;
  amount: string;
  status: string;
  method: string;
}

export interface AllowanceRow {
  name: string;
  role: string;
  base: number;
  override: number;
}

export interface RecapGuest {
  name: string;
  plus: number;
  role: Role;
  at?: string;
  by?: string;
}

export interface Recap {
  event: string;
  venue: string;
  date: string;
  listed: number;
  arrived: number;
  noShow: number;
  refused: number;
  peak: string;
  checkedIn: RecapGuest[];
  noShows: RecapGuest[];
}

/** Result of the deterministic offline quick-add parser (#33). */
export interface ParsedGuest {
  name: string;
  plus: number;
  tier: Tier;
  unknown: string[];
  ambiguous: boolean;
}

export interface BulkRow extends ParsedGuest {
  id: string;
  raw: string;
}
