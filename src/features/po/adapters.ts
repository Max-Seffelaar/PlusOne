import type { Guest, PoEvent, Tier, Role, GuestStatus, Priority, EventWhen, RecapGuest } from '@/lib/po/types';
import type { Database } from '@/lib/database.types';
import type {
  PoEventRow,
  PoGuestRow,
  PoTierRow,
  PoContactRow,
  RecapGuestRow,
  PoInviteRow,
  PoMemberRow,
  PoProfileRow,
  PoSessionRow,
  PoSubscriptionRow,
  PoVenueSettingsRow,
} from './queries';
import type { EventSummary, TierStat } from '@/features/stats/data';
import { formatClock } from '@/features/stats/format';
import { toPerTier, type PerTier } from '@/features/stats/po-adapter';
import { ROLE_LABELS, VENUE_ROLES, requiresMfa, type VenueRole } from '@/features/auth/roles';
import { getPlan, isPlanId } from '@/features/billing/plans';

// Pure DB-row -> po-component-shape mappers (mirrors src/features/stats/po-adapter.ts).
// No I/O, so they're unit-tested directly (adapters.test.ts). The po mock types
// carry a few UI-only fields the core schema doesn't model — payment status (no
// ticketing, #10) and the door check-in time/by (those live in check_ins via the
// DoorProvider, #25). Those default here and get real values when the screens
// wire up (STAP 3.3+); cross-entity bits (a guest's role badge, who added it) are
// passed in by the caller so the mappers stay pure.

type EventStatus = Database['public']['Enums']['event_status'];
type NotePriority = Database['public']['Enums']['note_priority'];
type GuestRowStatus = Database['public']['Enums']['guest_status'];

const TZ = 'Europe/Amsterdam';

