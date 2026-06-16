'use client';

/**
 * Live data for the DESKTOP dashboard (`src/components/po/desktop/*`).
 *
 * Same contract as `PoLiveProvider` / `live-queries.ts`: every read goes through
 * the caller's USER-scoped browser client so RLS is the security boundary
 * (CLAUDE.md — never the service client). Fetchers return the prototype view
 * types (`AuditEntry`, `TeamMember`, `Invite`) so the desktop views render them
 * unchanged. Hooks run inside `PoLiveProvider` (it supplies the QueryClient +
 * `useSession`) and key off `['po', '<domain>', …]`.
 *
 * Audit note: `audit_log` SELECT requires admin/finance **and AAL2** (RLS
 * `audit_log_select_aal2`). A non-AAL2 admin simply sees zero rows — the hook
 * surfaces that as an honest empty state rather than an error. Locally,
 * `DEV_AUTH_SKIP_MFA` covers the AAL2 gate.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/database.types';
import type { AuditEntry, Invite, TeamMember } from '@/lib/po/types';
import { useSession } from './PoLiveProvider';

type Client = SupabaseClient<Database>;
type VenueRole = Database['public']['Enums']['venue_role'];

// One browser client per hook instance (mirrors PoLiveProvider.useBrowserClient).
function useBrowserClient(): Client {
  const [client] = useState(() => createClient());
  return client;
}

// ── shared formatting ─────────────────────────────────────────────────────────
const TZ = 'Europe/Amsterdam';

/** "Vandaag 23:42" / "Gisteren 16:02" / "9 nov 22:14" — NL, venue-local time. */
function relativeWhen(iso: string, now: Date): string {
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat('nl-NL', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);

  // Compare calendar days in the venue timezone (not UTC) so "vandaag" is right.
  const dayKey = (x: Date): string =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(x);
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000));
  const key = dayKey(d);

  if (key === today) return `Vandaag ${time}`;
  if (key === yesterday) return `Gisteren ${time}`;
  const date = new Intl.DateTimeFormat('nl-NL', {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
  })
    .format(d)
    .replace('.', '');
  return `${date} ${time}`;
}

// ── AUDIT LOG ──────────────────────────────────────────────────────────────────

const ENTITY_LABEL: Record<string, string> = {
  guests: 'gast',
  guest_tiers: 'tier',
  quotas: 'quotum',
  event_quotas: 'quotum',
  quota_requests: 'quotumverzoek',
  check_ins: 'check-in',
  refusals: 'weigering',
  venue_memberships: 'teamlid',
  events: 'event',
};

