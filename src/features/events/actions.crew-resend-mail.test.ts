/**
 * resendCrewInvite hands sendInviteEmail the crew-reminder context (Mail-infra
 * F0, z8uq9m2yvt): template team_resend / kind event, the caller's name and the
 * venue name, read through the user-scoped client. Authorization (admin of the
 * venue, target is crew there) is unchanged and runs first.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({
  from: vi.fn(),
  sendInviteEmail: vi.fn(),
  capReached: false,
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from: H.from }) }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: vi.fn() }));
vi.mock('@/features/auth/invite-mail', () => ({
  sendInviteEmail: H.sendInviteEmail,
  alreadyRegistered: () => false,
}));
vi.mock('@/features/mail/limits', () => ({ inviteMailCapReached: async () => H.capReached }));
vi.mock('@/lib/auth/context', () => ({
  getAuthContext: async () => ({ user: { id: '44444444-4444-4444-8444-444444444444', email: 'admin@plusone.test' } }),
  getMyProfile: async () => ({ full_name: 'Max' }),
}));

const { resendCrewInvite } = await import('./actions');

const VENUE_ID = '11111111-1111-4111-8111-111111111111';
const CREW_ID = '55555555-5555-4555-8555-555555555555';

function chain(result: unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'limit']) c[m] = vi.fn(() => c);
  c.maybeSingle = vi.fn(async () => result);
  return c;
}

function tables(opts: { roles?: string[]; venueName?: string | null }) {
  H.from.mockImplementation((table: string) => {
    switch (table) {
      case 'venue_memberships':
        return chain({ data: { roles: opts.roles ?? ['admin'] } });
      case 'event_organizers':
        return chain({ data: { user_id: CREW_ID } });
      case 'user_profiles':
        return chain({ data: { email: 'crew@example.test' } });
      case 'venues':
        return chain({ data: opts.venueName === null ? null : { name: opts.venueName ?? 'Club Vesper' } });
      default:
        throw new Error(`unexpected table ${table}`);
    }
  });
}

beforeEach(() => {
  H.from.mockReset();
  H.sendInviteEmail.mockReset().mockResolvedValue({ ok: true });
  H.capReached = false;
});

describe('resendCrewInvite — team mail context', () => {
  it('passes the crew-reminder context for a confirmed account', async () => {
    tables({});
    expect(await resendCrewInvite({ venueId: VENUE_ID, userId: CREW_ID })).toEqual({ ok: true });
    expect(H.sendInviteEmail).toHaveBeenCalledWith('crew@example.test', {
      existingAccountMail: {
        template: 'team_resend',
        kind: 'event',
        venueId: VENUE_ID,
        inviterName: 'Max',
        companyName: 'Club Vesper',
      },
      mailCapVenueId: VENUE_ID,
    });
  });

  it('a non-admin never reaches the mail', async () => {
    tables({ roles: ['staff'] });
    expect(await resendCrewInvite({ venueId: VENUE_ID, userId: CREW_ID })).toMatchObject({ ok: false });
    expect(H.sendInviteEmail).not.toHaveBeenCalled();
  });

  it('no readable venue name = no context (magic-link fallback)', async () => {
    tables({ venueName: null });
    await resendCrewInvite({ venueId: VENUE_ID, userId: CREW_ID });
    expect(H.sendInviteEmail).toHaveBeenCalledWith('crew@example.test', {
      existingAccountMail: undefined,
      mailCapVenueId: VENUE_ID,
    });
  });

  it('a failed mail surfaces on resend (the mail is the whole point)', async () => {
    tables({});
    H.sendInviteEmail.mockResolvedValue({ ok: false, reason: 'notify' });
    expect(await resendCrewInvite({ venueId: VENUE_ID, userId: CREW_ID })).toMatchObject({ ok: false, code: 'invite' });
  });
});

describe('resendCrewInvite — invitation-mail cap', () => {
  it('refuses with the cap copy and sends nothing', async () => {
    tables({});
    H.capReached = true;
    expect(await resendCrewInvite({ venueId: VENUE_ID, userId: CREW_ID })).toEqual({
      ok: false,
      code: 'mail_cap',
      message: "You've hit today's limit for inviting team members and crew. Need more today? Mail support@plus-one.io.",
    });
    expect(H.sendInviteEmail).not.toHaveBeenCalled();
  });
});
