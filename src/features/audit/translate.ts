// Audit-log translation (#15): turn an enriched audit_feed row into a readable
// log line — "Max moved Juri Braakman from Regular to VIP".
//
// Pure, no I/O, so it is trivially unit-testable and runs on server and client
// alike. The DB (audit_feed view) already resolved guest/tier names; the
// actor and subject (people) labels come from `venue_actor_names` via
// fetchActorLabels (spec #62a — the view's RLS-scoped actor_name/subject_name
// hide former members and PlusOne support, so they are only a fallback here).
// We compose the sentence and read the small JSONB diff for numbers
// (plus_ones, quota, reason). Output matches the mock AuditEntry API
// (src/lib/po/types.ts) so the desktop kit renders it unchanged: the actor is
// shown bold separately, `text` is the past-tense phrase after it.

import type { Database } from '@/lib/database.types';
import { fmt, t } from '@/lib/i18n';
import { formatLongDate, formatShortDate, formatTime, toDateInput } from '@/features/po/format';
import type { ActorKind } from '@/lib/po/actor-kind';
import { ActorLabels, nameRef } from './actor-labels';

export type AuditFeedRow = Database['public']['Views']['audit_feed']['Row'];

export interface AuditLine {
  id: string;
  actor: string;
  /** What `actor` is (spec #62a): only 'member' is a person's own text; the
   *  rest render as a typed label (kit ActorName). */
  actorKind: ActorKind;
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

const SYSTEM = t.shared.actor.system;
const SOMEONE = 'a guest';

// ── Phrases from the catalogue (t.audit.line) ────────────────────────────────
// Every table audited since the first phases, plus the generic fallback. Names
// slotted in here are data (a contact, influencer, template, or tier name),
// never a person who acted: actors and subjects stay typed refs (#62a).

type Phrase = { text: string; entity: string };
const L = t.audit.line;

/** `template` with {name}, or the unnamed variant when there is no name. */
function named(template: string, unnamed: string, name: string | null): string {
  return name ? fmt(template, { name }) : unnamed;
}

/** A diff timestamp as "27 Oct 2026" (Amsterdam), or null when absent/invalid. */
function longDate(v: unknown): string | null {
  const s = str(v);
  if (!s || Number.isNaN(new Date(s).getTime())) return null;
  return formatLongDate(s);
}

/** A top-level (non before/after) key of the diff, e.g. `source`. */
function diffMeta(diff: AuditFeedRow['diff'], key: string): unknown {
  if (diff && typeof diff === 'object' && !Array.isArray(diff)) {
    return (diff as Record<string, unknown>)[key];
  }
  return undefined;
}

const SUBSCRIPTION_STATUS: Record<string, string> = {
  trialing: L.subscriptionStatusTrialing,
  active: L.subscriptionStatusActive,
  past_due: L.subscriptionStatusPastDue,
  canceled: L.subscriptionStatusCanceled,
  comped: L.subscriptionStatusComped,
};

const BILLING_INTERVAL: Record<string, string> = {
  month: L.intervalMonth,
  year: L.intervalYear,
};

/**
 * subscriptions: the onboarding insert (create_venue_with_owner), Stripe
 * webhooks (actor null = System), the Platform tab's set_venue_trial_end /
 * set_venue_comped, and the ADE invite's trial end (an 'update' row the RPC
 * writes on the inviter's name, diff.source = 'platform_invite_ade').
 */
function subscriptionPhrase(row: AuditFeedRow, action: string, before: DiffSide, after: DiffSide): Phrase {
  const entity = L.subscriptionEntity;
  const status = str(after?.status);
  const trialEnd = longDate(after?.trial_ends_at);

  if (action === 'create') {
    if (status === 'comped') return { text: L.subscriptionComped, entity };
    if (status === 'trialing') {
      return {
        text: trialEnd ? fmt(L.subscriptionTrialStartedUntil, { date: trialEnd }) : L.subscriptionTrialStarted,
        entity,
      };
    }
    return { text: L.subscriptionStarted, entity };
  }

  if (diffMeta(row.diff, 'source') === 'platform_invite_ade' && trialEnd) {
    return { text: fmt(L.subscriptionAdeTrial, { date: trialEnd }), entity };
  }
  if (status === 'comped') return { text: L.subscriptionComped, entity };
  if (str(before?.status) === 'comped' && trialEnd) {
    return { text: fmt(L.subscriptionCompedOff, { date: trialEnd }), entity };
  }
  if (trialEnd) return { text: fmt(L.subscriptionTrialEnd, { date: trialEnd }), entity };
  if (status && SUBSCRIPTION_STATUS[status]) {
    return { text: fmt(L.subscriptionStatus, { status: SUBSCRIPTION_STATUS[status] }), entity };
  }
  const interval = str(after?.billing_interval);
  if (interval && BILLING_INTERVAL[interval]) {
    return { text: fmt(L.subscriptionInterval, { interval: BILLING_INTERVAL[interval] }), entity };
  }
  return { text: L.subscriptionUpdated, entity };
}

/** contacts: the company's guest book. An anonymized contact is never named
 *  (its pre-anonymization diff still holds the real name). */
function contactPhrase(action: string, before: DiffSide, after: DiffSide): Phrase {
  const entity = L.contactEntity;
  if (action === 'anonymize' || str(after?.anonymized_at)) return { text: L.contactAnonymized, entity };
  if (action === 'create') {
    const name = str(after?.full_name);
    return { text: named(L.contactCreated, L.contactCreatedUnnamed, name), entity: name ?? entity };
  }
  if (action === 'delete') {
    const name = str(before?.full_name);
    return { text: named(L.contactRemoved, L.contactRemovedUnnamed, name), entity: name ?? entity };
  }
  // An update diff carries only the changed fields: a name only when it changed.
  const name = str(after?.full_name);
  return { text: named(L.contactUpdated, L.contactUpdatedUnnamed, name), entity: name ?? entity };
}

/** invites: team invites (roles) and external-crew invites (no roles). */
function invitePhrase(action: string, after: DiffSide): Phrase {
  const entity = L.inviteEntity;
  if (action === 'create') {
    const roles = roleList(after?.roles);
    return { text: roles ? fmt(L.inviteTeam, { roles }) : L.inviteCrew, entity };
  }
  if (action === 'delete') return { text: L.inviteCanceled, entity };
  if (str(after?.accepted_at)) return { text: L.inviteAccepted, entity };
  if (str(after?.declined_at)) return { text: L.inviteDeclined, entity };
  if (after && 'expires_at' in after) return { text: L.inviteResent, entity };
  return { text: L.inviteUpdated, entity };
}

/** The diff's `name` (after wins), for tables whose rows carry one. */
function rowName(before: DiffSide, after: DiffSide): string | null {
  return str(after?.name) ?? str(before?.name);
}

/** create / delete / anything else → one of three templates. */
function byAction(action: string, created: string, removed: string, updated: string): string {
  return action === 'create' ? created : action === 'delete' ? removed : updated;
}

function influencerPhrase(action: string, before: DiffSide, after: DiffSide): Phrase {
  const name = rowName(before, after);
  const influencer = named(L.influencerNamed, L.influencerUnnamed, name);
  const entity = name ?? L.influencerUnnamed;
  if (action === 'create') return { text: fmt(L.influencerCreated, { influencer }), entity };
  if (after && 'archived_at' in after) {
    const template = str(after.archived_at) ? L.influencerArchived : L.influencerRestored;
    return { text: fmt(template, { influencer }), entity };
  }
  return { text: fmt(L.influencerUpdated, { influencer }), entity };
}

function templatePhrase(action: string, before: DiffSide, after: DiffSide): Phrase {
  const name = rowName(before, after);
  const template = named(L.templateNamed, L.templateUnnamed, name);
  const text = byAction(action, L.templateCreated, L.templateRemoved, L.templateUpdated);
  return { text: fmt(text, { template }), entity: name ?? L.templateUnnamed };
}

function templateTierPhrase(action: string, before: DiffSide, after: DiffSide): Phrase {
  const name = rowName(before, after);
  const tier = named(L.templateTierNamed, L.templateTierUnnamed, name);
  const text = byAction(action, L.templateTierCreated, L.templateTierRemoved, L.templateTierUpdated);
  return { text: fmt(text, { tier }), entity: name ?? L.templateTierUnnamed };
}

/** platform_invites: PlusOne's outreach record. Never the invitee's e-mail. */
function platformInvitePhrase(action: string, after: DiffSide): Phrase {
  const entity = L.platformInviteEntity;
  if (action === 'create') {
    return { text: after?.free_until_ade === true ? L.platformInviteSentAde : L.platformInviteSent, entity };
  }
  if (str(after?.anonymized_at)) return { text: L.platformInviteAnonymized, entity };
  if (str(after?.revoked_at)) return { text: L.platformInviteRevoked, entity };
  if (str(after?.ade_trial_venue_id)) return { text: L.platformInviteUsed, entity };
  if (str(after?.last_sent_at)) return { text: L.platformInviteResent, entity };
  return { text: L.platformInviteUpdated, entity };
}

/** Any table or action without its own case: a plain verb, never the raw
 *  action or table name ("create on subscriptions"). */
function fallbackPhrase(row: AuditFeedRow, action: string): Phrase {
  const text =
    action === 'create'
      ? L.fallbackCreated
      : action === 'update'
        ? L.fallbackUpdated
        : action === 'delete'
          ? L.fallbackRemoved
          : L.fallbackOther;
  return { text, entity: row.guest_name ?? L.fallbackEntity };
}

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
        case 'anonymize':
          // Data retention (#29): the name here is the live, redacted one.
          return { text: fmt(L.guestAnonymized, { name: guest }), entity: guest };
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
      if (action === 'update') {
        // check_out_guest (#34): a check-out voids the row; a partial one
        // clears voided_at again with the smaller party.
        if (after && 'voided_at' in after) {
          if (str(after.voided_at)) return { text: fmt(L.checkOut, { name: guest }), entity: guest };
          return {
            text:
              arrived && arrived > 0
                ? fmt(L.checkInAgainPlus, { name: guest, count: arrived })
                : fmt(L.checkInAgain, { name: guest }),
            entity: guest,
          };
        }
        if (arrived !== null) {
          return { text: fmt(L.checkInChangedPlus, { name: guest, count: arrived }), entity: guest };
        }
        return { text: fmt(L.checkInChanged, { name: guest }), entity: guest };
      }
      if (action === 'delete') return { text: fmt(L.checkInRemoved, { name: guest }), entity: guest };
      const extra = arrived && arrived > 0 ? ` +${arrived}` : '';
      return { text: `checked in ${guest}${extra} at the door`, entity: guest };
    }

    case 'refusals': {
      if (action === 'update') return { text: fmt(L.refusalChanged, { name: guest }), entity: guest };
      if (action === 'delete') return { text: fmt(L.refusalRemoved, { name: guest }), entity: guest };
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
        case 'anonymize':
          // Retention job (#29): request_name is the live, redacted handle.
          return { text: fmt(L.requestAnonymized, { name }), entity: name };
        default:
          return { text: `changed the landing page request from ${name}`, entity: name };
      }
    }

    case 'request_links': {
      const label = str(after?.label) ?? str(before?.label);
      const desc = label ? `the request link "${label}"` : 'a request link';
      if (action === 'create') return { text: `created ${desc}`, entity: label ?? 'a request link' };
      if (after && 'archived_at' in after) {
        return {
          text: str(after.archived_at) ? `archived ${desc}` : `restored ${desc}`,
          entity: label ?? 'a request link',
        };
      }
      if (after && 'active' in after) {
        return {
          text: `${after.active === true ? 're-activated' : 'paused'} ${desc}`,
          entity: label ?? 'a request link',
        };
      }
      return { text: `updated ${desc}`, entity: label ?? 'a request link' };
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
      // Per-event default crew quota (T10 / C7).
      const defaultQuota = num(after?.default_member_quota);
      if (defaultQuota !== null) {
        return { text: fmt(L.eventDefaultQuota, { event: ev, count: defaultQuota }), entity: ev };
      }
      return { text: 'updated the event', entity: ev };
    }

    case 'venues': {
      // Legal v0.3 E1: a data export (log_venue_export) — the one audited read.
      if (action === 'export') {
        return {
          text: row.event_id ? 'exported the event data' : 'exported the venue data',
          entity: row.event_id ? (row.event_name ?? 'the event') : 'the venue',
        };
      }
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

    case 'subscriptions':
      return subscriptionPhrase(row, action, before, after);

    case 'contacts':
      return contactPhrase(action, before, after);

    case 'invites':
      return invitePhrase(action, after);

    case 'influencers':
      return influencerPhrase(action, before, after);

    case 'event_templates':
      return templatePhrase(action, before, after);

    case 'event_template_tiers':
      return templateTierPhrase(action, before, after);

    case 'platform_invites':
      return platformInvitePhrase(action, after);

    case 'user_profiles':
      // set_platform_admin (#49): the only audited user_profiles write.
      if (action === 'platform_admin_grant') {
        return { text: L.platformAdminGranted, entity: L.platformAdminEntity };
      }
      if (action === 'platform_admin_revoke') {
        return { text: L.platformAdminRevoked, entity: L.platformAdminEntity };
      }
      return fallbackPhrase(row, action);

    default:
      return fallbackPhrase(row, action);
  }
}

