// Zod schemas for every event-management input (CLAUDE.md security checklist:
// all input through Zod, no raw formData passthrough). Shared by the server
// actions and the client forms so the rules live in exactly one place.

import { z } from 'zod';

const uuid = z.string().uuid('Invalid id');

// Client sends an ISO instant (new Date(datetime-local).toISOString()), so an
// event that runs 23:00→05:00 is two full timestamps and crosses midnight by
// construction (#26). Default .datetime() accepts the trailing 'Z'.
const isoDateTime = z.string().datetime('Invalid date/time');

const eventName = z.string().trim().min(1, 'Enter a name').max(160, 'Name is too long');

// Single lavender-family palette is the design intent, but we only validate the
// shape (#RRGGBB); the picker constrains the choices.
const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Pick a valid color');

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

// ── Event CRUD ──────────────────────────────────────────────────────────────

export const createEventSchema = z
  .object({
    venueId: uuid,
    name: eventName,
    startsAt: isoDateTime,
    endsAt: isoDateTime.nullable().optional(),
    landingActive: z.boolean().default(false),
  })
  .refine((v) => !v.endsAt || v.endsAt > v.startsAt, {
    message: 'The end must be after the start',
    path: ['endsAt'],
  });
export type CreateEventInput = z.input<typeof createEventSchema>;

export const updateEventSchema = z
  .object({
    eventId: uuid,
    name: eventName.optional(),
    startsAt: isoDateTime.optional(),
    endsAt: isoDateTime.nullable().optional(),
  })
  .refine((v) => v.endsAt == null || v.startsAt == null || v.endsAt > v.startsAt, {
    message: 'The end must be after the start',
    path: ['endsAt'],
  });
export type UpdateEventInput = z.input<typeof updateEventSchema>;

// Cancel / un-cancel an event (replaces the retired status='closed' semantics,
// 24 jun 2026). A cancelled event is admin-only, takes no check-ins and no public
// requests — enforced in the database (can_write_guests / can_check_in / landing).
export const setCancelledSchema = z.object({
  eventId: uuid,
  cancelled: z.boolean(),
});
export type SetCancelledInput = z.input<typeof setCancelledSchema>;

// ── Landing page (#28) ────────────────────────────────────────────────────────

export const setLandingActiveSchema = z.object({
  eventId: uuid,
  active: z.boolean(),
});
export type SetLandingActiveInput = z.input<typeof setLandingActiveSchema>;

// The slug is auto-generated from the name and intentionally NOT editable: a
// shared landing link must never break (feedback 2026-06-14).

// ── List lock (#23) ────────────────────────────────────────────────────────────

export const setLockSchema = z.object({
  eventId: uuid,
  locked: z.boolean(),
});
export type SetLockInput = z.input<typeof setLockSchema>;

// Scheduled auto-lock: a single instant after which staff can no longer mutate
// the list (DB-enforced in can_write_guests). null clears it.
export const setAutoLockSchema = z.object({
  eventId: uuid,
  autoLockAt: isoDateTime.nullable(),
});
export type SetAutoLockInput = z.input<typeof setAutoLockSchema>;

// ── Uitchecken toestaan — per-event override (#3 / S1.1) ────────────────────────
// true = always on for this event, false = always off, null = inherit the venue
// (company) default. Effective value is resolved by event_allows_uncheck in SQL.
export const setAllowUncheckSchema = z.object({
  eventId: uuid,
  allowUncheck: z.boolean().nullable(),
});
export type SetAllowUncheckInput = z.input<typeof setAllowUncheckSchema>;

// ── Tiers (#8) ─────────────────────────────────────────────────────────────────

// Aliases feed the quick-add parser (#33): lowercased, trimmed, de-duped.
const aliases = z
  .array(z.string().trim().toLowerCase().min(1).max(40))
  .max(20, 'At most 20 aliases')
  .default([])
  .transform((arr) => [...new Set(arr.filter(Boolean))]);

