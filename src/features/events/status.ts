// Event status state machine — pure, no I/O, mirrored 1:1 from the database
// (supabase/migrations/20260613200000_event_management.sql). The DATABASE is the
// security boundary (CLAUDE.md): these functions let the UI show only the moves a
// user may make and refuse early with good Dutch copy, but the trigger is what
// actually enforces the lifecycle. Keep both in sync.

import type { Database } from '@/lib/database.types';

export type EventStatus = Database['public']['Enums']['event_status'];

export const EVENT_STATUSES: readonly EventStatus[] = [
  'draft',
  'open',
  'live',
  'closed',
] as const;

// Dutch UI labels (CLAUDE.md: Dutch UI copy).
export const STATUS_LABELS: Record<EventStatus, string> = {
  draft: 'Concept',
  open: 'Open',
  live: 'Live',
  closed: 'Gesloten',
};

// One-line description of what each status means, for the management screen.
export const STATUS_DESCRIPTIONS: Record<EventStatus, string> = {
  draft: 'Nog niet gepubliceerd. Je richt het event in.',
  open: 'Gepubliceerd. Gasten worden toegevoegd, de aanvraaglink kan open.',
  live: 'De deur is open. Verwijderen geeft een plek niet meer vrij (anti-fraude).',
  closed: 'Afgelopen of geannuleerd. Alleen een admin kan nog wijzigen.',
};

export interface StatusTransition {
  to: EventStatus;
  /** A short imperative button label, e.g. "Publiceren". */
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
    { to: 'open', label: 'Publiceren', requiresAdmin: false },
    { to: 'closed', label: 'Concept sluiten', requiresAdmin: false },
  ],
  open: [
    {
      to: 'live',
      label: 'Live zetten',
      requiresAdmin: false,
      warning:
        'Zodra het event live is, geeft het verwijderen van een gast zijn plek niet meer vrij (anti-fraude, #22).',
    },
    { to: 'closed', label: 'Annuleren / sluiten', requiresAdmin: false },
    { to: 'draft', label: 'Terug naar concept', requiresAdmin: true },
  ],
  live: [
    { to: 'closed', label: 'Event sluiten', requiresAdmin: false },
    {
      to: 'open',
      label: 'Live terugdraaien',
      requiresAdmin: true,
      warning: 'Het live-moment blijft vastgelegd; quota van na go-live blijven tellen.',
    },
  ],
  closed: [{ to: 'open', label: 'Heropenen', requiresAdmin: true }],
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
