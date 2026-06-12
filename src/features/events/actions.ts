'use server';

import { getServerSupabaseClient } from '@/lib/supabase/server-client';
import { getCurrentUser, checkVenueMembership } from '@/lib/auth';
import * as schemas from './schemas';

// ===== HELPER FUNCTIONS =====

function errorResponse(fieldName: string, message: string) {
  return { error: { [fieldName]: [message] } };
}

async function validateUserAndVenue(venueId: string, requiredRoles?: string[]) {
  const user = await getCurrentUser();
  if (!user) {
    return { user: null, allowed: false, error: 'unauthorized' };
  }

  const { allowed, membership, error } = await checkVenueMembership(venueId, requiredRoles);
  return { user, allowed, membership, error };
}

// ===== EVENT CRUD =====

export async function createEvent(input: schemas.CreateEvent) {
  const parsed = schemas.createEventSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const { user, allowed, error: authError } = await validateUserAndVenue(
    parsed.data.venueId,
    ['admin'],
  );

  if (!allowed) {
    return errorResponse('venueId', authError || 'forbidden');
  }

  const supabase = await getServerSupabaseClient();

  // Check landing_slug uniqueness if provided
  if (parsed.data.landing_slug) {
    const { data: existing } = await supabase
      .from('events')
      .select('id')
      .eq('venue_id', parsed.data.venueId)
      .eq('landing_slug', parsed.data.landing_slug)
      .single();

    if (existing) {
      return errorResponse('landing_slug', 'Landing slug is already in use for this venue');
    }
  }

  const { data, error } = await supabase
    .from('events')
    .insert([
      {
        venue_id: parsed.data.venueId,
        name: parsed.data.name,
        landing_slug: parsed.data.landing_slug || null,
        start_time: parsed.data.startTime,
        end_time: parsed.data.endTime,
        status: 'draft',
      },
    ])
    .select()
    .single();

  if (error) {
    console.error('Event creation error:', error);
    return errorResponse('name', 'Could not create event');
  }

  return { success: true, data };
}

export async function updateEvent(input: schemas.UpdateEvent) {
  const parsed = schemas.updateEventSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const { user, allowed, error: authError } = await validateUserAndVenue(
    parsed.data.venueId,
    ['admin'],
  );

  if (!allowed) {
    return errorResponse('venueId', authError || 'forbidden');
  }

  const supabase = await getServerSupabaseClient();

  // Get current event to validate status transitions
  const { data: currentEvent, error: fetchError } = await supabase
    .from('events')
    .select('status')
    .eq('id', parsed.data.id)
    .eq('venue_id', parsed.data.venueId)
    .single();

  if (fetchError || !currentEvent) {
    return errorResponse('id', 'Event not found');
  }

  // Validate status transitions (draft -> open -> live -> closed only)
  const validTransitions: Record<string, string[]> = {
    draft: ['open', 'draft'],
    open: ['live', 'open'],
    live: ['closed', 'live'],
    closed: ['closed'],
  };

  if (parsed.data.status) {
    const allowedStatuses = validTransitions[currentEvent.status] || [];
    if (!allowedStatuses.includes(parsed.data.status)) {
      return errorResponse(
        'status',
        `Cannot transition from ${currentEvent.status} to ${parsed.data.status}`,
      );
    }
  }

  // Check landing_slug uniqueness if changed
  if (parsed.data.landing_slug) {
    const { data: existing } = await supabase
      .from('events')
      .select('id')
      .eq('venue_id', parsed.data.venueId)
      .eq('landing_slug', parsed.data.landing_slug)
      .neq('id', parsed.data.id)
      .single();

    if (existing) {
      return errorResponse('landing_slug', 'Landing slug is already in use for this venue');
    }
  }

  const updateData: any = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.landing_slug !== undefined) updateData.landing_slug = parsed.data.landing_slug;
  if (parsed.data.startTime !== undefined) updateData.start_time = parsed.data.startTime;
  if (parsed.data.endTime !== undefined) updateData.end_time = parsed.data.endTime;
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
  updateData.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('events')
    .update(updateData)
    .eq('id', parsed.data.id)
    .eq('venue_id', parsed.data.venueId)
    .select()
    .single();

  if (error) {
    console.error('Event update error:', error);
    return errorResponse('name', 'Could not update event');
  }

  return { success: true, data };
}