const maxGuests = z
  .number()
  .int()
  .positive('Maximum must be greater than 0')
  .max(100000)
  .nullable()
  .optional();

// Door price in euro cents (#34 — display only, no payment processing). null = free.
const doorPriceCents = z
  .number()
  .int('Enter a whole amount')
  .min(0, 'Price cannot be negative')
  .max(100_000_00, 'Price is too high')
  .nullable()
  .optional();

// Display-only VAT percentage (T3 — no billing). Only meaningful on a paid tier;
// mirrors the DB's guest_tiers_vat_requires_price constraint.
const vatPercent = z.number().min(0, 'VAT cannot be negative').max(100, 'VAT is too high').nullable().optional();

const vatRequiresPrice = (v: { doorPriceCents?: number | null; vatPercent?: number | null }, ctx: z.RefinementCtx) => {
  if (v.vatPercent != null && v.doorPriceCents == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'VAT only applies to paid tiers',
      path: ['vatPercent'],
    });
  }
};

export const createTierSchema = z
  .object({
    eventId: uuid,
    name: z.string().trim().min(1, 'Enter a name').max(80, 'Name is too long'),
    description: optionalText(280),
    color: hexColor.nullable().optional(),
    maxGuests,
    doorPriceCents,
    vatPercent,
    aliases,
  })
  .superRefine(vatRequiresPrice);
export type CreateTierInput = z.input<typeof createTierSchema>;

export const updateTierSchema = z.object({
  tierId: uuid,
  name: z.string().trim().min(1, 'Enter a name').max(80).optional(),
  description: optionalText(280),
  color: hexColor.nullable().optional(),
  maxGuests,
  doorPriceCents,
  vatPercent,
  aliases: aliases.optional(),
});
export type UpdateTierInput = z.input<typeof updateTierSchema>;

export const deleteTierSchema = z.object({ tierId: uuid });
export type DeleteTierInput = z.input<typeof deleteTierSchema>;

// ── External crew (event_organizers, #6/#24 + 86ey21vre) ─────────────────────
// "External crew" = event-scoped people (a DJ, artist, guest organizer). They are
// no longer quota-exempt (migration 20260625120000), so add/invite carry an
// optional per-event guest quota written to event_quotas.quota_override.

// How many guests an external crew member may add to the event (event_quotas
// override). Optional on add/invite (omit = no override, i.e. limit 0).
const crewQuota = z.number().int('Quota must be a whole number').min(0).max(9999);

const crewEmail = z
  .string()
  .trim()
  .min(1, 'Enter an email')
  .max(254)
  .email('Invalid email')
  .transform((v) => v.toLowerCase());

export const assignOrganizerSchema = z.object({
  eventId: uuid,
  userId: uuid,
  quota: crewQuota.optional(),
});
export type AssignOrganizerInput = z.input<typeof assignOrganizerSchema>;

/** Invite a brand-new external crew member by email, to one or more events. */
export const inviteExternalCrewSchema = z.object({
  email: crewEmail,
  eventIds: z.array(uuid).min(1, 'Pick at least one event'),
  quota: crewQuota.optional(),
});
export type InviteExternalCrewInput = z.input<typeof inviteExternalCrewSchema>;

export const removeOrganizerSchema = z.object({
  eventId: uuid,
  userId: uuid,
});
export type RemoveOrganizerInput = z.input<typeof removeOrganizerSchema>;

/** Resend an external crew member's login mail (T8) — venue-scoped. */
export const resendCrewInviteSchema = z.object({
  venueId: uuid,
  userId: uuid,
});
export type ResendCrewInviteInput = z.input<typeof resendCrewInviteSchema>;

/** Set (or clear) an external crew member's per-event guest quota. */
export const setEventUserQuotaSchema = z.object({
  eventId: uuid,
  userId: uuid,
  quota: crewQuota,
});
export type SetEventUserQuotaInput = z.input<typeof setEventUserQuotaSchema>;

/**
 * Set an event's per-event default member quota (T10, 86ey4j1p5). This is the
 * value the add-crew flow prefills; it is seeded from the venue default at event
 * creation and then editable per event. Reuses the same 0..9999 bound as a crew
 * quota override.
 */
