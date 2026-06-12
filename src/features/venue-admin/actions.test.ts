import { describe, it, expect } from 'vitest';
import { updateVenueSettingsSchema, inviteUserSchema, updateUserRolesSchema, removeMembershipSchema, setDefaultQuotaSchema } from './schemas';

describe('Venue Admin Schemas', () => {
  describe('updateVenueSettingsSchema', () => {
    it('validates correct venue settings', () => {
      const input = {
        venueId: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Test Venue',
        retentionMonths: 12,
      };
      const result = updateVenueSettingsSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('rejects invalid venue ID', () => {
      const input = {
        venueId: 'invalid-id',
        name: 'Test Venue',
        retentionMonths: 12,
      };
      const result = updateVenueSettingsSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects empty name', () => {
      const input = {
        venueId: '550e8400-e29b-41d4-a716-446655440000',
        name: '',
        retentionMonths: 12,
      };
      const result = updateVenueSettingsSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects invalid retention months', () => {
      const input = {
        venueId: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Test Venue',
        retentionMonths: 100,
      };
      const result = updateVenueSettingsSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('allows null retention months', () => {
      const input = {
        venueId: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Test Venue',
        retentionMonths: null,
      };
      const result = updateVenueSettingsSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('inviteUserSchema', () => {
    it('validates correct user invitation', () => {
      const input = {
        venueId: '550e8400-e29b-41d4-a716-446655440000',
        email: 'user@example.com',
        roles: ['admin'],
      };
      const result = inviteUserSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('rejects invalid email', () => {
      const input = {
        venueId: '550e8400-e29b-41d4-a716-446655440000',
        email: 'not-an-email',
        roles: ['admin'],
      };
      const result = inviteUserSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects empty roles array', () => {
      const input = {
        venueId: '550e8400-e29b-41d4-a716-446655440000',
        email: 'user@example.com',
        roles: [],
      };
      const result = inviteUserSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects invalid role', () => {
      const input = {
        venueId: '550e8400-e29b-41d4-a716-446655440000',
        email: 'user@example.com',
        roles: ['superadmin'],
      };
      const result = inviteUserSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('accepts multiple roles', () => {
      const input = {
        venueId: '550e8400-e29b-41d4-a716-446655440000',
        email: 'user@example.com',
        roles: ['admin', 'finance'],
      };
      const result = inviteUserSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('updateUserRolesSchema', () => {
    it('validates correct role update', () => {
      const input = {
        venueId: '550e8400-e29b-41d4-a716-446655440000',
        membershipId: '550e8400-e29b-41d4-a716-446655440001',
        roles: ['staff'],
      };
      const result = updateUserRolesSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('rejects empty roles array', () => {
      const input = {
        venueId: '550e8400-e29b-41d4-a716-446655440000',
        membershipId: '550e8400-e29b-41d4-a716-446655440001',
        roles: [],
      };
      const result = updateUserRolesSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('removeMembershipSchema', () => {
    it('validates correct removal', () => {
      const input = {
        venueId: '550e8400-e29b-41d4-a716-446655440000',
        membershipId: '550e8400-e29b-41d4-a716-446655440001',
      };
      const result = removeMembershipSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('rejects invalid venue ID', () => {
      const input = {
        venueId: 'not-a-uuid',
        membershipId: '550e8400-e29b-41d4-a716-446655440001',
      };
      const result = removeMembershipSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('setDefaultQuotaSchema', () => {
    it('validates correct quota setting', () => {
      const input = {
        venueId: '550e8400-e29b-41d4-a716-446655440000',
        userId: '550e8400-e29b-41d4-a716-446655440001',
        quotaAmount: 50,
      };
      const result = setDefaultQuotaSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('rejects zero quota', () => {
      const input = {
        venueId: '550e8400-e29b-41d4-a716-446655440000',
        userId: '550e8400-e29b-41d4-a716-446655440001',
        quotaAmount: 0,
      };
      const result = setDefaultQuotaSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects negative quota', () => {
      const input = {
        venueId: '550e8400-e29b-41d4-a716-446655440000',
        userId: '550e8400-e29b-41d4-a716-446655440001',
        quotaAmount: -10,
      };
      const result = setDefaultQuotaSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects float quota', () => {
      const input = {
        venueId: '550e8400-e29b-41d4-a716-446655440000',
        userId: '550e8400-e29b-41d4-a716-446655440001',
        quotaAmount: 10.5,
      };
      const result = setDefaultQuotaSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });
});
