import { z } from 'zod';

// All guest input is validated here before any DB call (CLAUDE.md security
// checklist). Names are the only required field (#9: more data is better, but
// fields stay optional). plus_ones is bounded defensively.

const uuid = z.string().uuid();
const fullName = z.string().trim().min(1, 'Name is required').max(200);
const plusOnes = z.number().int().min(0).max(50);

/** Empty string from a form field -> null (optional, dataminimalisatie #9). */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

export const notePriority = z.enum(['none', 'low', 'high']);
// Direct client inserts may only ever be 'app' (quick-add) or 'door' (door
// add-on-the-spot). 'landing'/'permanent' guests are created exclusively by the
// SECURITY DEFINER RPCs (approve_guest_request / sync_permanent_guests_into_event)
// and are rejected by the guests_insert RLS WITH CHECK — forging them would dodge
// personal quota (#22/#31, migration 20260623140200). Defense in depth.
export const guestSource = z.enum(['app', 'door']);

/** One guest to create (quick-add resolved line, or door add-on-the-spot). */
export const addGuestSchema = z.object({
  // Client-generated UUIDv7 for the offline outbox (#25); optional online.
  id: uuid.optional(),
  eventId: uuid,
  tierId: uuid,
  fullName,
  plusOnes: plusOnes.default(0),
  email: optionalText(320),
  phone: optionalText(40),
  source: guestSource.default('app'),
});
export type AddGuestInput = z.input<typeof addGuestSchema>;

/** A bulk paste: many lines at once. The DB rejects the whole batch on overage. */
export const bulkAddSchema = z.object({
  eventId: uuid,
  source: guestSource.default('app'),
  guests: z
    .array(
      z.object({
        id: uuid.optional(),
        tierId: uuid,
        fullName,
        plusOnes: plusOnes.default(0),
        email: optionalText(320),
        phone: optionalText(40),
      })
    )
    .min(1, 'No guests to add')
    .max(500, 'Too many lines at once'),
});
export type BulkAddInput = z.input<typeof bulkAddSchema>;

/** Classic edit form for an existing guest (partial). */
export const updateGuestSchema = z.object({
  guestId: uuid,
  fullName: fullName.optional(),
  plusOnes: plusOnes.optional(),
  email: optionalText(320),
  phone: optionalText(40),
  note: optionalText(1000),
  notePriority: notePriority.optional(),
});
export type UpdateGuestInput = z.input<typeof updateGuestSchema>;

/** Move an existing guest to another tier (logged as tier_change, #5/role matrix). */
export const changeTierSchema = z.object({
  guestId: uuid,
  tierId: uuid,
});
export type ChangeTierInput = z.input<typeof changeTierSchema>;

/** Bulk tier change: move multiple guests to the same tier in one update. */
export const changeTierBulkSchema = z.object({
  guestIds: z.array(uuid).min(1).max(500),
  tierId: uuid,
  eventId: uuid,
});
export type ChangeTierBulkInput = z.input<typeof changeTierBulkSchema>;
