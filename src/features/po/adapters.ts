import type { Guest, PoEvent, Tier, Role, GuestStatus, Priority, RecapGuest } from '@/lib/po/types';
import { eventPhase, eventWhenFromPhase } from './event-phase';
import type { Database } from '@/lib/database.types';
import type {
  PoEventRow,
  PoGuestRow,
  PoTierRow,
  PoContactRow,
  PoGuestRequestRow,
  PoQuotaRequestRow,
  RecapGuestRow,
  PoInviteRow,
  PoVenueCrewRow,
  PoMyInviteRow,
  PoMemberRow,
  PoProfileRow,
  PoSessionRow,
  PoSubscriptionRow,
  PoVenueSettingsRow,
  PoQuotaStatus,
  ContactProfileHeader,
  ContactAppearance,
} from './queries';
import type { EventSummary, TierStat } from '@/features/stats/data';
import { formatClock, toDateInput } from '@/features/stats/format';
import { toPerTier, type PerTier } from '@/features/stats/po-adapter';
import { ROLE_LABELS, VENUE_ROLES, requiresMfa, type VenueRole } from '@/features/auth/roles';
import { getPlan, isPlanId, trialEndsAt } from '@/features/billing/plans';
import { deviceLabel } from '@/lib/ua';

// Pure DB-row -> po-component-shape mappers (mirrors src/features/stats/po-adapter.ts).
// No I/O, so they're unit-tested directly (adapters.test.ts). The po mock types
// carry a few UI-only fields the core schema doesn't model — payment status (no
// ticketing, #10) and the door check-in time/by (those live in check_ins via the
// DoorProvider, #25). Those default here and get real values when the screens
// wire up (STAP 3.3+); cross-entity bits (a guest's role badge, who added it) are
// passed in by the caller so the mappers stay pure.

type NotePriority = Database['public']['Enums']['note_priority'];
type GuestRowStatus = Database['public']['Enums']['guest_status'];

const TZ = 'Europe/Amsterdam';

function fmt(iso: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opts }).format(new Date(iso));
}
function capitalize(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
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
  if (n.includes('pers') || n.includes('press')) return 'Press';
  if (n.includes('crew')) return 'Crew';
  return 'Guest';
}

export interface EventCounts {
  /** Registered headcount (1 + plus-ones), aggregated by the caller. */
  guests: number;
  /** Present headcount (checked-in), aggregated by the caller. */
  inside: number;
}

export function toPoEvent(row: PoEventRow, counts: EventCounts, nowMs: number = Date.now()): PoEvent {
  const phase = eventPhase(row.starts_at, row.ends_at, nowMs);
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
    when: eventWhenFromPhase(phase),
    phase,
    cancelled: row.cancelled_at != null,
  };
}

// ── Mobile Dashboard-home (S11) ───────────────────────────────────────────────
// One pure mapper turns the featured event + its live reads (role-scoped on-list /
// present headcounts / open guest_requests count / event_quota_status) into the
// shape the Home screen renders, so the screen stays markup-only and the branching
// (which scenario, headcounts, quota copy) is unit-tested here. Mirrors the
// prototype's three states: a live night, a "deur dicht" pre-event tonight, and a
// quiet day where only the next event is announced.

export type HomeScenario = 'live' | 'pre' | 'quiet';

export interface PoHomeView {
  /** live = event running; pre = starts today, door still shut; quiet = future day. */
  scenario: HomeScenario;
  id: string;
  name: string;
  venue: string;
  /** "Za 14 dec" (Amsterdam). */
  dateLabel: string;
  /** "23:00" (Amsterdam, 24h). */
  time: string;
  /** Badge copy: "Live now" / "Tonight · doors closed" / "Nothing live". */
  statusLabel: string;
  locked: boolean;
  /** Whole calendar days until the event (Amsterdam); 0 today/past. */
  daysUntil: number;
  /** Present headcount (1 + plus-ones over checked-in). */
  inside: number;
  /** Registered headcount (1 + plus-ones over approved/checked-in). */
  registered: number;
  /** On the list but not yet inside (registered − present); shown when live. */
  walking: number;
  /** Present / registered as a whole percentage; 0 when none registered. */
  attendancePct: number;
  /** Open (pending) guest requests — the KPI badge. */
  requests: number;
  /** event_quota_status resolved → null when the caller is exempt or unknown. */
  quotaFree: number | null;
  quotaTotal: number;
  quotaConsumed: number;
  quotaExempt: boolean;
  /** False when event_quota_status returned nothing (render "—", no sheet). */
  quotaKnown: boolean;
}

