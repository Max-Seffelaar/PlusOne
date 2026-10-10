// Company contact for guest mail (Gastcommunicatie F, z8uq9m2vpy). Its own
// schema + action next to the venue settings, so the contact section can save
// on its own (and task 3b's venue/location work never collides with it).
// Bounds match the DB checks in 20261013180100_company_contact_channels.sql.

import { z } from 'zod';
import { t } from '@/lib/i18n';

export const CONTACT_CHANNELS = ['phone', 'instagram', 'facebook', 'snapchat', 'tiktok'] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

const channelValue = z
  .string()
  .trim()
  // One line, no markup characters: it is shown to guests on the status page.
  .max(100, t.settings.contact.channelTooLong)
  .refine((v) => !/[<>"\r\n]/.test(v), t.settings.contact.channelInvalid)
  .transform((v) => (v === '' ? null : v));

export const companyContactSchema = z.object({
  venueId: z.string().uuid(),
  contactEmail: z
    .string()
    .trim()
    .max(254, t.settings.contact.emailInvalid)
    .transform((v) => (v === '' ? null : v.toLowerCase()))
    .refine(
      (v) => v === null || /^[^@\s<>",;:]+@[^@\s<>",;:]+\.[^@\s<>",;:]+$/.test(v),
      t.settings.contact.emailInvalid,
    ),
  channels: z.object({
    phone: channelValue,
    instagram: channelValue,
    facebook: channelValue,
    snapchat: channelValue,
    tiktok: channelValue,
  }),
  guestConfirmationDefault: z.boolean(),
});
export type CompanyContactInput = z.input<typeof companyContactSchema>;

/** The jsonb the DB stores: only the channels that are filled in. */
export function channelsToJson(channels: Record<ContactChannel, string | null>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of CONTACT_CHANNELS) {
    const value = channels[key];
    if (value) out[key] = value;
  }
  return out;
}
