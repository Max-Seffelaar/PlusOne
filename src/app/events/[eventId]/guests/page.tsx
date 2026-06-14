import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { resolveDefaultTierId } from '@/features/guests/tiers';
import { QuickAddField } from '@/features/guests/components/QuickAddField';
import { BulkPasteDialog } from '@/features/guests/components/BulkPasteDialog';
import { GuestEditForm, type EditableGuest } from '@/features/guests/components/GuestEditForm';
import { QuotaCounter } from '@/features/quotas/components/QuotaCounter';
import { RequestExtraSlots } from '@/features/quotas/components/RequestExtraSlots';
import {
  QuotaRequestsInbox,
  type PendingRequest,
} from '@/features/quotas/components/QuotaRequestsInbox';
import { ListLockBanner } from '@/features/events/components/ListLockBanner';

// Fase 7 vertical slice: the staff/organizer guest-list screen. It fetches
// everything through the USER-scoped client, so RLS decides what is visible
// (staff see only their own guests) and the quota engine enforces every write.
//
// NOTE: this page assumes the auth + app-shell from fases 4–6 (a logged-in
// session via middleware, navigation chrome). Until those land it renders a
// "log in first" notice instead of running headless.

export default async function GuestsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return (
      <main className="mx-auto max-w-md p-6">
        <p className="text-dim">Log eerst in om de gastenlijst te beheren.</p>
      </main>
    );
  }

  const { data: event } = await supabase
    .from('events')
    .select('id, name, venue_id, status, list_locked')
    .eq('id', eventId)
    .maybeSingle();
  if (!event) notFound();

  const [{ data: tierRows }, { data: quota }, { data: guests }, { data: membership }, { data: organizer }] =
    await Promise.all([
      supabase.from('guest_tiers').select('id, name, aliases').eq('event_id', eventId).order('name'),
      supabase.rpc('event_quota_status', { p_event_id: eventId }).maybeSingle(),
      supabase
        .from('guests')
        .select('id, full_name, plus_ones, email, phone, note, note_priority, tier_id, status, source')
        .eq('event_id', eventId)
        .order('full_name'),
      supabase
        .from('venue_memberships')
        .select('roles')
        .eq('venue_id', event.venue_id)
        .eq('user_id', user.id)
        .maybeSingle(),
      supabase
        .from('event_organizers')
        .select('id')
        .eq('event_id', eventId)
        .eq('user_id', user.id)
        .maybeSingle(),
    ]);

  const tiers = (tierRows ?? []).map((t) => ({ id: t.id, name: t.name, aliases: t.aliases ?? [] }));
  const defaultTierId = resolveDefaultTierId(tiers);
  const roles = membership?.roles ?? [];
  const isAdmin = roles.includes('admin');
  const isOrganizer = Boolean(organizer);
  const canWrite =
    isAdmin || isOrganizer || roles.includes('staff') || roles.includes('doorhost');
  const exempt = quota?.exempt ?? false;
  const remaining = quota?.remaining ?? null;
  // Locked + viewer can't write through the lock (#23): staff-only, no door role.
  const staffBlocked =
    event.list_locked && !isAdmin && !isOrganizer && !roles.includes('doorhost');

  // Admin inbox: open quota requests + requester names (two queries to avoid
  // ambiguous-FK embedding; RLS lets the admin read both).
  let pending: PendingRequest[] = [];
  if (isAdmin) {
    const { data: reqs } = await supabase
      .from('quota_requests')
      .select('id, requested_extra, motivation, created_at, user_id')
      .eq('event_id', eventId)
      .eq('status', 'pending')
      .order('created_at');
    const ids = [...new Set((reqs ?? []).map((r) => r.user_id))];
    const { data: profiles } = ids.length
      ? await supabase.from('user_profiles').select('id, full_name').in('id', ids)
      : { data: [] };
    const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
    pending = (reqs ?? []).map((r) => ({
      id: r.id,
      requesterName: nameById.get(r.user_id) ?? 'Onbekend',
      requestedExtra: r.requested_extra,
      motivation: r.motivation,
      createdAt: r.created_at,
    }));
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-bold">{event.name}</h1>
        <p className="text-sm text-dim">Gastenlijst · status {event.status}</p>
      </header>

      <ListLockBanner locked={event.list_locked} youAreBlocked={staffBlocked} />

      <p className="text-faint -mt-2 text-xs">
        <Link href={`/events/${eventId}`} className="hover:text-dim underline">
          ← Naar eventbeheer
        </Link>
      </p>

      {!exempt && quota && (
        <QuotaCounter
          quota={quota.quota}
          consumed={quota.consumed}
          remaining={quota.remaining}
          exempt={quota.exempt}
        />
      )}

      {canWrite && defaultTierId && (
        <section className="flex flex-col gap-5 rounded-card border border-line p-4">
          <QuickAddField
            eventId={eventId}
            tiers={tiers}
            defaultTierId={defaultTierId}
            remaining={remaining}
            exempt={exempt}
          />
          <BulkPasteDialog
            eventId={eventId}
            tiers={tiers}
            defaultTierId={defaultTierId}
            remaining={remaining}
            exempt={exempt}
          />
        </section>
      )}

      {!exempt && <RequestExtraSlots eventId={eventId} />}

      {isAdmin && <QuotaRequestsInbox eventId={eventId} requests={pending} />}

      <section className="flex flex-col gap-2">
        <p className="label">Gasten ({(guests ?? []).length})</p>
        {(guests ?? []).map((g) => {
          const tier = tiers.find((t) => t.id === g.tier_id);
          const editable: EditableGuest = {
            id: g.id,
            full_name: g.full_name,
            plus_ones: g.plus_ones,
            email: g.email,
            phone: g.phone,
            note: g.note,
            note_priority: g.note_priority,
            tier_id: g.tier_id,
            status: g.status,
          };
          return (
            <details key={g.id} className="rounded-card border border-line bg-elev">
              <summary className="flex cursor-pointer items-center justify-between gap-2 p-3">
                <span className={g.status === 'removed' ? 'text-faint line-through' : ''}>
                  {g.full_name}
                  {g.plus_ones > 0 && <span className="text-acc"> +{g.plus_ones}</span>}
                </span>
                <span className="text-xs text-faint">{tier?.name ?? '—'}</span>
              </summary>
              <div className="p-3 pt-0">
                {canWrite ? (
                  <GuestEditForm guest={editable} tiers={tiers.map((t) => ({ id: t.id, name: t.name }))} />
                ) : (
                  <p className="text-sm text-dim">Alleen-lezen.</p>
                )}
              </div>
            </details>
          );
        })}
      </section>
    </main>
  );
}
