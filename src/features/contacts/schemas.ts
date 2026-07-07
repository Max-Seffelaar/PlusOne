import { z } from 'zod';

// Address-book (contacts) input validation — every contacts mutation is parsed
// here before any DB call (CLAUDE.md security checklist). The DB's generated
// *_norm columns + unique indexes are the dedup authority; these schemas only
// guard shape.

const uuid = z.string().uuid();
// 500 (was 200): a real import row is voornaam + achternaam + phone + email +
// tier + tickets, which stays well under 500. The old 200 cap let one long,
// descriptive pasted line fail the WHOLE batch (T12 feedback 1/7). The import
// preview now flags + lets the user fix over-long rows before commit.
const fullName = z.string().trim().min(1, 'Name is required').max(500);

/** Mirrors the prototype Role union; a preference hint that drives tier mapping. */
export const contactRole = z.enum(['vip', 'all_access', 'artist', 'press', 'crew', 'guest']);
export type ContactRole = z.infer<typeof contactRole>;

const emptyToUndef = (v: string | undefined) => {
  const t = v?.trim();
  return t ? t : undefined;
};

const email = z
  .string()
  .max(254)
  .optional()
  .transform(emptyToUndef)
  .refine(
    (v) => v === undefined || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v),
    'Invalid email'
  );

// E.164 (the landing form already produces this via react-phone-number-input).
const phone = z
  .string()
  .max(40)
  .optional()
  .transform(emptyToUndef)
  .refine(
    (v) => v === undefined || /^\+[1-9]\d{1,14}$/.test(v),
    'Check the phone number, including the country code.'
  );

/** ISO YYYY-MM-DD; must parse and be a plausible birthday (age 0–120). */
function plausibleDob(v: string | undefined): boolean {
  if (v === undefined) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  const years = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
  return years >= 0 && years <= 120;
}

const birthdate = z
  .string()
  .optional()
  .transform(emptyToUndef)
  .refine(plausibleDob, 'Invalid date of birth');

const note = z
  .string()
  .max(1000)
  .optional()
  .transform(emptyToUndef);

/** Create or edit one contact. id present + existing → update; else insert. */
export const upsertContactSchema = z.object({
  // Client-generatable UUIDv7 (offline parity, #25); optional online.
  id: uuid.optional(),
  venueId: uuid,
  fullName,
  email,
  phone,
  birthdate,
  preferredRole: contactRole.optional(),
  note,
  isPermanent: z.boolean().optional(),
});
export type UpsertContactInput = z.input<typeof upsertContactSchema>;

/** Star/unstar a contact as a permanent guest (#11). */
export const togglePermanentSchema = z.object({
  contactId: uuid,
  isPermanent: z.boolean(),
});
export type TogglePermanentInput = z.input<typeof togglePermanentSchema>;

/** Explicit name-only promote: create a contact from a guest even without dedup key.
 *  Calls the promote_guest_to_contact SECURITY DEFINER RPC (20260625100000). */
export const promoteGuestToContactSchema = z.object({
  guestId: uuid,
});
export type PromoteGuestToContactInput = z.input<typeof promoteGuestToContactSchema>;

/** Bulk "mark as regular" (T11): star the guest's contact, auto-promoting a
 *  name-only guest to a contact first. Calls mark_guest_regular (20260707150000). */
export const markGuestRegularSchema = z.object({
  guestId: uuid,
});
export type MarkGuestRegularInput = z.input<typeof markGuestRegularSchema>;

/**
 * On-request erasure ("forget me", AVG art. 17 / #29): anonymize one contact +
 * all its linked guests immediately. Admin + AAL2 is enforced in the DB function
 * (forget_contact) — this schema only guards the shape.
 */
export const forgetContactSchema = z.object({
  contactId: uuid,
});
export type ForgetContactInput = z.input<typeof forgetContactSchema>;

/** Sync the venue's permanent contacts onto one event (#11). */
export const syncPermanentSchema = z.object({
  eventId: uuid,
});
export type SyncPermanentInput = z.input<typeof syncPermanentSchema>;

/** Add a single contact from the address book to an event (Adresboek "+"). The
 *  optional plus-ones ("hoeveel extra plekken?") is bounded like a normal guest add. */
export const addContactToEventSchema = z.object({
  contactId: uuid,
  eventId: uuid,
  tierId: uuid.optional(),
  plusOnes: z.number().int().min(0).max(50).optional(),
});
export type AddContactToEventInput = z.input<typeof addContactToEventSchema>;

/** Add many contacts to one event in one go — the post-import "add these people
 *  to an event" step (#3). Optional tierId overrides the per-contact resolution. */
export const addContactsToEventSchema = z.object({
  eventId: uuid,
  contactIds: z.array(uuid).min(1, 'No contacts to add').max(2000, 'Too many contacts'),
  tierId: uuid.optional(),
});
export type AddContactsToEventInput = z.input<typeof addContactsToEventSchema>;

/** Bulk import (paste / CSV / phone-contacts) into the address book (#10). */
export const importContactsSchema = z.object({
  venueId: uuid,
  rows: z
    .array(
      z.object({
        fullName,
        email,
        phone,
        birthdate,
        preferredRole: contactRole.optional(),
      })
    )
    .min(1, 'No contacts to import')
    .max(2000, 'Too many rows in one import (max 2000)'),
});
export type ImportContactsInput = z.input<typeof importContactsSchema>;
