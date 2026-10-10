-- Gastcommunicatie F, PR 6a (z8uq9m2vpy): company contact for guest mail.
--
-- Every guest mail is sent as "{event_name} via PlusOne" <noreply+…@plus-one.io>
-- with reply-to = the company's contact address, and the footer names that
-- address ("Questions? Mail {company} at {contact_email}"). Expand-only:
--
--   venues.contact_email           where guests reach the company. Nullable:
--                                  existing companies have none yet. Without
--                                  one, guest mail for that company WAITS in
--                                  the queue (guest_mails_claim skips it) and
--                                  the app asks for it; see the PR for why
--                                  this is not enforced as NOT NULL or in a
--                                  publish action (there is none).
--   venues.contact_channels        optional: phone, instagram, facebook,
--                                  snapchat, tiktok. Shown on the guest status
--                                  page. (website already exists as a column.)
--   venues.guest_confirmation_default  the default of the "Send confirmation"
--                                  box when a guest is added (default on).
--   events.house_rules             optional, shown in "You're on the list".
--
-- Grant matrix: venues and events keep their table-level SELECT/UPDATE for
-- authenticated (RLS: members read, admins update the company; event editors
-- update the event), which covers the new columns. Stated explicitly below so
-- the intent is in this file, not only in an older one.

alter table public.venues
  add column contact_email text
    constraint venues_contact_email_check
    check (contact_email is null or (
      char_length(contact_email) between 3 and 254
      and contact_email ~ '^[^@\s<>",;:]+@[^@\s<>",;:]+\.[^@\s<>",;:]+$'
    )),
  add column contact_channels jsonb not null default '{}'::jsonb
    constraint venues_contact_channels_check
    check (
      jsonb_typeof(contact_channels) = 'object'
      and contact_channels - array['phone', 'instagram', 'facebook', 'snapchat', 'tiktok'] = '{}'::jsonb
      and pg_column_size(contact_channels) <= 2048
    ),
  add column guest_confirmation_default boolean not null default true;

comment on column public.venues.contact_email is
  'Where guests reach the company: reply-to and footer of every guest mail '
  '(20261013180100). Guest mail waits while it is null.';
comment on column public.venues.contact_channels is
  'Optional guest-facing channels {phone, instagram, facebook, snapchat, '
  'tiktok}, each a short string (20261013180100).';
comment on column public.venues.guest_confirmation_default is
  'Default of the "Send confirmation" box when a guest is added (20261013180100).';

-- Each channel value is a string (per-value length is validated in the app;
-- the 2 KB cap above bounds the whole object).
alter table public.venues
  add constraint venues_contact_channels_values_check
  check (not jsonb_path_exists(contact_channels, '$.* ? (@.type() != "string")'));

alter table public.events
  add column house_rules text
    constraint events_house_rules_len
    check (house_rules is null or char_length(house_rules) between 1 and 500);

comment on column public.events.house_rules is
  'Optional house rules shown to guests in "You''re on the list" (20261013180100).';

-- ---------------------------------------------------------------------------
-- Grant matrix (explicit; the table-level grants already cover these)
-- ---------------------------------------------------------------------------

grant select (contact_email, contact_channels, guest_confirmation_default)
  on public.venues to authenticated;
grant update (contact_email, contact_channels, guest_confirmation_default)
  on public.venues to authenticated;
grant select (house_rules) on public.events to authenticated;
grant update (house_rules) on public.events to authenticated;
grant insert (house_rules) on public.events to authenticated;