/** The person ids a feed row names (actor + subject) — what fetchActorLabels
 *  needs to resolve for {@link describeAuditEntry}. */
export function auditPersonIds(rows: readonly AuditFeedRow[]): string[] {
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.actor_id) ids.add(r.actor_id);
    if (r.subject_user_id) ids.add(r.subject_user_id);
  }
  return [...ids];
}

/**
 * One feed row → one log line. `labels` (actor id → label, from
 * fetchActorLabels) applies the who-did-what rule (#62a): a null actor is
 * "System", a resolved id is the member's name or "PlusOne support". Without a
 * label (none passed, the RPC failed, or not deployed yet) the view's
 * RLS-scoped name is the fallback, and then "Unknown" — never "System": a real
 * person (a former member, an operator) acted there (review #466 N2). "System"
 * is ONLY for a null actor_id.
 */
export function describeAuditEntry(
  row: AuditFeedRow,
  labels: ReadonlyMap<string, string> = new ActorLabels(),
): AuditLine {
  const subjectLabel = row.subject_user_id ? labels.get(row.subject_user_id) : undefined;
  const { text, entity } = phrase(subjectLabel ? { ...row, subject_name: subjectLabel } : row);
  const resolved = row.actor_id ? labels.get(row.actor_id) : undefined;
  const actorRef: { text: string; kind: ActorKind } = !row.actor_id
    ? { text: SYSTEM, kind: 'system' }
    : resolved !== undefined
      ? {
          text: resolved,
          kind: labels instanceof ActorLabels ? labels.kindOf(row.actor_id) : 'member',
        }
      : row.actor_name != null
        ? // The view's RLS-scoped name: a person's own text, blank → "Unnamed".
          nameRef(row.actor_name)
        : { text: t.shared.actor.unknown, kind: 'unknown' };
  return {
    id: row.id ?? '',
    actor: actorRef.text,
    actorKind: actorRef.kind,
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
