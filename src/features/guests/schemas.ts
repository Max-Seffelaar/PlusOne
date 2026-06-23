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
export const guestSource = z.enum(['app', 'landing', 'door']);

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