interface DiffShape {
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

function asDiff(d: Json | null): DiffShape {
  if (d && typeof d === 'object' && !Array.isArray(d)) return d as DiffShape;
  return {};
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}

/** Label a guest from a diff snapshot: "Lieke Hofman +2". */
function guestLabel(row: Record<string, unknown> | null | undefined): string | null {
  if (!row) return null;
  const name = str(row.full_name);
  if (!name) return null;
  const plus = num(row.plus_ones) ?? 0;
  return plus > 0 ? `${name} +${plus}` : name;
}

/**
 * Build the readable sentence the desktop renders, derived from the audit row
 * the triggers wrote (action + entity_type + {before,after} diff). The DB does
 * not store a sentence (#15: triggers store the structured diff), so this is the
 * presentation-side translation — kept deterministic and PII-light.
 */
function auditText(
  action: string,
  entityType: string,
  diff: DiffShape,
): { entity: string; text: string } {
  const after = diff.after ?? null;
  const before = diff.before ?? null;

  switch (entityType) {
    case 'guests': {
      const label = guestLabel(after) ?? guestLabel(before) ?? 'een gast';
      switch (action) {
        case 'create':
          return { entity: label, text: `voegde ${label} toe` };
        case 'check_in':
          return { entity: label, text: `checkte ${label} in aan de deur` };
        case 'refuse':
          return { entity: label, text: `weigerde ${label}` };
        case 'delete':
          return { entity: label, text: `verwijderde ${label} (soft delete)` };
        case 'tier_change':
          return { entity: label, text: `verplaatste ${label} naar een andere tier` };
        default:
          return { entity: label, text: `wijzigde ${label}` };
      }
    }
    case 'check_ins': {
      const plus = num(after?.plus_ones_arrived) ?? 0;
      const who = plus > 0 ? `een gast +${plus}` : 'een gast';
      return { entity: 'Check-in', text: `checkte ${who} in aan de deur` };
    }
    case 'refusals':
      return { entity: 'Weigering', text: 'weigerde een gast aan de deur' };
    case 'guest_tiers': {
      const label = str(after?.name) ?? str(before?.name) ?? 'een tier';
      const verb = action === 'create' ? 'maakte' : action === 'delete' ? 'verwijderde' : 'wijzigde';
      return { entity: label, text: `${verb} tier ${label}` };
    }
    case 'events': {
      const label = str(after?.name) ?? str(before?.name) ?? 'de gastenlijst';
      return action === 'lock'
        ? { entity: label, text: `vergrendelde de gastenlijst van ${label}` }
        : { entity: label, text: `ontgrendelde de gastenlijst van ${label}` };
    }
    case 'quotas':
    case 'event_quotas':
      return { entity: 'Quotum', text: 'paste een quotum aan' };
    case 'quota_requests':
      if (action === 'approve') return { entity: 'Quotumverzoek', text: 'keurde een quotumverzoek goed' };
      if (action === 'deny') return { entity: 'Quotumverzoek', text: 'wees een quotumverzoek af' };
      return { entity: 'Quotumverzoek', text: 'diende een quotumverzoek in' };
    case 'venue_memberships':
      if (action === 'create') return { entity: 'Teamlid', text: 'voegde een teamlid toe' };
      if (action === 'delete') return { entity: 'Teamlid', text: 'verwijderde een teamlid' };
      return { entity: 'Teamlid', text: 'wijzigde de rollen van een teamlid' };
    default: {
      const label = ENTITY_LABEL[entityType] ?? 'een item';
      return { entity: label, text: `${action} op ${label}` };
    }
  }
}

/** Map an audit_log row (+ joined actor/event) onto the prototype AuditEntry. */
function toAuditEntry(
  row: {
    id: string;
    action: string;
    entity_type: string;
    created_at: string;
    device_id: string | null;
    diff: Json | null;
    actor: { full_name: string | null } | null;
    event: { name: string | null } | null;
  },
  now: Date,
): AuditEntry {
  const actorName = row.actor?.full_name ?? 'Systeem';
  const diff = asDiff(row.diff);
  const { entity, text } = auditText(row.action, row.entity_type, diff);
  // device_id is an opaque PWA/door identifier — show a coarse, non-PII label.
  const device = row.device_id ? 'deur-apparaat' : 'web';
  return {
    id: row.id,
    actor: actorName,
    action: row.action,
    entity,
    text,
    event: row.event?.name ?? '',
    when: relativeWhen(row.created_at, now),
    device,
  };
}

async function fetchAuditEntries(client: Client, venueId: string): Promise<AuditEntry[]> {
  const { data, error } = await client
    .from('audit_log')
    .select(
      'id, action, entity_type, created_at, device_id, diff, actor:user_profiles!audit_log_actor_id_fkey(full_name), event:events!audit_log_event_id_fkey(name)',
    )
    .eq('venue_id', venueId)
    .order('created_at', { ascending: false })
    .limit(200);

  // RLS denies non-AAL2 / non-admin reads by returning zero rows (not an error);
  // a real error (e.g. offline) bubbles up to react-query's error state.
  if (error) throw error;
  const now = new Date();
  return (data ?? []).map((r) => toAuditEntry(r, now));
}

/**
 * Audit log for the current venue. Requires admin/finance + AAL2 (RLS); without
 * AAL2 the query simply returns []. Mapped to the prototype AuditEntry[].
 */
export function usePoAudit(): { entries: AuditEntry[]; isLoading: boolean; isError: boolean } {
  const client = useBrowserClient();
  const { currentVenue } = useSession();
  const venueId = currentVenue?.id ?? null;
  const { data: entries = [], isLoading, isError } = useQuery({
    queryKey: ['po', 'audit', venueId],
    queryFn: () => (venueId ? fetchAuditEntries(client, venueId) : Promise.resolve([])),
    enabled: Boolean(venueId),
  });
  return { entries, isLoading, isError };
}

// ── USERS (team + invites) ─────────────────────────────────────────────────────

// Maps the venue_role set onto the prototype's coarse "role" label + the chips
// the Users view shows. The prototype only carried example roles; real roles are
// the venue_role enum (#7/#8 — multiple roles per user).
const ROLE_CHIP: Record<VenueRole, string> = {
  admin: 'Admin',
  finance: 'Finance',
  user_manager: 'User manager',
  staff: 'Staff',
  doorhost: 'Doorhost',
};

/** A short headline role for the row subtitle, by precedence. */
function headlineRole(roles: VenueRole[]): string {
  if (roles.includes('admin')) return 'Admin';
  if (roles.includes('finance')) return 'Finance';
  if (roles.includes('user_manager')) return 'User manager';
  if (roles.includes('doorhost')) return 'Doorhost';
  if (roles.includes('staff')) return 'Staff';
  return 'Lid';
}

export interface DesktopTeamMember extends TeamMember {
  /** The real venue_role set — drives the role chips (TeamMember has none). */
  roleChips: string[];
  /** Admin/finance get MFA; everyone else OTP (CLAUDE.md Auth). */
  mfa: boolean;
}

function toTeamMember(roles: VenueRole[], fullName: string): DesktopTeamMember {
  const mfa = roles.includes('admin') || roles.includes('finance');
  return {
    name: fullName,
    role: headlineRole(roles),
    // Quota is per-event (#4) and not modelled on the membership — show a dash
    // here rather than invent a number.
    allow: '—',
    used: 0,
    max: null,
    roleChips: roles.map((r) => ROLE_CHIP[r] ?? r),
    mfa,
  };
}

function toInvite(row: {
  email: string;
  roles: VenueRole[];
  created_at: string;
  default_quota: number | null;
}, now: Date): Invite {
  return {
    email: row.email,
    roles: row.roles.map((r) => ROLE_CHIP[r] ?? r),
    status: 'pending',
    at: relativeWhen(row.created_at, now),
    quota: row.default_quota,
  };
}

export interface DesktopTeam {
  team: DesktopTeamMember[];
  invites: Invite[];
}

async function fetchTeam(client: Client, venueId: string): Promise<DesktopTeam> {
  const [{ data: memberships, error: mErr }, { data: inviteRows, error: iErr }] = await Promise.all([
    client
      .from('venue_memberships')
      .select('roles, user:user_profiles!venue_memberships_user_id_fkey(full_name, email)')
      .eq('venue_id', venueId),
    // Only invites that are still outstanding (not yet accepted).
    client
      .from('invites')
      .select('email, roles, created_at, default_quota')
      .eq('venue_id', venueId)
      .is('accepted_at', null)
      .order('created_at', { ascending: false }),
  ]);
  if (mErr) throw mErr;
  if (iErr) throw iErr;

  const now = new Date();
  const team = (memberships ?? [])
    .map((m) => {
      const u = m.user as { full_name: string | null; email: string | null } | null;
      const name = u?.full_name ?? u?.email ?? 'Onbekend';
      return toTeamMember(m.roles ?? [], name);
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'nl'));

  const invites = (inviteRows ?? []).map((r) => toInvite(r, now));
  return { team, invites };
}

/** Team (memberships + profiles) + outstanding invites for the current venue. */
export function usePoTeam(): { team: DesktopTeamMember[]; invites: Invite[]; isLoading: boolean } {
  const client = useBrowserClient();
  const { currentVenue } = useSession();
  const venueId = currentVenue?.id ?? null;
  const { data, isLoading } = useQuery({
    queryKey: ['po', 'team', venueId],
    queryFn: () =>
      venueId ? fetchTeam(client, venueId) : Promise.resolve({ team: [], invites: [] } as DesktopTeam),
    enabled: Boolean(venueId),
  });
  return { team: data?.team ?? [], invites: data?.invites ?? [], isLoading };
}

// ── PER-EVENT QUOTA (#5) ────────────────────────────────────────────────────────

/**
 * One team member's quota standing FOR A SPECIFIC EVENT. `venueDefault` is the
 * member's standing allotment (`quotas.default_count`); `override` is the
 * per-event opt-in (`event_quotas.quota_override`) or null when they fall back
 * to the default. Effective = override ?? venueDefault.
 */
export interface EventQuotaRow {
  userId: string;
  name: string;
  role: string;
  venueDefault: number;
  override: number | null;
}

async function fetchEventQuotas(client: Client, venueId: string, eventId: string): Promise<EventQuotaRow[]> {
  // Memberships drive the row set; the two quota tables only annotate it. Reading
  // quotas/event_quotas is RLS-gated — a non-AAL2 caller may get zero rows, in
  // which case every member shows their default with no override (honest, not an
  // error). The override WRITE is AAL2-gated server-side (setEventQuota).
  const [memRes, qRes, eqRes] = await Promise.all([
    client
      .from('venue_memberships')
      .select('user_id, roles, user:user_profiles!venue_memberships_user_id_fkey(full_name, email)')
      .eq('venue_id', venueId),
    client.from('quotas').select('user_id, default_count').eq('venue_id', venueId),
    client.from('event_quotas').select('user_id, quota_override').eq('event_id', eventId),
  ]);
  if (memRes.error) throw memRes.error;
  if (qRes.error) throw qRes.error;
  if (eqRes.error) throw eqRes.error;

  const defaults = new Map((qRes.data ?? []).map((q) => [q.user_id, q.default_count]));
  const overrides = new Map((eqRes.data ?? []).map((e) => [e.user_id, e.quota_override]));

  return (memRes.data ?? [])
    .map((m): EventQuotaRow => {
      const u = m.user as { full_name: string | null; email: string | null } | null;
      return {
        userId: m.user_id,
        name: u?.full_name ?? u?.email ?? 'Onbekend',
        role: headlineRole(m.roles ?? []),
        venueDefault: defaults.get(m.user_id) ?? 0,
        override: overrides.has(m.user_id) ? (overrides.get(m.user_id) ?? null) : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'nl'));
}

/**
 * Per-event quota table for the event-detail "Quota" tab (#5). Lists every team
 * member with their venue default + any per-event override. The query key is
 * scoped to the event so a save can invalidate exactly this list.
 */
export function usePoEventQuotas(eventId: string): {
  rows: EventQuotaRow[];
  venueId: string | null;
  isLoading: boolean;
  isError: boolean;
} {
  const client = useBrowserClient();
  const { currentVenue } = useSession();
  const venueId = currentVenue?.id ?? null;
  const { data = [], isLoading, isError } = useQuery({
    queryKey: ['po', 'event-quotas', venueId, eventId],
    queryFn: () =>
      venueId ? fetchEventQuotas(client, venueId, eventId) : Promise.resolve([] as EventQuotaRow[]),
    enabled: Boolean(venueId && eventId),
  });
  return { rows: data, venueId, isLoading, isError };
}
