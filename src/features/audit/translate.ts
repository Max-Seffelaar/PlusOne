// Audit-log translation (#15): turn an enriched audit_feed row into a readable
// Dutch log line — "Max verplaatste Juri Braakman van Regular naar VIP".
//
// Pure, no I/O, so it is trivially unit-testable and runs on server and client
// alike. The DB (audit_feed view) already resolved actor/guest/subject/tier
// names; here we only compose the sentence and read the small JSONB diff for
// numbers (plus_ones, quota, reason). Output matches the mock AuditEntry API
// (src/lib/po/types.ts) so the desktop kit renders it unchanged: the actor is
// shown bold separately, `text` is the past-tense phrase after it.

import type { Database } from '@/lib/database.types';

export type AuditFeedRow = Database['public']['Views']['audit_feed']['Row'];

export interface AuditLine {
  id: string;
  actor: string;
  action: string;
  entity: string;
  /** Past-tense phrase WITHOUT the actor (rendered after the bold actor name). */
  text: string;
  event: string;
  /** Raw device id ('web' when none); the UI flags door devices. */
  device: string;
  /** ISO timestamp; format with formatWhen() at render time. */
  iso: string;
  /** The guest this line concerns, for linking to the per-guest history. */
  guestId: string | null;
}

type DiffSide = Record<string, unknown> | null;

function side(diff: AuditFeedRow['diff'], key: 'before' | 'after'): DiffSide {
  if (diff && typeof diff === 'object' && !Array.isArray(diff)) {
    const v = (diff as Record<string, unknown>)[key];
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  }
  return null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}
function roleList(v: unknown): string | null {
  return Array.isArray(v) && v.length > 0 ? v.join(', ') : null;
}

const SYSTEM = 'Systeem';
const SOMEONE = 'een gast';

/** Compose the phrase after the actor for one audit row. */
function phrase(row: AuditFeedRow): { text: string; entity: string } {
  const after = side(row.diff, 'after');
  const before = side(row.diff, 'before');
  const guest = row.guest_name ?? SOMEONE;
  const subject = row.subject_name ?? 'een gebruiker';
  const action = row.action ?? 'update';
  const entityType = row.entity_type ?? '';

  switch (entityType) {
    case 'guests':
      switch (action) {
        case 'create': {
          const tier = row.new_tier_name ? ` (${row.new_tier_name})` : '';
          return { text: `voegde ${guest} toe${tier}`, entity: guest };
        }
        case 'tier_change':
          return {
            text: `verplaatste ${guest} van ${row.old_tier_name ?? '—'} naar ${row.new_tier_name ?? '—'}`,
            entity: guest,
          };
        case 'check_in':
          return { text: `checkte ${guest} in`, entity: guest };
        case 'refuse':
          return { text: `weigerde ${guest}`, entity: guest };
        case 'delete':
          return { text: `verwijderde ${guest} (soft delete)`, entity: guest };
        case 'update': {
          // Note "Let op!"-acknowledgement (#39).
          if (after && 'note_acknowledged_at' in after && str(after.note_acknowledged_at)) {
            return { text: `vinkte de let-op-notitie van ${guest} af`, entity: guest };
          }
          const bp = num(before?.plus_ones);
          const ap = num(after?.plus_ones);
          if (ap !== null && bp !== null) {
            return { text: `wijzigde ${guest} naar +${ap} (was +${bp})`, entity: guest };
          }
          return { text: `wijzigde de gegevens van ${guest}`, entity: guest };
        }
        default:
          return { text: `wijzigde ${guest}`, entity: guest };
      }

    case 'check_ins': {
      const arrived = num(after?.plus_ones_arrived);
      const extra = arrived && arrived > 0 ? ` +${arrived}` : '';
      return { text: `checkte ${guest}${extra} in aan de deur`, entity: guest };
    }

    case 'refusals': {
      const reason = str(after?.reason);
      return {
        text: `weigerde ${guest}${reason ? ` — reden: ${reason}` : ''}`,
        entity: guest,
      };
    }

    case 'guest_tiers': {
      const name = str(after?.name) ?? str(before?.name) ?? 'een tier';
      if (action === 'create') return { text: `maakte tier ${name} aan`, entity: name };
      if (action === 'delete') return { text: `verwijderde tier ${name}`, entity: name };
      return { text: `wijzigde tier ${name}`, entity: name };
    }

    case 'quotas':
    case 'event_quotas': {
      const scope = entityType === 'event_quotas' ? 'event-quotum' : 'venue-quotum';
      const key = entityType === 'event_quotas' ? 'quota_override' : 'default_count';
      const b = num(before?.[key]);
      const a = num(after?.[key]);
      if (action === 'quota_grant') {
        if (b === null) return { text: `kende ${subject} een ${scope} van ${a ?? '?'} toe`, entity: subject };
        return { text: `verhoogde het ${scope} van ${subject} (${b} → ${a ?? '?'})`, entity: subject };
      }
      if (a !== null && b !== null) {
        return { text: `verlaagde het ${scope} van ${subject} (${b} → ${a})`, entity: subject };
      }
      return { text: `wijzigde het ${scope} van ${subject}`, entity: subject };
    }

    case 'quota_requests': {
      const extra = num(after?.requested_extra) ?? num(before?.requested_extra);
      switch (action) {
        case 'create':
          return { text: `vroeg ${extra ?? '?'} extra plekken aan`, entity: subject };
        case 'approve':
          return { text: `keurde het quotum-verzoek van ${subject} goed`, entity: subject };
        case 'deny': {
          const reason = str(after?.decision_reason);
          return {
            text: `wees het quotum-verzoek van ${subject} af${reason ? ` — ${reason}` : ''}`,
            entity: subject,
          };
        }
        default:
          return { text: `wijzigde het quotum-verzoek van ${subject}`, entity: subject };
      }
    }

    case 'venue_memberships': {
      const roles = roleList(after?.roles);
      const oldRoles = roleList(before?.roles);
      if (action === 'create')
        return { text: `gaf ${subject} toegang${roles ? ` (${roles})` : ''}`, entity: subject };
      if (action === 'delete')
        return { text: `trok de toegang van ${subject} in`, entity: subject };
      return {
        text: `wijzigde de rollen van ${subject}${oldRoles && roles ? ` (${oldRoles} → ${roles})` : ''}`,
        entity: subject,
      };
    }

    case 'events':
      if (action === 'lock') return { text: 'vergrendelde de gastenlijst', entity: row.event_name ?? 'het event' };
      if (action === 'unlock') return { text: 'ontgrendelde de gastenlijst', entity: row.event_name ?? 'het event' };
      return { text: 'wijzigde het event', entity: row.event_name ?? 'het event' };

    default:
      return { text: `${action} op ${entityType}`, entity: row.guest_name ?? row.subject_name ?? '—' };
  }
}

