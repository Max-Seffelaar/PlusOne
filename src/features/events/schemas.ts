import { z } from 'zod';

// Event + tier input validation (CLAUDE.md security checklist: every action
// parses through Zod before any DB call). Dates are coerced so the UI can send
// either an ISO string or a Date; the action serialises to ISO for Postgres.

const uuid = z.string().uuid();
const eventName = z.string().trim().min(1, 'Naam is verplicht').max(200);
const tierName = z.string().trim().min(1, 'Naam is verplicht').max(80);
const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Ongeldige kleur')
  .nullable()
  .optional();
const maxGuests = z.number().int().min(0).max(100000).nullable().optional();
const description = z
  .string()
  .trim()
  .max(200)
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();
const aliases = z.array(z.string().trim().min(1).max(40)).max(40);

// ── Events ──────────────────────────────────────────────────────────────────

export const createEventSchema = z.object({
  venueId: uuid,
  name: eventName,
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().nullable().optional(),
  landingActive: z.boolean().default(false),
});
export type CreateEventInput = z.input<typeof createEventSchema>;

export const updateEventSchema = z.object({
  eventId: uuid,
  name: eventName.optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  landingActive: z.boolean().optional(),
});
export type UpdateEventInput = z.input<typeof updateEventSchema>;

export const setListLockSchema = z.object({
  eventId: uuid,
  locked: z.boolean(),
});
export type SetListLockInput = z.input<typeof setListLockSchema>;

// ── Tiers (#8/#33) ──────────────────────────────────────────────────────────

export const createTierSchema = z.object({
  eventId: uuid,
  name: tierName,
  color: hexColor,
  maxGuests,
  description,
  aliases: aliases.default([]),
});
export type CreateTierInput = z.input<typeof createTierSchema>;

export const updateTierSchema = z.object({
  tierId: uuid,
  name: tierName.optional(),
  color: hexColor,
  maxGuests,
  description,
  aliases: aliases.optional(),
});
export type UpdateTierInput = z.input<typeof updateTierSchema>;
