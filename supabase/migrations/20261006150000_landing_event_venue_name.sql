-- Legal v0.3 B2 (z8uq9m2hm4): the public request page names the venue.
--
-- Decision 11 (legal-v03-plan-claude-code.md): the Guest Terms acceptance line
-- and the privacy note on /e/[slug] must name the venue, replacing "the
-- organizer of this event". get_landing_event is the ONLY anon path to event
-- data (C3), and venues.name was not in its result, so it gains exactly one
-- column: venue_name. No other column, no PII — the venue's trade name is what
-- the venue itself prints on its door and flyers.
--
-- Body = 20260707170000 (C4 throttle first, same open-link predicate) plus the
-- join to venues. The return type changes, so drop + recreate; the grant matrix
-- is restated in full (revoke first, then grant), identical to before:
-- anon / authenticated / service_role may execute, nobody else.

drop function if exists public.get_landing_event(text, text);

create function public.get_landing_event(p_slug text, p_ip_hash text)
returns table (
  event_name text,
  starts_at  timestamptz,
  via_label  text,
  -- Remaining approvable headcount on a CAPPED link (0 = full); NULL when the
  -- link has no max — then nothing about capacity is disclosed (#28/#43).
  spots_left integer,
  venue_name text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Same budget as record_link_pageview (a venue's door WiFi NATs many phones
  -- behind one IP). Burns first, so probing costs budget even on a closed slug.
  if not public.consume_public_throttle('slug:' || p_ip_hash, 15, 60) then
    return;
  end if;

  return query
  select
    e.name,
    e.starts_at,
    case when rl.is_default then null
         else coalesce(i.name, rl.label) end,
    case when rl.max_headcount is null then null
         else greatest(rl.max_headcount - public.request_link_consumption(rl.id), 0) end,
    v.name
  from public.request_links rl
  join public.events e on e.id = rl.event_id
  join public.venues v on v.id = e.venue_id
  left join public.influencers i on i.id = rl.influencer_id
  where rl.slug = p_slug
    and public.request_link_open(rl);
end;
$$;

revoke execute on function public.get_landing_event(text, text)
from public, anon, authenticated, service_role;
grant execute on function public.get_landing_event(text, text)
to anon, authenticated, service_role;