export async function softDeleteEvent(input: schemas.SoftDeleteEvent) {
  const parsed = schemas.softDeleteEventSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const { user, allowed, error: authError } = await validateUserAndVenue(
    parsed.data.venueId,
    ['admin'],
  );

  if (!allowed) {
    return errorResponse('venueId', authError || 'forbidden');
  }

  const supabase = await getServerSupabaseClient();

  const { data, error } = await supabase
    .from('events')
    .update({ status: 'closed', updated_at: new Date().toISOString() })
    .eq('id', parsed.data.id)
    .eq('venue_id', parsed.data.venueId)
    .select()
    .single();

  if (error) {
    console.error('Event soft delete error:', error);
    return errorResponse('id', 'Could not delete event');
  }

  return { success: true, data };
}

// ===== GUEST TIERS =====

export async function createGuestTier(input: schemas.CreateGuestTier) {
  const parsed = schemas.createGuestTierSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const supabase = await getServerSupabaseClient();

  // Get event to check venue membership
  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('venue_id')
    .eq('id', parsed.data.eventId)
    .single();

  if (eventError || !event) {
    return errorResponse('eventId', 'Event not found');
  }

  // Check membership (admin or organizer for this event)
  const { user, allowed, error: authError } = await validateUserAndVenue(event.venue_id);
  if (!allowed) {
    return errorResponse('eventId', authError || 'forbidden');
  }

  const isAdmin = (await checkVenueMembership(event.venue_id, ['admin'])).allowed;
  const isOrganizer = await isEventOrganizer(parsed.data.eventId, user!.id);

  if (!isAdmin && !isOrganizer) {
    return errorResponse('eventId', 'You cannot create tiers for this event');
  }

  const { data, error } = await supabase
    .from('guest_tiers')
    .insert([
      {
        event_id: parsed.data.eventId,
        name: parsed.data.name,
        description: parsed.data.description || null,
        color: parsed.data.color || null,
        max_count: parsed.data.maxCount || null,
      },
    ])
    .select()
    .single();

  if (error) {
    console.error('Guest tier creation error:', error);
    if (error.code === '23505') {
      return errorResponse('name', 'A tier with this name already exists for this event');
    }
    return errorResponse('name', 'Could not create guest tier');
  }

  return { success: true, data };
}

export async function updateGuestTier(input: schemas.UpdateGuestTier) {
  const parsed = schemas.updateGuestTierSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const supabase = await getServerSupabaseClient();

  const { data: tier, error: tierError } = await supabase
    .from('guest_tiers')
    .select('event_id')
    .eq('id', parsed.data.id)
    .single();

  if (tierError || !tier) {
    return errorResponse('id', 'Tier not found');
  }

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('venue_id')
    .eq('id', tier.event_id)
    .single();

  if (eventError || !event) {
    return errorResponse('eventId', 'Event not found');
  }

  const { user, allowed, error: authError } = await validateUserAndVenue(event.venue_id);
  if (!allowed) {
    return errorResponse('eventId', authError || 'forbidden');
  }

  const isAdmin = (await checkVenueMembership(event.venue_id, ['admin'])).allowed;
  const isOrganizer = await isEventOrganizer(tier.event_id, user!.id);

  if (!isAdmin && !isOrganizer) {
    return errorResponse('id', 'You cannot update tiers for this event');
  }

  const updateData: any = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
  if (parsed.data.color !== undefined) updateData.color = parsed.data.color;
  if (parsed.data.maxCount !== undefined) updateData.max_count = parsed.data.maxCount;
  updateData.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('guest_tiers')
    .update(updateData)
    .eq('id', parsed.data.id)
    .select()
    .single();

  if (error) {
    console.error('Guest tier update error:', error);
    if (error.code === '23505') {
      return errorResponse('name', 'A tier with this name already exists for this event');
    }
    return errorResponse('name', 'Could not update guest tier');
  }

  return { success: true, data };
}

