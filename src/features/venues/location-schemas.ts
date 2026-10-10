// Zod schemas for a company's saved locations (z8uq9m444c). Bounds mirror the
// CHECKs on public.company_locations (migration 20261013160000), which are set
// so a formatted copy ("street, postcode city") always fits the 200-char
// events.location_address: 120 + 2 + 16 + 1 + 60.

import { z } from 'zod';
import { t } from '@/lib/i18n';

export const LOCATION_LINE_MAX = 120;
export const LOCATION_POSTAL_MAX = 16;
export const LOCATION_CITY_MAX = 60;
export const LOCATION_COUNTRY_MAX = 60;
export const SAVED_LOCATION_NAME_MAX = 120;

const uuid = z.string().uuid('Invalid id');

// Trim; '' becomes NULL so the DB stores a clean null.
const optionalText = (max: number, tooLong: string) =>
  z
    .string()
    .trim()
    .max(max, tooLong)
    .transform((v) => (v === '' ? null : v));

const locationFields = {
  name: z
    .string()
    .trim()
    .min(1, t.settings.locations.nameRequired)
    .max(SAVED_LOCATION_NAME_MAX, t.settings.locations.tooLong),
  addressLine: optionalText(LOCATION_LINE_MAX, t.settings.locations.tooLong),
  postalCode: optionalText(LOCATION_POSTAL_MAX, t.settings.locations.tooLong),
  city: optionalText(LOCATION_CITY_MAX, t.settings.locations.tooLong),
  country: optionalText(LOCATION_COUNTRY_MAX, t.settings.locations.tooLong),
  // Google place id from a Places pick; informational only (never trusted for
  // anything but a later re-lookup), so a length cap is all it needs.
  placeId: optionalText(300, t.settings.locations.tooLong).optional(),
};

export const createCompanyLocationSchema = z.object({ venueId: uuid, ...locationFields });
export const updateCompanyLocationSchema = z.object({ locationId: uuid, ...locationFields });
export const archiveCompanyLocationSchema = z.object({ locationId: uuid });

export type CreateCompanyLocationInput = z.input<typeof createCompanyLocationSchema>;
export type UpdateCompanyLocationInput = z.input<typeof updateCompanyLocationSchema>;
export type ArchiveCompanyLocationInput = z.input<typeof archiveCompanyLocationSchema>;
