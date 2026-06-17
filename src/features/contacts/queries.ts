import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { ContactRole } from './schemas';

// Read paths for the address book. Everything goes through the USER-scoped
// client, so RLS (20260615130000) decides what is visible:
//   * getContacts / getPermanentContacts / getContactCounts read the contacts
//     table directly → only managers (admin/organizer) + finance see rows;
//   * getReuseContacts goes through search_contacts_for_reuse → a PII-free
//     projection any venue member (incl. staff/doorhost) may use to reuse a
//     contact when adding a guest ("herbruik in één tik").

/** Full address-book row (managers). */
export interface ContactRow {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  birthdate: string | null;
  preferredRole: ContactRole | null;
  isPermanent: boolean;
  /** "X× op een lijst" — distinct events this contact has appeared on. */
  eventCount: number;
}

/** PII-free reuse row (any venue member). */
export interface ReuseContactRow {
  id: string;
  fullName: string;
  preferredRole: ContactRole | null;
  eventCount: number;
}

/** Distinct-events-per-contact map, scoped by RLS to what the caller can see. */
async function eventCountByContact(
  supabase: Awaited<ReturnType<typeof createClient>>,
  contactIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (contactIds.length === 0) return counts;

  const { data } = await supabase
    .from('guests')
    .select('contact_id, event_id')
    .in('contact_id', contactIds)
    .neq('status', 'removed');

  const seen = new Map<string, Set<string>>();
  for (const g of data ?? []) {
    if (!g.contact_id) continue;
    const set = seen.get(g.contact_id) ?? new Set<string>();
    set.add(g.event_id);
    seen.set(g.contact_id, set);
  }
  for (const [cid, set] of seen) counts.set(cid, set.size);
  return counts;
}

/** The venue address book (managers). Optional name search. */
export async function getContacts(venueId: string, search?: string): Promise<ContactRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from('contacts')
    .select('id, full_name, email, phone, birthdate, preferred_role, is_permanent')
    .eq('venue_id', venueId)
    .is('anonymized_at', null)
    .order('full_name');
  const term = search?.trim();
  if (term) query = query.ilike('full_name', `%${term}%`);

  const { data } = await query;
  const rows = data ?? [];
  const counts = await eventCountByContact(
    supabase,
    rows.map((c) => c.id)
  );

  return rows.map((c) => ({
    id: c.id,
    fullName: c.full_name,
    email: c.email,
    phone: c.phone,
    birthdate: c.birthdate,
    preferredRole: c.preferred_role,
    isPermanent: c.is_permanent,
    eventCount: counts.get(c.id) ?? 0,
  }));
}

/** Permanent contacts only (the "Vaste" screen). */
export async function getPermanentContacts(venueId: string): Promise<ContactRow[]> {
  return (await getContacts(venueId)).filter((c) => c.isPermanent);
}

/** Address-book totals for the settings hub counts. */
export async function getContactCounts(
  venueId: string
): Promise<{ total: number; permanent: number }> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('contacts')
    .select('is_permanent')
    .eq('venue_id', venueId)
    .is('anonymized_at', null);

  const rows = data ?? [];
  return {
    total: rows.length,
    permanent: rows.filter((c) => c.is_permanent).length,
  };
}

/** PII-free reuse list for any venue member (staff/doorhost included). */
export async function getReuseContacts(
  venueId: string,
  search?: string
): Promise<ReuseContactRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc('search_contacts_for_reuse', {
    p_venue_id: venueId,
    p_query: search?.trim() || undefined,
  });

  return (data ?? []).map((c) => ({
    id: c.id,
    fullName: c.full_name,
    preferredRole: c.preferred_role,
    eventCount: c.event_count,
  }));
}