function fmt(iso: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, ...opts }).format(new Date(iso));
}
function capitalize(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** "draft/open/live" are upcoming; only a closed event is "past" (#9, #26). */
export function eventWhen(status: EventStatus): EventWhen {
  return status === 'closed' ? 'past' : 'upcoming';
}

/** Door state mirrored onto the guest row: checked_in → in, refused → refused,
 *  everything else (pending/approved/denied/removed) → wait. */
export function guestStatusToPo(status: GuestRowStatus): GuestStatus {
  if (status === 'checked_in') return 'in';
  if (status === 'refused') return 'refused';
  return 'wait';
}

/** note_priority -> the po flag ("none" collapses to no flag). */
export function notePriorityToFlag(priority: NotePriority): Priority | null {
  return priority === 'high' ? 'high' : priority === 'low' ? 'low' : null;
}

/** Best-effort tier-name -> role badge, mirroring the mock's role labels. */
export function tierRole(name: string): Role {
  const n = name.toLowerCase();
  if (n.includes('vip')) return 'VIP';
  if (n.includes('artist') || n.includes('artiest')) return 'Artist';
  if (n.includes('access') || n === 'aa') return 'All Access';
  if (n.includes('pers') || n.includes('press')) return 'Pers';
  if (n.includes('crew')) return 'Crew';
  return 'Gast';
}

export interface EventCounts {
  /** Registered headcount (1 + plus-ones), aggregated by the caller. */
  guests: number;
  /** Present headcount (checked-in), aggregated by the caller. */
  inside: number;
}

export function toPoEvent(row: PoEventRow, counts: EventCounts): PoEvent {
  return {
    id: row.id,
    name: row.name,
    venue: row.venue_name,
    time: fmt(row.starts_at, { hour: '2-digit', minute: '2-digit', hour12: false }),
    date: fmt(row.starts_at, { day: '2-digit' }),
    mon: fmt(row.starts_at, { month: 'short' }).replace(/\W/g, '').toUpperCase(),
    month: capitalize(fmt(row.starts_at, { month: 'long', year: 'numeric' })),
    guests: counts.guests,
    inside: counts.inside,
    when: eventWhen(row.status),
  };
}

export interface GuestExtras {
  /** Role badge, resolved from the guest's tier by the caller. */
  role: Role;
  /** Display name of who added the guest (profiles join); '' when unknown. */
  addedBy?: string;
}

export function toPoGuest(row: PoGuestRow, extras: GuestExtras): Guest {
  return {
    id: row.id,
    name: row.full_name,
    role: extras.role,
    // Payment isn't modelled in the core schema (no ticketing, #10) — UI default.
    pay: 'free',
    plus: row.plus_ones,
    note: row.note ?? '',
    flag: notePriorityToFlag(row.note_priority),
    by: extras.addedBy ?? '',
    addedAt: fmt(row.created_at, { day: 'numeric', month: 'short' }).replace('.', ''),
    status: guestStatusToPo(row.status),
    contactId: row.contact_id,
    // at/inBy come from check_ins (DoorProvider), not the guests row.
  };
}

/** A recap guest row → the po RecapGuest shape (role from tier, time from check-in). */
export function toRecapGuest(g: RecapGuestRow): RecapGuest {
  return {
    name: g.full_name,
    plus: g.plus_ones,
    role: tierRole(g.tierName ?? ''),
    at: g.checkedAt ? formatClock(g.checkedAt) : undefined,
    by: g.addedByName ?? undefined,
  };
}

/** The numbers + lists a past-event recap renders (event/venue/date come from the PoEvent). */
export interface PoRecap {
  /** On-list headcount. */
  listed: number;
  /** Present headcount. */
  arrived: number;
  noShow: number;
  refused: number;
  /** Peak 15-min bucket as "23:30", or "—" before the first check-in. */
  peak: string;
  checkedIn: RecapGuest[];
  noShows: RecapGuest[];
  perTier: PerTier[];
}

/**
 * Build the past-event recap from the summary RPC + on-list guests + per-tier
 * stats. "Ingecheckt" = checked-in (arrival order); "niet verschenen" = on the
 * list but never arrived (status approved). Pure → unit-tested.
 */
export function toRecap(
  summary: EventSummary | null,
  guests: RecapGuestRow[],
  tiers: TierStat[]
): PoRecap {
  const checkedIn = guests
    .filter((g) => g.status === 'checked_in')
    .sort((a, b) => (a.checkedAt ?? '').localeCompare(b.checkedAt ?? ''))
    .map(toRecapGuest);
  const noShows = guests.filter((g) => g.status === 'approved').map(toRecapGuest);
  return {
    listed: summary?.registered_headcount ?? 0,
    arrived: summary?.present_headcount ?? 0,
    noShow: summary?.no_shows ?? 0,
    refused: summary?.refused ?? 0,
    peak: summary?.peak_bucket ? formatClock(summary.peak_bucket) : '—',
    checkedIn,
    noShows,
    perTier: toPerTier(tiers),
  };
}

export interface OptimisticAddArgs {
  /** Client UUIDv7 (#25); falls back to a transient key when absent. */
  id?: string;
  tierId: string;
  fullName: string;
  plusOnes?: number;
}

/**
 * A transient po Guest for an in-flight add (optimistic UI, STAP 3.4). It mirrors
 * `toPoGuest`'s defaults — role from the tier, pay 'free', status 'wait' — so the
 * optimistic row is visually identical to the server row that replaces it on
 * invalidation. Pure (the clock is injectable) so it's unit-tested directly.
 */
export function optimisticGuest(args: OptimisticAddArgs, tiers: Tier[], now: Date = new Date()): Guest {
  return {
    id: args.id ?? `optimistic-${args.fullName}`,
    name: args.fullName,
    role: tiers.find((t) => t.id === args.tierId)?.role ?? 'Gast',
    pay: 'free',
    plus: args.plusOnes ?? 0,
    note: '',
    flag: null,
    by: '',
    addedAt: fmt(now.toISOString(), { day: 'numeric', month: 'short' }).replace('.', ''),
    status: 'wait',
  };
}

const DEFAULT_TIER_COLOR = '#B5A6FF';

export function toPoTier(row: PoTierRow, used: number): Tier {
  return {
    id: row.id,
    name: row.name,
    short: row.name,
    role: tierRole(row.name),
    color: row.color ?? DEFAULT_TIER_COLOR,
    max: row.max_guests,
    used,
    // Door price isn't modelled in the core schema (#10) — UI default.
    doorPrice: 0,
    aliases: row.aliases ?? [],
  };
}

// ── Address book adapter (S3 Adresboek + Import) ──
// A richer Po* view type (like the settings adapters): carries the contact id +
// is_permanent so a rendered row can drive the star/add-to-event writes, and the
// last 4 phone digits as a privacy-light identity hint (the brief: "naam, laatste
// 4 cijfers, vast, voorkeur-tier"). Never the full e-mail/phone.

type ContactRoleEnum = Database['public']['Enums']['contact_role'];

const CONTACT_ROLE_TO_PO: Record<ContactRoleEnum, Role> = {
  vip: 'VIP',
  all_access: 'All Access',
  artist: 'Artist',
  press: 'Pers',
  crew: 'Crew',
  guest: 'Gast',
};

/** A contact's preferred_role → the po Role badge (null → "Gast"). */
export function contactRoleToPo(role: ContactRoleEnum | null): Role {
  return role ? CONTACT_ROLE_TO_PO[role] : 'Gast';
}

export interface PoContact {
  id: string;
  name: string;
  /** Badge from preferred_role (display). */
  role: Role;
  /** "X× op een lijst". */
  events: number;
  /** is_permanent — the star state ("vast"). */
  vast: boolean;
  /** Last 4 phone digits, or null when no usable phone (list display). */
  phoneLast4: string | null;
  // Raw editable fields — NOT shown in the list, used to prefill the edit sheet
  // (the manager is already authorised to read these via RLS). Carried so an edit
  // never blanks a field the form doesn't surface (the upsert is a full overwrite).
  email: string | null;
  phone: string | null;
  birthdate: string | null;
  note: string | null;
  /** Raw preferred_role enum for the edit role picker (null = no preference). */
  preferredRole: ContactRoleEnum | null;
}

export function toPoContact(row: PoContactRow): PoContact {
  const digits = (row.phone ?? '').replace(/[^0-9]/g, '');
  return {
    id: row.id,
    name: row.full_name,
    role: contactRoleToPo(row.preferred_role),
    events: row.eventCount,
    vast: row.is_permanent,
    phoneLast4: digits.length >= 4 ? digits.slice(-4) : null,
    email: row.email,
    phone: row.phone,
    birthdate: row.birthdate,
    note: row.note,
    preferredRole: row.preferred_role,
  };
}

// ── Settings adapters (S6 team/quota, S7 profile/sessions, S8 venue, billing) ──
// These output dedicated Po* view types — richer than the prototype's mock types,
// because the live action sheets need the ids + role arrays to drive invite /
// role-change / quota / session writes straight from a rendered row.

/** Roles → a human label in canonical order ("Beheerder · Financiën"). */
export function rolesLabel(roles: readonly VenueRole[]): string {
  const labels = VENUE_ROLES.filter((r) => roles.includes(r)).map((r) => ROLE_LABELS[r]);
  return labels.length > 0 ? labels.join(' · ') : 'Geen rol';
}

export interface PoTeamMember {
  userId: string;
  name: string;
  email: string;
  roles: VenueRole[];
  rolesLabel: string;
  /** Effective default guest quota — the member's own override, else the venue default. */
  quota: number;
}

export function toPoTeamMember(row: PoMemberRow, quota: number): PoTeamMember {
  return {
    userId: row.user_id,
    name: row.full_name,
    email: row.email,
    roles: row.roles,
    rolesLabel: rolesLabel(row.roles),
    quota,
  };
}

export interface PoInvite {
  id: string;
  email: string;
  roles: VenueRole[];
  rolesLabel: string;
  /** Formatted invite date ("3 dec"). */
  sentAt: string;
}

export function toPoInvite(row: PoInviteRow): PoInvite {
  return {
    id: row.id,
    email: row.email,
    roles: row.roles,
    rolesLabel: rolesLabel(row.roles),
    sentAt: fmt(row.created_at, { day: 'numeric', month: 'short' }).replace('.', ''),
  };
}

/** Best-effort device label from a User-Agent ("Safari · iPhone"). */
export function deviceLabel(ua: string | null): string {
  if (!ua) return 'Onbekend apparaat';
  const s = ua.toLowerCase();
  const browser =
    s.includes('edg') ? 'Edge'
    : s.includes('firefox') || s.includes('fxios') ? 'Firefox'
    : s.includes('chrome') || s.includes('crios') ? 'Chrome'
    : s.includes('safari') ? 'Safari'
    : 'Browser';
  const os =
    s.includes('iphone') ? 'iPhone'
    : s.includes('ipad') ? 'iPad'
    : s.includes('android') ? 'Android'
    : s.includes('mac os') || s.includes('macintosh') ? 'Mac'
    : s.includes('windows') ? 'Windows'
    : s.includes('linux') ? 'Linux'
    : '';
  return os ? `${browser} · ${os}` : browser;
}

export interface PoSession {
  id: string;
  device: string;
  where: string;
  last: string;
  current: boolean;
}

export function toPoSession(row: PoSessionRow): PoSession {
  return {
    id: row.session_id,
    device: deviceLabel(row.user_agent),
    where: row.ip ?? 'Onbekende locatie',
    last: row.is_current
      ? 'Nu actief'
      : fmt(row.updated_at, {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).replace('.', ''),
    current: row.is_current,
  };
}

export interface PoProfile {
  userId: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  roleLabel: string;
  /** MFA is mandatory for this caller's role (admin/finance) — #20. */
  mfaRequired: boolean;
}

export function toPoProfile(row: PoProfileRow, roles: readonly VenueRole[]): PoProfile {
  return {
    userId: row.id,
    name: row.full_name,
    firstName: row.first_name ?? '',
    lastName: row.last_name ?? '',
    email: row.email,
    phone: row.phone ?? '',
    roleLabel: rolesLabel(roles),
    mfaRequired: requiresMfa(roles),
  };
}

export interface PoVenueSettings {
  id: string;
  name: string;
  slug: string;
  retentionMonths: number;
  defaultPersonalQuota: number;
  companyName: string;
  kvkNumber: string;
  vatNumber: string;
  financeEmail: string;
  addressLine: string;
  postalCode: string;
  city: string;
  country: string;
}

export function toPoVenueSettings(row: PoVenueSettingsRow): PoVenueSettings {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    retentionMonths: row.retention_months,
    defaultPersonalQuota: row.default_personal_quota,
    companyName: row.company_name ?? '',
    kvkNumber: row.kvk_number ?? '',
    vatNumber: row.vat_number ?? '',
    financeEmail: row.finance_email ?? '',
    addressLine: row.address_line ?? '',
    postalCode: row.postal_code ?? '',
    city: row.city ?? '',
    country: row.country ?? 'NL',
  };
}

// Billing is read-only in the po surface (#32): map the entitlement row onto the
// prototype's Subscription card. plan_id resolves through the shared PLANS
// catalog; absent fields (IBAN mandate, invoices) stay honest placeholders until
// the Stripe adapter ships (Fase 13).
export interface PoSubscription {
  plan: string;
  priceLabel: string;
  period: string;
  status: Database['public']['Enums']['subscription_status'];
  renews: string;
  events: string;
  venueLabel: string;
}

export function toPoSubscription(
  row: PoSubscriptionRow | null,
  venueName: string
): PoSubscription | null {
  if (!row) return null;
  // plan_id resolves through the shared catalog (indie/premium/pro). A row may
  // carry a plan id outside the catalog (e.g. a pilot/legacy id) — show that id
  // humanised rather than "Geen abonnement", which is only for a truly null plan.
  const plan = row.plan_id && isPlanId(row.plan_id) ? getPlan(row.plan_id) : null;
  const priceLabel =
    plan == null
      ? '—'
      : plan.priceEur == null
        ? 'Op aanvraag'
        : plan.priceEur === 0
          ? 'Gratis'
          : `€${plan.priceEur}`;
  return {
    plan: plan?.name ?? (row.plan_id ? capitalize(row.plan_id) : 'Geen abonnement'),
    priceLabel,
    period: 'maand',
    status: row.status,
    renews: row.current_period_end
      ? fmt(row.current_period_end, { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '')
      : '—',
    events: plan?.id === 'indie' ? '1 actief event' : 'Onbeperkt',
    venueLabel: venueName,
  };
}
