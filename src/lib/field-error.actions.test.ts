/**
 * The server actions behind the forms of z8uq9m5m8g name the field a refusal
 * is about: a schema key (never the input), `field` for the first and
 * `fields` for every field when more than one is wrong. Only the parse/refusal
 * paths are exercised; Supabase is a fake that must never be reached for a
 * refused parse.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => ({ user: { id: '00000000-0000-7000-8000-0000000000u1', email: 'me@plusone.test' } }));
const reached = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    reached();
    return {
      auth: { getUser: async () => ({ data: { user: H.user } }), updateUser: vi.fn() },
      from: () => {
        const q: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'maybeSingle']) q[m] = () => q;
        q.maybeSingle = async () => ({ data: { email: 'guest@example.com', status: 'approved' }, error: null });
        return q;
      },
    };
  },
}));
vi.mock('@/lib/auth/context', () => ({
  getSessionUser: async () => H.user,
  getAuthContext: async () => ({ user: H.user }),
  getMyProfile: vi.fn(),
}));
vi.mock('@/lib/auth/memberships', () => ({
  getMyMemberships: async () => [],
  getOrganizerVenues: async () => [],
  getPlatformAdminVenue: async () => null,
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: vi.fn(), get: vi.fn() }) }));
vi.mock('@/features/billing/gate', () => ({ assertVenueBillingActive: vi.fn(async () => null) }));
vi.mock('@/features/mail/guest-queue', () => ({ queueEventMail: vi.fn(), queueGuestMails: vi.fn() }));
vi.mock('@/features/mail/config', async (orig) => ({ ...(await orig<object>()), guestMailActive: () => true }));

const UUID = '00000000-0000-7000-8000-000000000001';

beforeEach(() => reached.mockClear());

describe('field-scoped refusals (z8uq9m5m8g)', () => {
  it('inviteExternalCrew: a bad address names `email`', async () => {
    const { inviteExternalCrew } = await import('@/features/events/actions');
    const res = await inviteExternalCrew({ email: 'not-an-email', eventIds: [UUID] });
    expect(res).toMatchObject({ ok: false, code: 'invalid', field: 'email' });
    expect(JSON.stringify(res)).not.toContain('not-an-email');
    expect(reached).not.toHaveBeenCalled();
  });

  it('createTemplateFromEvent: an empty name names `name`', async () => {
    const { createTemplateFromEvent } = await import('@/features/events/actions');
    expect(await createTemplateFromEvent({ eventId: UUID, name: '' })).toMatchObject({ ok: false, field: 'name' });
  });

  it('createTemplateTier: a VAT above 100 and a negative price mark both fields', async () => {
    const { createTemplateTier } = await import('@/features/events/actions');
    const res = await createTemplateTier({ templateId: UUID, name: 'VIP', doorPriceCents: -1, vatPercent: 120 });
    expect(res).toMatchObject({ ok: false, field: 'doorPriceCents' });
    expect(res.ok === false && res.fields).toEqual({ doorPriceCents: 'Price cannot be negative', vatPercent: 'VAT is too high' });
  });

  it('createTier: VAT without a price names `vatPercent`', async () => {
    const { createTier } = await import('@/features/events/actions');
    expect(await createTier({ eventId: UUID, name: 'Paid', doorPriceCents: null, vatPercent: 9 })).toMatchObject({
      ok: false,
      field: 'vatPercent',
    });
  });

  it('createVenueAction: a short KVK number and a bad billing address mark both', async () => {
    const { createVenueAction } = await import('@/features/venues/actions');
    const res = await createVenueAction({ name: 'Club', venueType: 'club', kvkNumber: '123', financeEmail: 'nope', termsAccepted: true });
    expect(res).toMatchObject({ ok: false, field: 'kvkNumber' });
    expect(res.ok === false && res.fields && Object.keys(res.fields)).toEqual(['kvkNumber', 'financeEmail']);
    expect(reached).not.toHaveBeenCalled();
  });

  it('createInfluencer / createRequestLink: name and maxHeadcount', async () => {
    const { createInfluencer, createRequestLink } = await import('@/features/links/actions');
    expect(await createInfluencer({ venueId: UUID, name: 'A' })).toMatchObject({ ok: false, field: 'name' });
    expect(await createRequestLink({ eventId: UUID, label: 'Insta', slugBase: 'insta', maxHeadcount: 100_001 })).toMatchObject({
      ok: false,
      field: 'maxHeadcount',
      message: 'Use a whole number up to 100,000.',
    });
    // The limits read as copy, never Zod's default "String must contain…".
    expect(await createInfluencer({ venueId: UUID, name: 'Alex', handle: 'h'.repeat(81) })).toMatchObject({
      ok: false,
      field: 'handle',
      message: 'Keep it to 80 characters.',
    });
  });

  it('upsertContact / updateGuest: a bad e-mail names `email`', async () => {
    const { upsertContact } = await import('@/features/contacts/actions');
    const { updateGuest } = await import('@/features/guests/actions');
    expect(await upsertContact({ venueId: UUID, fullName: 'Ann', email: 'nope' })).toMatchObject({ ok: false, field: 'email' });
    expect(await updateGuest({ guestId: UUID, email: 'x'.repeat(400) })).toMatchObject({ ok: false, field: 'email' });
  });

  it('removeGuest: a mailable guest without a note names `note`', async () => {
    const { removeGuest } = await import('@/features/guests/actions');
    expect(await removeGuest({ guestId: UUID })).toMatchObject({ ok: false, field: 'note' });
  });

  it('updateProfileAction / updateEmailAction: lastName, email', async () => {
    const { updateProfileAction, updateEmailAction } = await import('@/features/auth/profile-actions');
    const p = new FormData();
    p.set('firstName', 'Ann');
    p.set('lastName', '');
    p.set('phone', '');
    expect(await updateProfileAction({ ok: false }, p)).toMatchObject({ ok: false, field: 'lastName' });
    const e = new FormData();
    e.set('email', 'me@plusone.test');
    expect(await updateEmailAction({ ok: false }, e)).toMatchObject({ ok: false, field: 'email' });
    e.set('email', 'nope');
    expect(await updateEmailAction({ ok: false }, e)).toMatchObject({ ok: false, field: 'email' });
  });
});
