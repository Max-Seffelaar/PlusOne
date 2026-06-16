import { z } from 'zod';

/** Venue settings edit (name, location address, AVG retention). Every field is
 *  optional so the action patches only what changed; address '' clears it. */
export const updateVenueSchema = z.object({
  venueId: z.string().uuid('Ongeldige venue'),
  name: z.string().trim().min(1, 'Vul een naam in').max(120, 'Naam is te lang').optional(),
  // Single free-text address line ("Straat + nr, postcode, plaats"). May be ''.
  address: z.string().trim().max(200, 'Adres is te lang').optional(),
  retentionMonths: z.coerce
    .number()
    .int('Bewaartermijn moet een heel getal zijn')
    .min(1, 'Minimaal 1 maand')
    .max(60, 'Maximaal 60 maanden')
    .optional(),
});
export type UpdateVenueInput = z.input<typeof updateVenueSchema>;
