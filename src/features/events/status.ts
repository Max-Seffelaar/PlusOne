// Event status state machine — pure, no I/O, mirrored 1:1 from the database
// (supabase/migrations/20260613200000_event_management.sql). The DATABASE is the
// security boundary (CLAUDE.md): these functions let the UI show only the moves a
// user may make and refuse early with good copy, but the trigger is what
// actually enforces the lifecycle. Keep both in sync.

import type { Database } from '@/lib/database.types';

export type EventStatus = Database['public']['Enums']['event_status'];

export const EVENT_STATUSES: readonly EventStatus[] = [
  'draft',
  'open',
  'live',
  'closed',
] as const;

// English UI labels (copy-deck §5).
export const STATUS_LABELS: Record<EventStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  live: 'Live',
  closed: 'Closed',
};

// One-line description of what each status means, for the management screen.
export const STATUS_DESCRIPTIONS: Record<EventStatus, string> = {
  draft: "Not published yet. You're still setting the event up.",
  open: 'Published. Guests can be added and the request link can go live.',
  live: "The door is open. Removing a guest no longer frees their spot (anti-fraud).",
  closed: 'Over or canceled. Only an admin can still make changes.',
};

export interface StatusTransition {
  to: EventStatus;
  /** A short imperative button label, e.g. "Publish". */
  label: string;
  /** Admin-only corrective reversal (un-publish / un-live / reopen). */
  requiresAdmin: boolean;
  /** Soft warning shown before confirming a sensitive step (go-live / close). */
  warning?: string;
}

// The allowed graph — identical to is_valid_event_status_transition /
// event_transition_requires_admin in the migration. `label` is the action verb
// from the CURRENT status's perspective.
const TRANSITIONS: Record<EventStatus, StatusTransition[]> = {
  draft: [
    { to: 'open', label: 'Publish', requiresAdmin: false },
    { to: 'closed', label: 'Close draft', requiresAdmin: false },
  ],
  open: [
    {
      to: 'live',
      label: 'Go live',
      requiresAdmin: false,
      warning:
        'Once the event is live, removing a guest no longer frees their spot (anti-fraud, #22).',
    },
    { to: 'closed', label: 'Cancel / close', requiresAdmin: false },
    { to: 'draft', label: 'Back to draft', requiresAdmin: true },
  ],
  live: [
    { to: 'closed', label: 'Close event', requiresAdmin: false },
    {
      to: 'open',
      label: 'Undo go-live',
      requiresAdmin: true,
      warning: 'The go-live moment stays on record. Quota counted after go-live keep counting.',
    },
  ],
  closed: [{ to: 'open', label: 'Reopen', requiresAdmin: true }],
};

/** True when `from → to` is an allowed transition (graph only, ignores role). */
export function isValidTransition(from: EventStatus, to: EventStatus): boolean {
  return TRANSITIONS[from].some((t) => t.to === to);
}

/** True when an allowed transition may only be performed by an admin. */
export function transitionRequiresAdmin(from: EventStatus, to: EventStatus): boolean {
  return TRANSITIONS[from].some((t) => t.to === to && t.requiresAdmin);
}

/**
 * Transitions the given actor may perform from `from`. Organizers (non-admin)
 * see only forward steps; admins see corrective reversals too. Mirrors the
 * trigger's WHO rule so the UI never offers a move the database will reject.
 */
export function allowedTransitions(
  from: EventStatus,
  opts: { isAdmin: boolean }
): StatusTransition[] {
  return TRANSITIONS[from].filter((t) => opts.isAdmin || !t.requiresAdmin);
}
