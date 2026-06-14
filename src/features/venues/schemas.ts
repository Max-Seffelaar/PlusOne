import { z } from 'zod';

const uuid = z.string().uuid();

/**
 * Per-venue AVG retention window before guest anonymization (#16/#29).
 * Default is 12 months; minimum 1 month (spec), and the DB CHECK caps it at 60.
 * coerce so a form-submitted string ("12") validates as the number.
 */
export const retentionSchema = z.object({
  venueId: uuid,
  retentionMonths: z.coerce
    .number()
    .int('Hele maanden')
    .min(1, 'Minimaal 1 maand')
    .max(60, 'Maximaal 60 maanden'),
});
export type RetentionInput = z.input<typeof retentionSchema>;