export const setEventDefaultMemberQuotaSchema = z.object({
  eventId: uuid,
  quota: crewQuota,
});
export type SetEventDefaultMemberQuotaInput = z.input<typeof setEventDefaultMemberQuotaSchema>;

// ── Event templates (86exyp8gn) ──────────────────────────────────────────────
// A named, reusable per-event-type setup: a tier set + a hard total capacity +
// default event settings, seeded onto a new event on create. Reuses the tier
// primitives (name/description/color/maxGuests/aliases) so the editor is identical.

// Hard total event capacity (people through the door). Same bound as the DB check
// (> 0); nullable = no cap.
const capacity = z
  .number()
  .int()
  .positive('Capacity must be greater than 0')
  .max(1_000_000)
  .nullable()
  .optional();

// Auto-lock offset in minutes relative to event start (negative = before doors).
const autoLockOffsetMinutes = z.number().int().min(-100_000).max(100_000).nullable().optional();

const templateName = z.string().trim().min(1, 'Enter a name').max(120, 'Name is too long');

export const createTemplateSchema = z.object({
  venueId: uuid,
  name: templateName,
  capacity,
  // tri-state, like setAllowUncheckSchema: true/false force it, null inherits venue.
  allowUncheck: z.boolean().nullable().optional(),
  landingActive: z.boolean().default(false),
  autoLockOffsetMinutes,
});
export type CreateTemplateInput = z.input<typeof createTemplateSchema>;

export const updateTemplateSchema = z.object({
  templateId: uuid,
  name: templateName.optional(),
  capacity,
  allowUncheck: z.boolean().nullable().optional(),
  landingActive: z.boolean().optional(),
  autoLockOffsetMinutes,
});
export type UpdateTemplateInput = z.input<typeof updateTemplateSchema>;

export const deleteTemplateSchema = z.object({ templateId: uuid });
export type DeleteTemplateInput = z.input<typeof deleteTemplateSchema>;

// Template tiers — the guest_tier fields, keyed on templateId (no eventId). venue_id
// is trigger-stamped, never client-supplied.
export const createTemplateTierSchema = z
  .object({
    templateId: uuid,
    name: z.string().trim().min(1, 'Enter a name').max(80, 'Name is too long'),
    description: optionalText(280),
    color: hexColor.nullable().optional(),
    maxGuests,
    doorPriceCents,
    vatPercent,
    aliases,
  })
  .superRefine(vatRequiresPrice);
export type CreateTemplateTierInput = z.input<typeof createTemplateTierSchema>;

export const updateTemplateTierSchema = z.object({
  tierId: uuid,
  name: z.string().trim().min(1, 'Enter a name').max(80).optional(),
  description: optionalText(280),
  color: hexColor.nullable().optional(),
  maxGuests,
  doorPriceCents,
  vatPercent,
  aliases: aliases.optional(),
});
export type UpdateTemplateTierInput = z.input<typeof updateTemplateTierSchema>;

export const deleteTemplateTierSchema = z.object({ tierId: uuid });
export type DeleteTemplateTierInput = z.input<typeof deleteTemplateTierSchema>;

// Create an event from a template (the create_event_from_template RPC's input).
export const createEventFromTemplateSchema = z
  .object({
    templateId: uuid,
    name: eventName,
    startsAt: isoDateTime,
    endsAt: isoDateTime.nullable().optional(),
  })
  .refine((v) => !v.endsAt || v.endsAt > v.startsAt, {
    message: 'The end must be after the start',
    path: ['endsAt'],
  });
export type CreateEventFromTemplateInput = z.input<typeof createEventFromTemplateSchema>;

// Save an existing event's setup as a new template (the create_template_from_event RPC).
export const createTemplateFromEventSchema = z.object({
  eventId: uuid,
  name: templateName,
});
export type CreateTemplateFromEventInput = z.input<typeof createTemplateFromEventSchema>;
