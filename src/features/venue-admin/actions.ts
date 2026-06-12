'use server';

import { getServerSupabaseClient } from '@/lib/supabase/server-client';
import { getCurrentUser, checkVenueMembership, checkAAL2 } from '@/lib/auth';
import {
  updateVenueSettingsSchema,
  inviteUserSchema,
  updateUserRolesSchema,
  removeMembershipSchema,
  setDefaultQuotaSchema,
} from './schemas';

export async function updateVenueSettings(input: unknown) {
  const parsed = updateVenueSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { error: { auth: ['Niet ingelogd'] } };
  }

  const { allowed, error } = await checkVenueMembership(parsed.data.venueId, ['admin']);
  if (!allowed) {
    return { error: { auth: [error || 'Geen toegang'] } };
  }

  const supabase = await getServerSupabaseClient();
  const { error: updateError } = await supabase
    .from('venues')
    .update({
      name: parsed.data.name,
      retention_days: parsed.data.retentionMonths ? parsed.data.retentionMonths * 30 : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.venueId);

  if (updateError) {
    return { error: { db: [updateError.message] } };
  }

  return { success: true };
}

export async function inviteUser(input: unknown) {
  const parsed = inviteUserSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { error: { auth: ['Niet ingelogd'] } };
  }

  const { allowed, error } = await checkVenueMembership(parsed.data.venueId, ['admin', 'user_manager']);
  if (!allowed) {
    return { error: { auth: [error || 'Geen toegang'] } };
  }

  const supabase = await getServerSupabaseClient();

  const { data: existingUser } = await supabase
    .from('users')
    .select('id')
    .eq('email', parsed.data.email)
    .single();

  let userId: string;

  if (existingUser) {
    userId = existingUser.id;

    const { data: existingMembership } = await supabase
      .from('venue_memberships')
      .select('id')
      .eq('venue_id', parsed.data.venueId)
      .eq('user_id', userId)
      .single();

    if (existingMembership) {
      return { error: { membership: ['Gebruiker is al lid van deze venue'] } };
    }
  } else {
    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert({
        email: parsed.data.email,
        id: crypto.getRandomValues(new Uint8Array(16)).reduce((a, b) => a + b.toString(16), ''),
      })
      .select('id')
      .single();

    if (createError || !newUser) {
      return { error: { db: ['Kon gebruiker niet aanmaken'] } };
    }

    userId = newUser.id;
  }

  const { error: membershipError } = await supabase
    .from('venue_memberships')
    .insert({
      venue_id: parsed.data.venueId,
      user_id: userId,
      roles: parsed.data.roles,
    });

  if (membershipError) {
    return { error: { db: [membershipError.message] } };
  }

  return { success: true, userId };
}

export async function updateUserRoles(input: unknown) {
  const parsed = updateUserRolesSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { error: { auth: ['Niet ingelogd'] } };
  }

  const { allowed, error } = await checkVenueMembership(parsed.data.venueId, ['admin']);
  if (!allowed) {
    return { error: { auth: [error || 'Geen toegang'] } };
  }

  if (parsed.data.roles.includes('admin') || parsed.data.roles.includes('finance')) {
    const isAAL2 = await checkAAL2(user);
    if (!isAAL2) {
      return { error: { auth: ['Tweeledige verificatie vereist voor admin/finance rollen'] } };
    }
  }

  const supabase = await getServerSupabaseClient();

  const { data: membership, error: fetchError } = await supabase
    .from('venue_memberships')
    .select('*')
    .eq('id', parsed.data.membershipId)
    .eq('venue_id', parsed.data.venueId)
    .single();

  if (fetchError || !membership) {
    return { error: { membership: ['Membership niet gevonden'] } };
  }

  const { error: updateError } = await supabase
    .from('venue_memberships')
    .update({
      roles: parsed.data.roles,
      updated_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.membershipId);

  if (updateError) {
    return { error: { db: [updateError.message] } };
  }

  return { success: true };
}

export async function removeMembership(input: unknown) {
  const parsed = removeMembershipSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { error: { auth: ['Niet ingelogd'] } };
  }

  const { allowed, error } = await checkVenueMembership(parsed.data.venueId, ['admin']);
  if (!allowed) {
    return { error: { auth: [error || 'Geen toegang'] } };
  }

  const supabase = await getServerSupabaseClient();

  const { data: membership, error: fetchError } = await supabase
    .from('venue_memberships')
    .select('*')
    .eq('id', parsed.data.membershipId)
    .eq('venue_id', parsed.data.venueId)
    .single();

  if (fetchError || !membership) {
    return { error: { membership: ['Membership niet gevonden'] } };
  }

  if (membership.user_id === user.id && membership.roles.includes('admin')) {
    return { error: { membership: ['Kan jezelf niet uit admin-rol verwijderen'] } };
  }

  const { error: deleteError } = await supabase
    .from('venue_memberships')
    .delete()
    .eq('id', parsed.data.membershipId);

  if (deleteError) {
    return { error: { db: [deleteError.message] } };
  }

  return { success: true };
}

export async function setDefaultQuota(input: unknown) {
  const parsed = setDefaultQuotaSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { error: { auth: ['Niet ingelogd'] } };
  }

  const { allowed, error } = await checkVenueMembership(parsed.data.venueId, ['admin']);
  if (!allowed) {
    return { error: { auth: [error || 'Geen toegang'] } };
  }

  const supabase = await getServerSupabaseClient();

  const { data: existing } = await supabase
    .from('quotas')
    .select('id')
    .eq('venue_id', parsed.data.venueId)
    .eq('user_id', parsed.data.userId)
    .single();

  if (existing) {
    const { error: updateError } = await supabase
      .from('quotas')
      .update({
        default_count: parsed.data.quotaAmount,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);

    if (updateError) {
      return { error: { db: [updateError.message] } };
    }
  } else {
    const { error: createError } = await supabase
      .from('quotas')
      .insert({
        venue_id: parsed.data.venueId,
        user_id: parsed.data.userId,
        default_count: parsed.data.quotaAmount,
      });

    if (createError) {
      return { error: { db: [createError.message] } };
    }
  }

  return { success: true };
}
