// Audit-log translation (#15): turn an enriched audit_feed row into a readable
// log line — "Max moved Juri Braakman from Regular to VIP".
//
// Pure, no I/O, so it is trivially unit-testable and runs on server and client
// alike. The DB (audit_feed view) already resolved actor/guest/subject/tier
// names; here we only compose the sentence and read the small JSONB diff for
// numbers (plus_ones, quota, reason). Output matches the mock AuditEntry API
// (src/lib/po/types.ts) so the desktop kit renders it unchanged: the actor is
// shown bold separately, `text` is the past-tense phrase after it.

import type { Database } from '@/lib/database.types';
import { formatShortDate, formatTime, toDateInput } from '@/features/po/format';

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

const SYSTEM = 'System';
const SOMEONE = 'a guest';

/** Compose the phrase after the actor for one audit row. */
function phrase(row: AuditFeedRow): { text: string; entity: string } {
  const after = side(row.diff, 'after');
  const before = side(row.diff, 'before');
  const guest = row.guest_name ?? SOMEONE;
  const subject = row.subject_name ?? 'a user';
  const action = row.action ?? 'update';
  const entityType = row.entity_type ?? '';

  switch (entityType) {
    case 'guests':
      switch (action) {
        case 'create': {
          const tier = row.new_tier_name ? ` (${row.new_tier_name})` : '';
          return { text: `added ${guest}${tier}`, entity: guest };
        }
        case 'tier_change':
          return {
            text: `moved ${guest} from ${row.old_tier_name ?? '—'} to ${row.new_tier_name ?? '—'}`,
            entity: guest,
          };
        case 'check_in':
          return { text: `checked in ${guest}`, entity: guest };
        case 'refuse':
          return { text: `refused ${guest}`, entity: guest };
        case 'delete':
          return { text: `removed ${guest} (soft delete)`, entity: guest };
        case 'update': {
          // Note "Heads up!"-acknowledgement (#39).
          if (after && 'note_acknowledged_at' in after && str(after.note_acknowledged_at)) {
            return { text: `acknowledged the heads-up note on ${guest}`, entity: guest };
          }
          const bp = num(before?.plus_ones);
          const ap = num(after?.plus_ones);
          if (ap !== null && bp !== null) {
            return { text: `changed ${guest} to +${ap} (was +${bp})`, entity: guest };
          }
          return { text: `updated the details for ${guest}`, entity: guest };
        }
        default:
          return { text: `updated ${guest}`, entity: guest };
      }

    case 'check_ins': {
      const arrived = num(after?.plus_ones_arrived);
      const extra = arrived && arrived > 0 ? ` +${arrived}` : '';
      return { text: `checked in ${guest}${extra} at the door`, entity: guest };
    }

    case 'refusals': {
      const reason = str(after?.reason);
      return {
        text: `refused ${guest}${reason ? `, reason: ${reason}` : ''}`,
        entity: guest,
      };
    }

    case 'guest_tiers': {
      const name = str(after?.name) ?? str(before?.name) ?? 'a tier';
      if (action === 'create') return { text: `created tier ${name}`, entity: name };
      if (action === 'delete') return { text: `removed tier ${name}`, entity: name };
      return { text: `updated tier ${name}`, entity: name };
    }

    case 'quotas':
    case 'event_quotas': {
      const scope = entityType === 'event_quotas' ? 'event quota' : 'venue quota';
      const key = entityType === 'event_quotas' ? 'quota_override' : 'default_count';
      const b = num(before?.[key]);
      const a = num(after?.[key]);
      if (action === 'quota_grant') {
        if (b === null) return { text: `granted ${subject} an ${scope} of ${a ?? '?'}`, entity: subject };
        return { text: `raised the ${scope} for ${subject} (${b} → ${a ?? '?'})`, entity: subject };
      }
      if (a !== null && b !== null) {
        return { text: `lowered the ${scope} for ${subject} (${b} → ${a})`, entity: subject };
      }
      return { text: `changed the ${scope} for ${subject}`, entity: subject };
    }

    case 'quota_requests': {
      const extra = num(after?.requested_extra) ?? num(before?.requested_extra);
      switch (action) {
        case 'create':
          return { text: `requested ${extra ?? '?'} more spots`, entity: subject };
        case 'approve':
          return { text: `approved the quota request from ${subject}`, entity: subject };
        case 'deny': {
          const reason = str(after?.decision_reason);
          return {
            text: `denied the quota request from ${subject}${reason ? `, ${reason}` : ''}`,
            entity: subject,
          };
        }
        default:
          return { text: `changed the quota request from ${subject}`, entity: subject };
      }
    }

    case 'guest_requests': {
      // Landing-page request decisions (#12). The requester is free-text on the
      // request, not a user_profile. A decision diff carries only the changed
      // fields (no full_name), so the feed resolves the live row's name into
      // request_name (anonymized requests resolve to their redacted handle).
      const name =
        str(after?.full_name) ?? str(before?.full_name) ?? row.request_name ?? 'a request';
      switch (action) {
        case 'approve':
          // decided_via='auto' = the request link approved it, no human actor
          // (the feed shows "System" as the actor) — say so explicitly (F1).
          if (str(after?.decided_via) === 'auto') {
            return {
              text: `auto-approved the request from ${name} via their request link`,
              entity: name,
            };
          }
          return { text: `approved the landing page request from ${name}`, entity: name };
        case 'deny': {
          const reason = str(after?.decision_reason);
          return {
            text: `denied the landing page request from ${name}${reason ? `, ${reason}` : ''}`,
            entity: name,
          };
        }
        default:
          return { text: `changed the landing page request from ${name}`, entity: name };
      }
    }

    case 'venue_memberships': {
      const roles = roleList(after?.roles);
      const oldRoles = roleList(before?.roles);
      if (action === 'create')
        return { text: `gave ${subject} access${roles ? ` (${roles})` : ''}`, entity: subject };
      if (action === 'delete')
        return { text: `removed ${subject}'s access`, entity: subject };
      return {
        text: `changed ${subject}'s roles${oldRoles && roles ? ` (${oldRoles} → ${roles})` : ''}`,
        entity: subject,
      };
    }

    case 'events': {
      const ev = row.event_name ?? 'the event';
      if (action === 'lock') return { text: 'locked the list', entity: ev };
      if (action === 'unlock') return { text: 'unlocked the list', entity: ev };
      // Per-event "allow check-out" override (#3 / S1.1): true/false/null(inherit).
      if (after && 'allow_uncheck' in after) {
        if (after.allow_uncheck === true) return { text: `turned on check-out for ${ev}`, entity: ev };
        if (after.allow_uncheck === false) return { text: `turned off check-out for ${ev}`, entity: ev };
        return { text: `set check-out to follow the venue default for ${ev}`, entity: ev };
      }
      return { text: 'updated the event', entity: ev };
    }

    case 'venues': {
      // Venue-wide "allow check-out" default (#3 / S1.1).
      if (after && 'allow_uncheck' in after) {
        return {
          text:
            after.allow_uncheck === true
              ? 'turned on check-out for the whole venue'
              : 'turned off check-out for the whole venue',
          entity: 'the venue',
        };
      }
      return { text: 'changed the venue settings', entity: 'the venue' };
    }

    default:
      return { text: `${action} on ${entityType}`, entity: row.guest_name ?? row.subject_name ?? '—' };
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

// FE-2: calendar-day/time helpers used to hand-roll their own Amsterdam-pinned
// Intl calls (nlDayKey/nlTime) — now use the shared date module (toDateInput/
// formatTime), so server and client still agree regardless of where they run
// (no hydration drift — the string is computed once on the server and
// rendered verbatim).

/**
 * "Today 23:14" / "Yesterday 16:02" / "12 Jun 23:14" — Today/Yesterday for the
 * last two days, otherwise the absolute date (day + month), all in Amsterdam TZ.
 * No weekday step (Max's preference): once it's older than yesterday you want the
 * date itself, not "Sat". `now` is injectable for deterministic tests.
 */
export function formatWhen(iso: string, now: Date = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = formatTime(iso);
  const dayKey = toDateInput(iso);
  const todayKey = toDateInput(now.toISOString());
  const yesterdayKey = toDateInput(new Date(now.getTime() - DAY_MS).toISOString());

  if (dayKey === todayKey) return `Today ${time}`;
  if (dayKey === yesterdayKey) return `Yesterday ${time}`;
  return `${formatShortDate(iso)} ${time}`;
}