const DAY_MS = 86_400_000;

/** Whole calendar days from `nowMs` to the event start, both in Amsterdam TZ, so
 *  "tonight at 23:00" reads as today (0) regardless of the UTC date rollover. */
function daysUntilEvent(startsAt: string, nowMs: number): number {
  const start = Date.parse(toDateInput(startsAt));
  const today = Date.parse(toDateInput(new Date(nowMs).toISOString()));
  return Math.round((start - today) / DAY_MS);
}

/**
 * The featured event plus its role-scoped headcounts. `registered`/`present` come
 * from the same guest-row aggregation the Events cards use (fetchEventHeadcounts),
 * NOT from event_stats_summary — that RPC is admin/finance/organizer-gated, so a
 * doorhost would read 0. RLS still scopes the rows, so a staff member's counts are
 * their own slice, consistent with the rest of the app.
 */
export type HomeEvent = PoEventRow & {
  /** On-list headcount (1 + plus-ones over approved/checked-in). */
  registered: number;
  /** Present headcount (1 + plus-ones over checked-in). */
  present: number;
};

export function toPoHome(
  active: HomeEvent,
  openRequests: number,
  quota: PoQuotaStatus | null,
  nowMs: number
): PoHomeView {
  const dayDiff = daysUntilEvent(active.starts_at, nowMs);
  const scenario: HomeScenario =
    eventPhase(active.starts_at, active.ends_at, nowMs) === 'live'
      ? 'live'
      : dayDiff >= 1
        ? 'quiet'
        : 'pre';

  const inside = active.present;
  const registered = active.registered;
  const statusLabel =
    scenario === 'live' ? 'Live now' : scenario === 'pre' ? 'Tonight · doors closed' : 'Nothing live';

  return {
    scenario,
    id: active.id,
    name: active.name,
    venue: active.venue_name,
    dateLabel: capitalize(
      fmt(active.starts_at, { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '')
    ),
    time: fmt(active.starts_at, { hour: '2-digit', minute: '2-digit', hour12: false }),
    statusLabel,
    locked: active.list_locked,
    daysUntil: Math.max(0, dayDiff),
    inside,
    registered,
    walking: Math.max(0, registered - inside),
    attendancePct: registered > 0 ? Math.round((inside / registered) * 100) : 0,
    requests: openRequests,
    quotaFree: quota ? (quota.exempt ? null : quota.remaining) : null,
    quotaTotal: quota?.quota ?? 0,
    quotaConsumed: quota?.consumed ?? 0,
    quotaExempt: quota?.exempt ?? false,
    quotaKnown: quota != null,
  };
}

export interface GuestExtras {
  /** Role badge, resolved from the guest's tier by the caller. */
  role: Role;
  /** Real tier name (guest_tiers.name) — the role badge is lossy, this isn't. */
  tierName?: string;
  /** The tier's color (guest_tiers.color) — drives the door-style tier pill. */
  tierColor?: string;
  /** Display name of who added the guest (profiles join); '' when unknown. */
  addedBy?: string;
  /** Owning event id/name — set only on the venue-wide ("all guests") read so a
   *  row can badge + deep-link to its event; omitted in single-event mode. */
  eventId?: string;
  eventName?: string;
}

export function toPoGuest(row: PoGuestRow, extras: GuestExtras): Guest {
  return {
    id: row.id,
    name: row.full_name,
    role: extras.role,
    tierId: row.tier_id,
    tierName: extras.tierName,
    tierColor: extras.tierColor,
    // Payment isn't modelled in the core schema (no ticketing, #10) — UI default.
    pay: 'free',
    plus: row.plus_ones,
    note: row.note ?? '',
    flag: notePriorityToFlag(row.note_priority),
    by: extras.addedBy ?? '',
    addedAt: fmt(row.created_at, { day: 'numeric', month: 'short' }).replace('.', ''),
    status: guestStatusToPo(row.status),
    contactId: row.contact_id,
    eventId: extras.eventId,
    eventName: extras.eventName,
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
  const tier = tiers.find((t) => t.id === args.tierId);
  return {
    id: args.id ?? `optimistic-${args.fullName}`,
    name: args.fullName,
    role: tier?.role ?? 'Guest',
    tierId: args.tierId,
    tierName: tier?.name,
    tierColor: tier?.color,
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
    // Door price (euros) from guest_tiers.door_price_cents (#34 — display only, no
    // payment processing). 0 = free.
    doorPrice: (row.door_price_cents ?? 0) / 100,
    // Display-only VAT-% (T3, no billing); only meaningful when doorPrice > 0.
    vatPercent: row.vat_percent,
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
  press: 'Press',
  crew: 'Crew',
  guest: 'Guest',
};

/** A contact's preferred_role → the po Role badge (null → "Guest"). */
export function contactRoleToPo(role: ContactRoleEnum | null): Role {
  return role ? CONTACT_ROLE_TO_PO[role] : 'Guest';
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

// ── Contact profile (address-book detail) ──
// Pure mapper: the contact header + all appearances + resolved actor names → the
// contact-profile view. Derived-only — the timeline is built from the add /
// check-in / void / refusal events we can read, NOT the audit log, so field edits
// and tier-change history are intentionally absent (those live in the Audit screen).
// Two sections fall out: the per-event roster (events newest-first, with tier, +N
// and present heads) and the merged activity timeline (newest-first).

export type ContactEventStatus = 'inside' | 'onTheWay' | 'refused';

export interface PoProfileEvent {
  eventId: string;
  /** Guest row for this appearance — used for tier changes. */
  guestId: string;
  name: string;
  /** "Sat 14 Dec 2024" (Amsterdam). */
  dateLabel: string;
  tier: string | null;
  tierColor: string;
  /** Role badge derived from the tier name. */
  role: Role;
  status: ContactEventStatus;
  /** Registered extra guests (+N). */
  plusOnes: number;
  /** Heads actually present (1 + arrived companions); null when they never arrived. */
  presentHeads: number | null;
  /** Total registered heads (1 + plusOnes). */
  registeredHeads: number;
  /** Per-event door note (task), shown prominently on the pinned event. */
  note: string | null;
  /** Note priority as the po flag ("high" → accent task card). */
  noteFlag: Priority | null;
  /** True for the event the profile was opened from — pinned to the top. */
  isOrigin: boolean;
  /** ISO event start — sorting + keys. */
  startsAt: string;
}

export type ContactTimelineKind = 'added' | 'checkin' | 'void' | 'refusal';

export interface PoProfileTimelineItem {
  key: string;
  kind: ContactTimelineKind;
  /** Event this happened on (the timeline spans events). */
  event: string;
  /** Resolved actor name; '' when unknown (the screen renders a fallback). */
  who: string;
  /** "14 Dec · 23:14" (Amsterdam). */
  when: string;
  /** Companions present (kind='checkin'); 0 otherwise. */
  arrived: number;
  /** Refusal reason (kind='refusal'); '' otherwise. */
  reason: string;
  /** ISO instant — for ordering. */
  ts: string;
}

export interface PoContactProfile {
  id: string;
  name: string;
  role: Role;
  vast: boolean;
  email: string | null;
  phone: string | null;
  /** "12 Apr 1996" or null. */
  birthday: string | null;
  note: string | null;
  /** "3 Dec 2024" — when the contact was first saved. */
  since: string;
  eventsCount: number;
  attendedCount: number;
  refusedCount: number;
  /** Sum of registered plus-ones across all appearances. */
  plusOnesTotal: number;
  events: PoProfileEvent[];
  timeline: PoProfileTimelineItem[];
  /** True once this person is a real address-book contact (has email/phone). */
  isContact: boolean;
  /** Name-only guest: the guest row to edit to promote it; null when a contact. */
  promoteGuestId: string | null;
  // Raw fields the edit / add-to-event sheets reuse (mirror PoContact), so the
  // profile can drive those writes without a second contacts read.
  phoneLast4: string | null;
  birthdate: string | null;
  preferredRole: ContactRoleEnum | null;
}

/** "14 Dec · 23:14" (Amsterdam) for a timeline instant. */
function timelineWhen(iso: string): string {
  const date = fmt(iso, { day: 'numeric', month: 'short' }).replace('.', '');
  const time = fmt(iso, { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date} · ${time}`;
}

function profileEventStatus(status: GuestRowStatus): ContactEventStatus {
  const s = guestStatusToPo(status);
  return s === 'in' ? 'inside' : s === 'refused' ? 'refused' : 'onTheWay';
}

export function toPoContactProfile(
  header: ContactProfileHeader,
  appearances: ContactAppearance[],
  actorNames: Record<string, string>,
  opts: { isContact?: boolean; promoteGuestId?: string | null; originEventId?: string | null } = {}
): PoContactProfile {
  const isContact = opts.isContact ?? true;
  const originEventId = opts.originEventId ?? null;
  const events: PoProfileEvent[] = appearances
    .map((a) => {
      // The active (non-voided) check-in is "currently inside"; its arrived count
      // gives the present heads (a +2 guest with 1 companion present = 2 heads in).
      const active = a.checkIns.find((c) => c.voidedAt == null) ?? null;
      return {
        eventId: a.eventId,
        guestId: a.guestId,
        name: a.eventName,
        dateLabel: capitalize(
          // en-GB renders the weekday+year form as "Sat, 14 Dec 2024" — drop the
          // comma (and any abbrev dots) for the clean "Sat 14 Dec 2024".
          fmt(a.eventStartsAt, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).replace(/[.,]/g, '')
        ),
        tier: a.tierName,
        tierColor: a.tierColor ?? DEFAULT_TIER_COLOR,
        role: tierRole(a.tierName ?? ''),
        status: profileEventStatus(a.status),
        plusOnes: a.plusOnes,
        presentHeads: active ? 1 + active.arrived : null,
        registeredHeads: 1 + a.plusOnes,
        note: a.note,
        noteFlag: notePriorityToFlag(a.notePriority),
        isOrigin: originEventId != null && a.eventId === originEventId,
        startsAt: a.eventStartsAt,
      };
    })
    // Pin the event you came from to the top, then newest-first.
    .sort((x, y) => {
      if (x.isOrigin !== y.isOrigin) return x.isOrigin ? -1 : 1;
      return y.startsAt.localeCompare(x.startsAt);
    });

  const timeline: PoProfileTimelineItem[] = [];
  for (const a of appearances) {
    timeline.push({
      key: `add-${a.guestId}`,
      kind: 'added',
      event: a.eventName,
      who: actorNames[a.addedBy] ?? '',
      when: timelineWhen(a.addedAt),
      arrived: 0,
      reason: '',
      ts: a.addedAt,
    });
    for (const c of a.checkIns) {
      timeline.push({
        key: `in-${a.guestId}-${c.checkedAt}`,
        kind: 'checkin',
        event: a.eventName,
        who: actorNames[c.checkedBy] ?? '',
        when: timelineWhen(c.checkedAt),
        arrived: c.arrived,
        reason: '',
        ts: c.checkedAt,
      });
      if (c.voidedAt) {
        timeline.push({
          key: `void-${a.guestId}-${c.voidedAt}`,
          kind: 'void',
          event: a.eventName,
          who: c.voidedBy ? actorNames[c.voidedBy] ?? '' : '',
          when: timelineWhen(c.voidedAt),
          arrived: 0,
          reason: '',
          ts: c.voidedAt,
        });
      }
    }
    for (const r of a.refusals) {
      timeline.push({
        key: `ref-${a.guestId}-${r.refusedAt}`,
        kind: 'refusal',
        event: a.eventName,
        who: actorNames[r.refusedBy] ?? '',
        when: timelineWhen(r.refusedAt),
        arrived: 0,
        reason: r.reason,
        ts: r.refusedAt,
      });
    }
  }
  // Newest-first across every event — the whole story as one feed.
  timeline.sort((x, y) => y.ts.localeCompare(x.ts));

  const digits = (header.phone ?? '').replace(/[^0-9]/g, '');
  return {
    id: header.id,
    name: header.fullName,
    // A real contact badges from its preferred_role; a name-only guest has none,
    // so fall back to the tier role of its (single) appearance.
    role: isContact ? contactRoleToPo(header.preferredRole) : events[0]?.role ?? 'Guest',
    vast: header.isPermanent,
    email: header.email,
    phone: header.phone,
    birthday: header.birthdate
      ? fmt(header.birthdate, { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '')
      : null,
    note: header.note,
    since: fmt(header.createdAt, { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', ''),
    eventsCount: appearances.length,
    attendedCount: appearances.filter((a) => a.checkIns.some((c) => c.voidedAt == null)).length,
    refusedCount: appearances.filter((a) => a.status === 'refused').length,
    plusOnesTotal: appearances.reduce((sum, a) => sum + a.plusOnes, 0),
    events,
    timeline,
    isContact,
    promoteGuestId: opts.promoteGuestId ?? null,
    phoneLast4: digits.length >= 4 ? digits.slice(-4) : null,
    birthdate: header.birthdate,
    preferredRole: header.preferredRole,
  };
}

// ── Approvals adapters (S5 Aanvragen) ──
// The mock request types carried relative timestamps + a few computed nudges.
// We rebuild those from the live row: a compact "X min ago" string
// (pure — `now` is injectable for tests) and a single deterministic large-group
// flag, so the polished inbox keeps its look without inventing data. Payment /
// "notify the guest" copy is dropped: there is no ticketing or outbound mail (#10).

/** Compact relative time ("just now" / "18 min ago" / "3 days ago"). */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const diffMs = now.getTime() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.floor(hr / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return fmt(iso, { day: 'numeric', month: 'short' }).replace('.', '');
}

export interface PoGuestRequest {
  id: string;
  /** Event this request belongs to (for grouping + targeting the right tiers). */
  eventId: string;
  name: string;
  /** Extra guests (+N); the headcount is 1 + plus. */
  plus: number;
  /** Last-4 phone digits as a privacy-light identity hint, or null. */
  phoneLast4: string | null;
  motivation: string;
  /** Relative time of submission. */
  at: string;
  /** Open queue, already-refused (still re-addable), or approved (the query only
   *  returns AUTO-approved ones — the read-only trace section). */
  status: 'pending' | 'denied' | 'approved';
  /** How an approved/denied request was decided (F1): by a human or by an
   *  auto-approve link. 'manual' for undecided rows (the column's default). */
  decidedVia: Database['public']['Enums']['decision_source'];
  /** The request link this came through, or null (legacy / direct). */
  requestLinkId: string | null;
  /** Resolved link identity (influencer name ?? label); null for the default link. */
  viaLabel: string | null;
  /** The refusal reason when status is 'denied'; null otherwise. */
  denyReason: string | null;
  /** Deterministic nudge for a large party (+3 or more); absent otherwise. */
  flag?: string;
}

/**
 * The single definition of an "open" landing request, shared by Home's board
 * counter + event-card inbox badge (toBoardEvents), the Home pulse strip, and the
 * Requests screen. Only `pending` is open — `denied` and (auto-)`approved` are
 * settled history. This is the T9 fix: before it, the board counted the whole
 * list (pending + denied + auto-approved) while the Requests screen counted
 * pending only, so a declined request read as "1 open" on Home while the inbox
 * said "clear". One predicate keeps every counter in lock-step.
 */
export const isOpenGuestRequest = (r: { status: string }): boolean => r.status === 'pending';

export function toPoGuestRequest(row: PoGuestRequestRow, now?: Date): PoGuestRequest {
  const digits = (row.phone ?? '').replace(/[^0-9]/g, '');
  // request_status is pending | approved | denied — narrow defensively so the
  // screen never mislabels a row (approved only reaches us for auto-approvals).
  const status: PoGuestRequest['status'] =
    row.status === 'denied' ? 'denied' : row.status === 'approved' ? 'approved' : 'pending';
  return {
    id: row.id,
    eventId: row.event_id,
    name: row.full_name,
    plus: row.plus_ones,
    phoneLast4: digits.length >= 4 ? digits.slice(-4) : null,
    motivation: row.motivation ?? '',
    at: relativeTime(row.created_at, now),
    status,
    decidedVia: row.decided_via,
    requestLinkId: row.request_link_id,
    viaLabel: row.viaLabel,
    denyReason: status === 'denied' ? row.decision_reason : null,
    flag: row.plus_ones >= 3 ? `Large group (+${row.plus_ones})` : undefined,
  };
}

export interface PoQuotaRequest {
  id: string;
  /** Event this request belongs to (for grouping + per-event invalidation). */
  eventId: string;
  who: string;
  /** Extra slots requested (#5) — shown as "+N". */
  extra: number;
  reason: string;
  at: string;
}

export function toPoQuotaRequest(row: PoQuotaRequestRow, now?: Date): PoQuotaRequest {
  return {
    id: row.id,
    eventId: row.eventId,
    who: row.requesterName,
    extra: row.requestedExtra,
    reason: row.motivation ?? '',
    at: relativeTime(row.created_at, now),
  };
}

// ── Settings adapters (S6 team/quota, S7 profile/sessions, S8 venue, billing) ──
// These output dedicated Po* view types — richer than the prototype's mock types,
// because the live action sheets need the ids + role arrays to drive invite /
// role-change / quota / session writes straight from a rendered row.

/** Roles → a human label in canonical order ("Admin · Finance"). */
export function rolesLabel(roles: readonly VenueRole[]): string {
  const labels = VENUE_ROLES.filter((r) => roles.includes(r)).map((r) => ROLE_LABELS[r]);
  return labels.length > 0 ? labels.join(' · ') : 'No role';
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

export type PoInviteStatus = 'pending' | 'expired' | 'accepted';

export interface PoInvite {
  id: string;
  email: string;
  roles: VenueRole[];
  rolesLabel: string;
  /** Formatted invite date ("3 dec"). */
  sentAt: string;
  /** Accepted wins; an un-accepted invite past its expiry is expired (T8). */
  status: PoInviteStatus;
}

export function toPoInvite(row: PoInviteRow, now: number = Date.now()): PoInvite {
  const status: PoInviteStatus = row.accepted_at
    ? 'accepted'
    : new Date(row.expires_at).getTime() <= now
      ? 'expired'
      : 'pending';
  return {
    id: row.id,
    email: row.email,
    roles: row.roles,
    rolesLabel: rolesLabel(row.roles),
    sentAt: fmt(row.created_at, { day: 'numeric', month: 'short' }).replace('.', ''),
    status,
  };
}

/** A venue-wide External-crew row for the Team screen's second section (T8). */
export interface PoVenueCrewMember {
  userId: string;
  name: string;
  email: string;
  /** "Eventname" or "Eventname +2" — soonest event first. */
  eventsLabel: string;
  eventCount: number;
  /** False until the person completes a first login — renders as a pending
   *  invite with a resend action. */
  hasAccepted: boolean;
}

export function toPoVenueCrewMember(row: PoVenueCrewRow): PoVenueCrewMember {
  const [first] = row.event_names;
  const extra = row.event_names.length - 1;
  return {
    userId: row.user_id,
    name: row.full_name,
    email: row.email,
    eventsLabel: first ? (extra > 0 ? `${first} +${extra}` : first) : '—',
    eventCount: row.event_names.length,
    hasAccepted: row.terms_accepted_at !== null,
  };
}

/** An invite addressed to the current user (the incoming "accepteer uitnodiging"
 *  banner), with the inviting venue's name. */
export interface PoMyInvite {
  id: string;
  venueName: string;
  rolesLabel: string;
}

export function toPoMyInvite(row: PoMyInviteRow): PoMyInvite {
  return {
    id: row.id,
    venueName: row.venue_name ?? 'a venue',
    rolesLabel: rolesLabel(row.roles),
  };
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
    where: row.ip ?? 'Unknown location',
    last: row.is_current
      ? 'Active now'
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

/** One row in the deduped sessions list: identical non-current sessions (same
 *  device label + IP — e.g. the 12 "Chrome · Windows · 172.18.0.1" rows from
 *  repeated dev logins) collapse into a single row with a count, and "Log out"
 *  revokes every session in the group (2/7 walkthrough). */
export interface PoSessionGroup {
  /** All session ids in the group, newest first (input order preserved). */
  ids: string[];
  device: string;
  where: string;
  /** Last-seen of the newest session in the group. */
  last: string;
  count: number;
}

/** Collapse identical non-current sessions (device + IP) into groups. Input order
 *  (newest activity first, per the RPC) is preserved; each group carries the
 *  newest session's last-seen. Current sessions must be filtered out by the
 *  caller — they render as their own "This device" row. */
export function groupPoSessions(sessions: PoSession[]): PoSessionGroup[] {
  const groups = new Map<string, PoSessionGroup>();
  for (const s of sessions) {
    const key = `${s.device}|${s.where}`;
    const g = groups.get(key);
    if (g) {
      g.ids.push(s.id);
      g.count += 1;
    } else {
      groups.set(key, { ids: [s.id], device: s.device, where: s.where, last: s.last, count: 1 });
    }
  }
  return [...groups.values()];
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
  /** Company-wide default: may a check-in be reversed (uitchecken, #3 / S1.1)? */
  allowUncheck: boolean;
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
    allowUncheck: row.allow_uncheck,
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
  /** A Stripe subscription exists — checkout done, portal available. */
  stripeLinked: boolean;
  /** End of the 14-day display trial (ISO); null unless status is trialing. */
  trialEndsAt: string | null;
}

export function toPoSubscription(
  row: PoSubscriptionRow | null,
  venueName: string
): PoSubscription | null {
  if (!row) return null;
  // plan_id resolves through the shared catalog (indie/premium/pro). A row may
  // carry a plan id outside the catalog (e.g. a pilot/legacy id) — show that id
  // humanised rather than "No subscription", which is only for a truly null plan.
  const plan = row.plan_id && isPlanId(row.plan_id) ? getPlan(row.plan_id) : null;
  const priceLabel =
    plan == null
      ? '—'
      : plan.priceEur == null
        ? 'On request'
        : plan.priceEur === 0
          ? 'Free'
          : `€${plan.priceEur}`;
  return {
    plan: plan?.name ?? (row.plan_id ? capitalize(row.plan_id) : 'No subscription'),
    priceLabel,
    period: 'month',
    status: row.status,
    renews: row.current_period_end
      ? fmt(row.current_period_end, { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '')
      : '—',
    events: plan?.id === 'indie' ? '1 active event' : 'Unlimited',
    venueLabel: venueName,
    stripeLinked: !!row.stripe_subscription_id,
    trialEndsAt: row.status === 'trialing' ? trialEndsAt(row.created_at).toISOString() : null,
  };
}
