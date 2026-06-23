import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

// Event picker for the door: live/open events at venues where the user is a
// doorhost or admin, plus events they organize. RLS scopes what is visible; this
// just narrows to door-relevant events.
export default async function DoorIndexPage(): Promise<JSX.Element> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/door');

  const [{ data: memberships }, { data: organized }] = await Promise.all([
    supabase.from('venue_memberships').select('venue_id, roles').eq('user_id', user.id),
    supabase.from('event_organizers').select('event_id').eq('user_id', user.id),
  ]);

  const doorVenues = new Set(
    (memberships ?? [])
      .filter((m) => m.roles.includes('doorhost') || m.roles.includes('admin'))
      .map((m) => m.venue_id),
  );
  const organizedIds = new Set((organized ?? []).map((o) => o.event_id));

  const { data: events } = await supabase
    .from('events')
    .select('id, name, starts_at, venue_id, status')
    .in('status', ['open', 'live'])
    .order('starts_at');

  const list = (events ?? []).filter((e) => doorVenues.has(e.venue_id) || organizedIds.has(e.id));

  const venueIds = [...new Set(list.map((e) => e.venue_id))];
  const { data: venues } = venueIds.length
    ? await supabase.from('venues').select('id, name').in('id', venueIds)
    : { data: [] };
  const venueName = new Map((venues ?? []).map((v) => [v.id, v.name]));

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col gap-5 p-5">
      <header className="flex flex-col gap-1 pt-4">
        <h1 className="font-display text-[28px] font-extrabold tracking-[-0.02em] text-text">Door</h1>
        <p className="text-sm text-faint">Pick the event you&apos;re working the door for.</p>
      </header>

      <div className="flex flex-col gap-[10px]">
        {list.map((e) => (
          <Link
            key={e.id}
            href={`/door/${e.id}`}
            className="flex items-center gap-[13px] rounded-[16px] border border-line bg-elev p-[15px] transition-[border-color,transform] hover:border-white/[0.24] active:scale-[0.99]"
          >
            <span className="min-w-0 flex-1">
              <span className="block font-display text-[16px] font-bold text-text">{e.name}</span>
              <span className="mt-0.5 block text-[12.5px] text-faint">
                {venueName.get(e.venue_id) ?? ''}
                {e.status === 'live' ? ' · live' : ' · open'}
              </span>
            </span>
            <span className="rounded-full bg-acc px-[14px] py-[8px] font-display text-[13px] font-bold text-on-acc">Open</span>
          </Link>
        ))}
        {list.length === 0 && (
          <div className="rounded-[16px] border border-line bg-elev p-6 text-center text-sm text-faint">
            No open events to work the door.
          </div>
        )}
      </div>
    </main>
  );
}