export async function deleteGuestTier(input: schemas.DeleteGuestTier) {
  const parsed = schemas.deleteGuestTierSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const supabase = await getServerSupabaseClient();

  const { data: tier, error: tierError } = await supabase
    .from('guest_tiers')
    .select('event_id')
    .eq('id', parsed.data.id)
    .single();

  if (tierError || !tier) {
    return errorResponse('id', 'Tier not found');
  }

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('venue_id')
    .eq('id', tier.event_id)
    .single();

  if (eventError || !event) {
    return errorResponse('eventId', 'Event not found');
  }

  const { user, allowed, error: authError } = await validateUserAndVenue(event.venue_id);
  if (!allowed) {
    return errorResponse('eventId', authError || 'forbidden');
  }

  const isAdmin = (await checkVenueMembership(event.venue_id, ['admin'])).allowed;
  const isOrganizer = await isEventOrganizer(tier.event_id, user!.id);

  if (!isAdmin && !isOrganizer) {
    return errorResponse('id', 'You cannot delete tiers for this event');
  }

  // Check if tier has guests
  const { data: guests } = await supabase
    .from('guests')
    .select('id', { count: 'exact' })
    .eq('tier_id', parsed.data.id)
    .neq('status', 'removed');

  if (guests && guests.length > 0) {
    return errorResponse('id', 'Cannot delete a tier that has guests');
  }

  const { error } = await supabase
    .from('guest_tiers')
    .delete()
    .eq('id', parsed.data.id);

  if (error) {
    console.error('Guest tier delete error:', error);
    return errorResponse('id', 'Could not delete guest tier');
  }

  return { success: true };
}

// ===== EVENT ORGANIZERS =====

export async function assignEventOrganizer(input: schemas.AssignOrganizer) {
  const parsed = schemas.assignOrganizerSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const supabase = await getServerSupabaseClient();

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('venue_id')
    .eq('id', parsed.data.eventId)
    .single();

  if (eventError || !event) {
    return errorResponse('eventId', 'Event not found');
  }

  const { allowed, error: authError } = await validateUserAndVenue(
    event.venue_id,
    ['admin'],
  );

  if (!allowed) {
    return errorResponse('eventId', authError || 'forbidden');
  }

  // Verify user exists
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id')
    .eq('id', parsed.data.userId)
    .single();

  if (userError || !user) {
    return errorResponse('userId', 'User not found');
  }

  // Check if already organizer
  const { data: existing } = await supabase
    .from('event_organizers')
    .select('id')
    .eq('event_id', parsed.data.eventId)
    .eq('user_id', parsed.data.userId)
    .single();

  if (existing) {
    return errorResponse('userId', 'User is already an organizer for this event');
  }

  const { data, error } = await supabase
    .from('event_organizers')
    .insert([
      {
        event_id: parsed.data.eventId,
        user_id: parsed.data.userId,
      },
    ])
    .select()
    .single();

  if (error) {
    console.error('Organizer assignment error:', error);
    return errorResponse('userId', 'Could not assign organizer');
  }

  return { success: true, data };
}

export async function inviteEventOrganizer(input: schemas.InviteOrganizer) {
  const parsed = schemas.inviteOrganizerSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const supabase = await getServerSupabaseClient();

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('venue_id')
    .eq('id', parsed.data.eventId)
    .single();

  if (eventError || !event) {
    return errorResponse('eventId', 'Event not found');
  }

  const { allowed, error: authError } = await validateUserAndVenue(
    event.venue_id,
    ['admin'],
  );

  if (!allowed) {
    return errorResponse('eventId', authError || 'forbidden');
  }

  // Check if user exists with this email
  const { data: user } = await supabase
    .from('users')
    .select('id')
    .eq('email', parsed.data.email)
    .single();

  if (user) {
    // User exists, assign directly
    return assignEventOrganizer({
      eventId: parsed.data.eventId,
      userId: user.id,
    });
  }

  // TODO (phase 2): Send invite email to user
  // For now, just log and return success
  console.info(`[MVP] Would send organizer invite to ${parsed.data.email} for event ${parsed.data.eventId}`);

  return {
    success: true,
    message: `Organizer invite has been sent to ${parsed.data.email}`,
  };
}

