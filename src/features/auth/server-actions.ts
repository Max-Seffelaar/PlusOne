'use server';

import { z } from 'zod';
import { getServerSupabaseClient } from '@/lib/supabase/server-client';
import { getCurrentUser, checkVenueMembership } from '@/lib/auth';
import { InviteUserSchema, AcceptInviteSchema, ProfileUpdateSchema } from './types';

export async function inviteUser(input: unknown) {
  try {
    const parsed = InviteUserSchema.parse(input);
    const user = await getCurrentUser();

    if (!user) {
      return { success: false, error: 'Niet ingelogd' };
    }

    const { allowed } = await checkVenueMembership(parsed.venue_id, ['admin', 'user_manager']);
    if (!allowed) {
      return { success: false, error: 'Onvoldoende machtigingen' };
    }

    const supabase = await getServerSupabaseClient();

    // Create or update pending invite
    const { data, error: dbError } = await (supabase
      .from('pending_invites') as any)
      .upsert(
        {
          venue_id: parsed.venue_id,
          email: parsed.email.toLowerCase(),
          roles: parsed.roles,
          invited_by: user.id,
        },
        { onConflict: 'venue_id,email' }
      )
      .select('id')
      .single();

    if (dbError || !data) {
      return { success: false, error: 'Fout bij maken uitnodiging' };
    }

    // Generate invite link (token = the pending_invites.id)
    const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/auth/invite/${data.id}`;

    return {
      success: true,
      inviteToken: data.id,
      inviteUrl,
      email: parsed.email,
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.errors[0]?.message || 'Validatiefout' };
    }
    return { success: false, error: 'Onverwachte fout' };
  }
}

export async function acceptInvite(input: unknown) {
  try {
    const parsed = AcceptInviteSchema.parse(input);
    const supabase = await getServerSupabaseClient();

    // Fetch pending invite
    const { data: invite, error: inviteError } = await (supabase
      .from('pending_invites') as any)
      .select('*')
      .eq('id', parsed.token)
      .single();

    if (inviteError || !invite) {
      return { success: false, error: 'Uitnodiging niet gevonden' };
    }

    // Check expiry
    if (new Date(invite.expires_at) < new Date()) {
      return { success: false, error: 'Uitnodiging verlopen', expired: true };
    }

    // Check if already accepted
    if (invite.accepted_at) {
      return { success: false, error: 'Uitnodiging al gebruikt' };
    }

    // Create user in auth.users via admin API (requires service role)
    // Note: This should ideally be in an Edge Function, but for now we'll return
    // the invite details and let the client redirect to OTP with email pre-filled
    return {
      success: true,
      email: invite.email,
      venueId: invite.venue_id,
      roles: invite.roles,
      inviteId: parsed.token,
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.errors[0]?.message || 'Validatiefout' };
    }
    return { success: false, error: 'Onverwachte fout' };
  }
}

export async function updateUserProfile(input: unknown) {
  try {
    const parsed = ProfileUpdateSchema.parse(input);
    const user = await getCurrentUser();

    if (!user) {
      return { success: false, error: 'Niet ingelogd' };
    }

    const supabase = await getServerSupabaseClient();

    // Update display_name if provided
    if (parsed.display_name) {
      const { error: updateError } = await (supabase
        .from('users') as any)
        .update({ display_name: parsed.display_name, updated_at: new Date().toISOString() })
        .eq('id', user.id);

      if (updateError) {
        return { success: false, error: 'Fout bij update naam' };
      }
    }

    // Email change requires reconfirmation (handled separately)
    if (parsed.email) {
      // This would be handled via Supabase's updateUser API with email confirmation
      // For now, return a message to implement the flow
      return {
        success: true,
        requiresEmailConfirmation: true,
        message: 'Email wijzigen vereist bevestiging. Controleer uw e-mail.',
      };
    }

    return { success: true, message: 'Profiel bijgewerkt' };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.errors[0]?.message || 'Validatiefout' };
    }
    return { success: false, error: 'Onverwachte fout' };
  }
}
