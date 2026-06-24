// Zod schemas for every event-management input (CLAUDE.md security checklist:
// all input through Zod, no raw formData passthrough). Shared by the server
// actions and the client forms so the rules live in exactly one place.

import { z } from 'zod';
import { EVENT_STATUSES } from './status';

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

const eventStatus = z.enum(EVENT_STATUSES as unknown as [string, ...string[]]);

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

export const changeStatusSchema = z.object({
  eventId: uuid,
  status: eventStatus,
});
export type ChangeStatusInput = z.input<typeof changeStatusSchema>;

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

export const createTierSchema = z.object({
  eventId: uuid,
  name: z.string().trim().min(1, 'Enter a name').max(80, 'Name is too long'),
  description: optionalText(280),
  color: hexColor.nullable().optional(),
  maxGuests,
  aliases,
});
export type CreateTierInput = z.input<typeof createTierSchema>;

export const updateTierSchema = z.object({
  tierId: uuid,
  name: z.string().trim().min(1, 'Enter a name').max(80).optional(),
  description: optionalText(280),
  color: hexColor.nullable().optional(),
  maxGuests,
  aliases: aliases.optional(),
});
export type UpdateTierInput = z.input<typeof updateTierSchema>;

export const deleteTierSchema = z.object({ tierId: uuid });
export type DeleteTierInput = z.input<typeof deleteTierSchema>;

// ── Organizers (#6/#24) ──────────────────────────────────────────────────────

export const assignOrganizerSchema = z.object({
  eventId: uuid,
  userId: uuid,
});
export type AssignOrganizerInput = z.input<typeof assignOrganizerSchema>;

export const inviteOrganizerSchema = z.object({
  eventId: uuid,
  email: z
    .string()
    .trim()
    .min(1, 'Enter an email')
    .max(254)
    .email('Invalid email')
    .transform((v) => v.toLowerCase()),
});
export type InviteOrganizerInput = z.input<typeof inviteOrganizerSchema>;

export const removeOrganizerSchema = z.object({
  eventId: uuid,
  userId: uuid,
});
export type RemoveOrganizerInput = z.input<typeof removeOrganizerSchema>;
