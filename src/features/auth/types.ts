import { z } from 'zod';

export const LoginOTPRequestSchema = z.object({
  email: z.string().email('Ongeldig e-mailadres'),
});

export type LoginOTPRequest = z.infer<typeof LoginOTPRequestSchema>;

export const LoginOTPVerifySchema = z.object({
  email: z.string().email('Ongeldig e-mailadres'),
  otp: z.string().regex(/^\d{6}$/, 'Code moet 6 cijfers zijn'),
});

export type LoginOTPVerify = z.infer<typeof LoginOTPVerifySchema>;

export const AcceptInviteSchema = z.object({
  token: z.string().uuid('Ongeldig uitnodigingstoken'),
  display_name: z.string().min(1, 'Naam is vereist').max(255),
});

export type AcceptInvite = z.infer<typeof AcceptInviteSchema>;

export const InviteUserSchema = z.object({
  venue_id: z.string().uuid('Ongeldig venue ID'),
  email: z.string().email('Ongeldig e-mailadres'),
  roles: z.array(z.enum(['admin', 'user_manager', 'finance', 'staff', 'doorhost'])).min(1, 'Ten minste één rol selecteren'),
});

export type InviteUser = z.infer<typeof InviteUserSchema>;

export const MFAEnrollVerifySchema = z.object({
  otp: z.string().regex(/^\d{6}$/, 'Code moet 6 cijfers zijn'),
});

export type MFAEnrollVerify = z.infer<typeof MFAEnrollVerifySchema>;

export const ProfileUpdateSchema = z.object({
  display_name: z.string().min(1, 'Naam is vereist').max(255).optional(),
  email: z.string().email('Ongeldig e-mailadres').optional(),
}).refine(
  (data) => data.display_name !== undefined || data.email !== undefined,
  { message: 'Minimaal één veld wijzigen' }
);

export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>;

export const SessionRevokeSchema = z.object({
  session_id: z.string().uuid('Ongeldig sessie ID'),
});

export type SessionRevoke = z.infer<typeof SessionRevokeSchema>;
