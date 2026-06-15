-- Fase 6 (feedback) — Geplande lijst-lock op tijd (#23, uitbreiding).
--
-- Naast de handmatige list_locked kan een event nu een auto_lock_at-tijdstip
-- hebben: vanaf dat moment is de lijst "vergrendeld" voor staff (geen
-- toevoegingen/mutaties meer), terwijl admin, organisator en doorhost — net als
-- bij de handmatige lock — wél blijven schrijven. Afgedwongen in de database via
-- can_write_guests (fase 2), zodat ook directe API-calls na het tijdstip worden
-- geweigerd, niet alleen de UI.
--
-- Semantiek: effectief vergrendeld = list_locked OR (auto_lock_at <= now()).
-- De twee zijn onafhankelijk; handmatig ontgrendelen wist auto_lock_at niet.
-- Heropenen na een verlopen auto-lock = auto_lock_at op NULL of in de toekomst
-- zetten (de app biedt dat aan).

alter table public.events
  add column auto_lock_at timestamptz;

comment on column public.events.auto_lock_at is
  'Optioneel geplande lock: zodra now() >= auto_lock_at telt de lijst als vergrendeld voor staff (zelfde effect als list_locked); admin/organisator/doorhost blijven schrijven. #23.';

-- Replace can_write_guests (fase 2) so the lock gate also honours auto_lock_at.
-- Body is identical to the fase-2 version except the lock branch.
create or replace function public.can_write_guests(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when e.id is null then false
    when public.has_venue_role(e.venue_id, '{admin}'::public.venue_role[]) then true
    when e.status = 'closed' then false
    when public.is_event_organizer(e.id) then true
    when public.has_venue_role(e.venue_id, '{doorhost}'::public.venue_role[]) then true
    -- handmatige lock OF de geplande auto-lock is verstreken
    when e.list_locked or (e.auto_lock_at is not null and now() >= e.auto_lock_at) then false
    else public.has_venue_role(e.venue_id, '{staff}'::public.venue_role[])
  end
  from public.events e
  where e.id = p_event_id;
$$;
