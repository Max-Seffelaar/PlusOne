import { z } from 'zod';

export const createEventSchema = z.object({
  venueId: z.string().uuid('Venue ID is required'),
  name: z.string().min(1, 'Event name is required').max(255, 'Event name is too long'),
  landing_slug: z
    .string()
    .min(3, 'Landing slug must be at least 3 characters')
    .max(50, 'Landing slug is too long')
    .regex(/^[a-z0-9-]+$/, 'Landing slug must contain only lowercase letters, numbers, and hyphens')
    .optional(),
  startTime: z.string().datetime('Start time must be a valid ISO 8601 datetime'),
  endTime: z.string().datetime('End time must be a valid ISO 8601 datetime'),
});

export const updateEventSchema = z.object({
  id: z.string().uuid('Event ID is required'),
  venueId: z.string().uuid('Venue ID is required'),
  name: z
    .string()
    .min(1, 'Event name is required')
    .max(255, 'Event name is too long')
    .optional(),
  landing_slug: z
    .string()
    .min(3, 'Landing slug must be at least 3 characters')
    .max(50, 'Landing slug is too long')
    .regex(/^[a-z0-9-]+$/, 'Landing slug must contain only lowercase letters, numbers, and hyphens')
    .optional(),
  startTime: z.string().datetime('Start time must be a valid ISO 8601 datetime').optional(),
  endTime: z.string().datetime('End time must be a valid ISO 8601 datetime').optional(),
  status: z
    .enum(['draft', 'open', 'live', 'closed'], {
      errorMap: () => ({ message: 'Status must be one of: draft, open, live, closed' }),
    })
    .optional(),
});

export const softDeleteEventSchema = z.object({
  id: z.string().uuid('Event ID is required'),
  venueId: z.string().uuid('Venue ID is required'),
});

export const createGuestTierSchema = z.object({
  eventId: z.string().uuid('Event ID is required'),
  name: z.string().min(1, 'Tier name is required').max(100, 'Tier name is too long'),
  description: z.string().max(500, 'Description is too long').optional(),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$|^#[0-9a-f]{3}$/, 'Color must be a valid hex code (e.g., #RRGGBB)')
    .optional(),
  maxCount: z
    .number()
    .int('Max count must be an integer')
    .positive('Max count must be greater than 0')
    .optional(),
});

export const updateGuestTierSchema = z.object({
  id: z.string().uuid('Tier ID is required'),
  eventId: z.string().uuid('Event ID is required'),
  name: z.string().min(1, 'Tier name is required').max(100, 'Tier name is too long').optional(),
  description: z.string().max(500, 'Description is too long').optional(),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$|^#[0-9a-f]{3}$/, 'Color must be a valid hex code (e.g., #RRGGBB)')
    .optional(),
  maxCount: z
    .number()
    .int('Max count must be an integer')
    .positive('Max count must be greater than 0')
    .optional(),
});

export const deleteGuestTierSchema = z.object({
  id: z.string().uuid('Tier ID is required'),
  eventId: z.string().uuid('Event ID is required'),
});

export const assignOrganizerSchema = z.object({
  eventId: z.string().uuid('Event ID is required'),
  userId: z.string().uuid('User ID is required'),
});

export const inviteOrganizerSchema = z.object({
  eventId: z.string().uuid('Event ID is required'),
  email: z.string().email('Invalid email address'),
});

export const removeOrganizerSchema = z.object({
  eventId: z.string().uuid('Event ID is required'),
  userId: z.string().uuid('User ID is required'),
});

export const lockEventListSchema = z.object({
  id: z.string().uuid('Event ID is required'),
  venueId: z.string().uuid('Venue ID is required'),
});

export const unlockEventListSchema = z.object({
  id: z.string().uuid('Event ID is required'),
  venueId: z.string().uuid('Venue ID is required'),
});

export const setLandingActiveSchema = z.object({
  id: z.string().uuid('Event ID is required'),
  venueId: z.string().uuid('Venue ID is required'),
  active: z.boolean(),
});

// Type exports for use in components
export type CreateEvent = z.infer<typeof createEventSchema>;
export type UpdateEvent = z.infer<typeof updateEventSchema>;
export type SoftDeleteEvent = z.infer<typeof softDeleteEventSchema>;
export type CreateGuestTier = z.infer<typeof createGuestTierSchema>;
export type UpdateGuestTier = z.infer<typeof updateGuestTierSchema>;
export type DeleteGuestTier = z.infer<typeof deleteGuestTierSchema>;
export type AssignOrganizer = z.infer<typeof assignOrganizerSchema>;
export type InviteOrganizer = z.infer<typeof inviteOrganizerSchema>;
export type RemoveOrganizer = z.infer<typeof removeOrganizerSchema>;
export type LockEventList = z.infer<typeof lockEventListSchema>;
export type UnlockEventList = z.infer<typeof unlockEventListSchema>;
export type SetLandingActive = z.infer<typeof setLandingActiveSchema>;
