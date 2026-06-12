import { z } from 'zod';

export const updateVenueSettingsSchema = z.object({
  venueId: z.string().uuid(),
  name: z.string().min(1, 'Naam is verplicht').max(255),
  retentionMonths: z.number().int().min(1, 'Minimaal 1 maand').max(60, 'Maximaal 60 maanden').nullable(),
});

export type UpdateVenueSettings = z.infer<typeof updateVenueSettingsSchema>;

export const inviteUserSchema = z.object({
  venueId: z.string().uuid(),
  email: z.string().email('Ongeldig e-mailadres'),
  roles: z.array(z.enum(['admin', 'user_manager', 'finance', 'staff', 'doorhost'])).min(1, 'Selecteer minstens één rol'),
});

export type InviteUser = z.infer<typeof inviteUserSchema>;

export const updateUserRolesSchema = z.object({
  venueId: z.string().uuid(),
  membershipId: z.string().uuid(),
  roles: z.array(z.enum(['admin', 'user_manager', 'finance', 'staff', 'doorhost'])).min(1, 'Selecteer minstens één rol'),
});

export type UpdateUserRoles = z.infer<typeof updateUserRolesSchema>;

export const removeMembershipSchema = z.object({
  venueId: z.string().uuid(),
  membershipId: z.string().uuid(),
});

export type RemoveMembership = z.infer<typeof removeMembershipSchema>;

export const setDefaultQuotaSchema = z.object({
  venueId: z.string().uuid(),
  userId: z.string().uuid(),
  quotaAmount: z.number().int().positive('Quotum moet groter dan 0 zijn'),
});

export type SetDefaultQuota = z.infer<typeof setDefaultQuotaSchema>;
