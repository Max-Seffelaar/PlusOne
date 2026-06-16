import { z } from 'zod';

// Address-book (contacts) input validation — every contacts mutation is parsed
// here before any DB call (CLAUDE.md security checklist). The DB's generated
// *_norm columns + unique indexes are the dedup authority; these schemas only
// guard shape. Dutch messages, English code.

const uuid = z.string().uuid();
const fullName = z.string().trim().min(1, 'Naam is verplicht').max(200);

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
    'Ongeldig e-mailadres'
  );

// E.164 (the landing form already produces this via react-phone-number-input).
const phone = z
  .string()
  .max(40)
  .optional()
  .transform(emptyToUndef)
  .refine(
    (v) => v === undefined || /^\+[1-9]\d{1,14}$/.test(v),
    'Controleer het telefoonnummer (incl. landcode).'
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
  .refine(plausibleDob, 'Ongeldige geboortedatum');

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

/** Sync the venue's permanent contacts onto one event (#11). */
export const syncPermanentSchema = z.object({
  eventId: uuid,
});
export type SyncPermanentInput = z.input<typeof syncPermanentSchema>;

/** Add a single contact from the address book to an event (Adresboek "+"). */
export const addContactToEventSchema = z.object({
  contactId: uuid,
  eventId: uuid,
  tierId: uuid.optional(),
});
export type AddContactToEventInput = z.input<typeof addContactToEventSchema>;

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
    .min(1, 'Geen contacten om te importeren')
    .max(2000, 'Te veel rijen in één import (max 2000)'),
});
export type ImportContactsInput = z.input<typeof importContactsSchema>;