export async function removeEventOrganizer(input: schemas.RemoveOrganizer) {
  const parsed = schemas.removeOrganizerSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const supabase = await getServerSupabaseClient();

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('venue_id')
    .eq('id', parsed.data.eventId)
    .single();

  if (eventError || !event) {
    return errorResponse('eventId', 'Event not found');
  }

  const { allowed, error: authError } = await validateUserAndVenue(
    event.venue_id,
    ['admin'],
  );

  if (!allowed) {
    return errorResponse('eventId', authError || 'forbidden');
  }

  const { error } = await supabase
    .from('event_organizers')
    .delete()
    .eq('event_id', parsed.data.eventId)
    .eq('user_id', parsed.data.userId);

  if (error) {
    console.error('Organizer removal error:', error);
    return errorResponse('userId', 'Could not remove organizer');
  }

  return { success: true };
}

// ===== LIST LOCK =====

export async function lockEventList(input: schemas.LockEventList) {
  const parsed = schemas.lockEventListSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const { user, allowed, error: authError } = await validateUserAndVenue(
    parsed.data.venueId,
  );

  if (!allowed) {
    return errorResponse('venueId', authError || 'forbidden');
  }

  const supabase = await getServerSupabaseClient();

  const isAdmin = (await checkVenueMembership(parsed.data.venueId, ['admin'])).allowed;
  const isOrganizer = await isEventOrganizer(parsed.data.id, user!.id);

  if (!isAdmin && !isOrganizer) {
    return errorResponse('id', 'You cannot lock this event list');
  }

  const { data, error } = await supabase
    .from('events')
    .update({
      list_locked: true,
      locked_by: user!.id,
      locked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.id)
    .eq('venue_id', parsed.data.venueId)
    .select()
    .single();

  if (error) {
    console.error('Event list lock error:', error);
    return errorResponse('id', 'Could not lock event list');
  }

  return { success: true, data };
}

export async function unlockEventList(input: schemas.UnlockEventList) {
  const parsed = schemas.unlockEventListSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const { user, allowed, error: authError } = await validateUserAndVenue(
    parsed.data.venueId,
  );

  if (!allowed) {
    return errorResponse('venueId', authError || 'forbidden');
  }

  const supabase = await getServerSupabaseClient();

  const isAdmin = (await checkVenueMembership(parsed.data.venueId, ['admin'])).allowed;
  const isOrganizer = await isEventOrganizer(parsed.data.id, user!.id);

  if (!isAdmin && !isOrganizer) {
    return errorResponse('id', 'You cannot unlock this event list');
  }

  const { data, error } = await supabase
    .from('events')
    .update({
      list_locked: false,
      locked_by: null,
      locked_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.id)
    .eq('venue_id', parsed.data.venueId)
    .select()
    .single();

  if (error) {
    console.error('Event list unlock error:', error);
    return errorResponse('id', 'Could not unlock event list');
  }

  return { success: true, data };
}

// ===== LANDING PAGE =====

export async function setLandingActive(input: schemas.SetLandingActive) {
  const parsed = schemas.setLandingActiveSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const { user, allowed, error: authError } = await validateUserAndVenue(
    parsed.data.venueId,
  );

  if (!allowed) {
    return errorResponse('venueId', authError || 'forbidden');
  }

  const supabase = await getServerSupabaseClient();

  const isAdmin = (await checkVenueMembership(parsed.data.venueId, ['admin'])).allowed;
  const isOrganizer = await isEventOrganizer(parsed.data.id, user!.id);

  if (!isAdmin && !isOrganizer) {
    return errorResponse('id', 'You cannot change landing page status for this event');
  }

  const { data, error } = await supabase
    .from('events')
    .update({
      landing_active: parsed.data.active,
      updated_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.id)
    .eq('venue_id', parsed.data.venueId)
    .select()
    .single();

  if (error) {
    console.error('Landing page status update error:', error);
    return errorResponse('id', 'Could not update landing page status');
  }

  return { success: true, data };
}

// ===== INTERNAL HELPERS =====

async function isEventOrganizer(eventId: string, userId: string): Promise<boolean> {
  const supabase = await getServerSupabaseClient();
  const { data } = await supabase
    .from('event_organizers')
    .select('id')
    .eq('event_id', eventId)
    .eq('user_id', userId)
    .single();

  return !!data;
}