export function describeAuditEntry(row: AuditFeedRow): AuditLine {
  const { text, entity } = phrase(row);
  return {
    id: row.id ?? '',
    actor: row.actor_name ?? SYSTEM,
    action: row.action ?? 'update',
    entity,
    text,
    event: row.event_name ?? '',
    device: row.device_id ?? 'web',
    iso: row.created_at ?? '',
    guestId: row.guest_id,
  };
}

const DAY_MS = 86_400_000;
const NL_TZ = 'Europe/Amsterdam';

// Calendar day in Amsterdam (the product's TZ) as YYYY-MM-DD, so server and
// client agree regardless of where they run (no hydration drift — the string is
// computed once on the server and rendered verbatim).
function nlDayKey(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: NL_TZ });
}
function nlTime(d: Date): string {
  return d.toLocaleTimeString('nl-NL', { timeZone: NL_TZ, hour: '2-digit', minute: '2-digit' });
}
function nlWeekday(d: Date): string {
  return d.toLocaleDateString('nl-NL', { timeZone: NL_TZ, weekday: 'short' }).replace('.', '');
}

/**
 * "Vandaag 23:14" / "Gisteren 16:02" / "za 23:14" / "12 jun 23:14" — relative day
 * + time in Amsterdam TZ. `now` is injectable for deterministic tests.
 */
export function formatWhen(iso: string, now: Date = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = nlTime(d);
  const dayKey = nlDayKey(d);
  const todayKey = nlDayKey(now);
  const yesterdayKey = nlDayKey(new Date(now.getTime() - DAY_MS));

  if (dayKey === todayKey) return `Vandaag ${time}`;
  if (dayKey === yesterdayKey) return `Gisteren ${time}`;

  const ageDays = Math.floor((now.getTime() - d.getTime()) / DAY_MS);
  if (ageDays >= 0 && ageDays < 7) return `${nlWeekday(d)} ${time}`;
  return `${d.toLocaleDateString('nl-NL', { timeZone: NL_TZ, day: 'numeric', month: 'short' })} ${time}`;
}
