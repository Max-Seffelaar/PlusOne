import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { inviteUserAction, resendInviteAction } from './invite-actions';
import { createClient } from '@/lib/supabase/server';
import { sendInviteEmail } from './invite-mail';

// Server actions call createClient() (from @/lib/supabase/server), which
// internally calls Next's cookies() — unavailable outside a request context.
// Mock the module so each test can hand back a minimal fake Supabase client
// (also used transitively by getSessionUser in @/lib/auth/context).
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/features/billing/gate', () => ({
  assertVenueBillingActive: vi.fn(async () => null),
}));

vi.mock('./invite-mail', () => ({
  sendInviteEmail: vi.fn(async () => ({ ok: true })),
}));

const USER_ID = '00000000-0000-0000-0000-000000000001';
const VENUE_ID = '11111111-1111-1111-1111-111111111111';

// Mock call history (incl. the default sendInviteEmail resolved value) must
// not leak between tests in this file — otherwise "never called" assertions
// pass or fail based on test order rather than this test's own scenario.
afterEach(() => {
  vi.resetAllMocks();
  (sendInviteEmail as Mock).mockResolvedValue({ ok: true });
});

interface MembershipsChain {
  select: Mock;
  eq: Mock;
  maybeSingle: Mock;
}

function makeClient(opts: {
  insertError?: { code?: string; message: string } | null;
  user?: { id: string; email?: string };
  venueName?: string | null;
}) {
  const callLog: string[] = [];

  const membershipsChain: MembershipsChain = {
    select: vi.fn(() => membershipsChain),
    eq: vi.fn(() => membershipsChain),
    maybeSingle: vi.fn(async () => ({ data: { roles: ['admin'] } })),
  };

  const invitesChain = {
    insert: vi.fn(async () => {
      callLog.push('insert');
      return { error: opts.insertError ?? null };
    }),
  };

  // Mail-infra F0: the team-mail display context (caller's name + venue name).
  const single = (data: unknown) => {
    const chain: MembershipsChain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => ({ data })),
    };
    return chain;
  };
  const venuesChain = single(opts.venueName === null ? null : { name: opts.venueName ?? 'Club Vesper' });
  const profilesChain = single({ full_name: 'Max' });

  const from = vi.fn((table: string) => {
    if (table === 'venue_memberships') return membershipsChain;
    if (table === 'invites') return invitesChain;
    if (table === 'venues') return venuesChain;
    if (table === 'user_profiles') return profilesChain;
    throw new Error(`unexpected table ${table}`);
  });

  return {
    client: {
      auth: { getUser: vi.fn(async () => ({ data: { user: opts.user ?? { id: USER_ID } } })) },
      from,
    },
    callLog,
  };
}

function inviteFormData() {
  const fd = new FormData();
  fd.set('venueId', VENUE_ID);
  fd.set('email', 'newcrew@venue.com');
  fd.append('roles', 'staff');
  return fd;
}

describe('inviteUserAction — insert-then-mail ordering (86ey9ea00 #54)', () => {
  it('inserts the invite row BEFORE provisioning/e-mailing the invitee', async () => {
    const { client, callLog } = makeClient({ insertError: null });
    (createClient as Mock).mockResolvedValue(client);
    (sendInviteEmail as Mock).mockImplementation(async () => {
      callLog.push('mail');
      return { ok: true };
    });

    const result = await inviteUserAction({ ok: false }, inviteFormData());

    expect(result.ok).toBe(true);
    expect(callLog).toEqual(['insert', 'mail']);
  });

  it('never provisions/e-mails when the RLS-verified insert is denied or conflicts (#54 regression)', async () => {
    const { client } = makeClient({ insertError: { code: '23505', message: 'duplicate' } });
    (createClient as Mock).mockResolvedValue(client);

    const result = await inviteUserAction({ ok: false }, inviteFormData());

    expect(result.ok).toBe(false);
    expect(result.error).toContain('already an open invite');
    // The bug this guards against: mailing/provisioning an account BEFORE the
    // insert is known to succeed leaves a live auth account + e-mail behind
    // with no invite row to redeem it once the insert is denied/conflicts.
    expect(sendInviteEmail).not.toHaveBeenCalled();
  });

  it('never provisions/e-mails when a generic insert error occurs', async () => {
    const { client } = makeClient({ insertError: { message: 'db unavailable' } });
    (createClient as Mock).mockResolvedValue(client);

    const result = await inviteUserAction({ ok: false }, inviteFormData());

    expect(result.ok).toBe(false);
    expect(sendInviteEmail).not.toHaveBeenCalled();
  });
});

// Store-review demo account (86ey6bfug): the invites trigger is the real stop,
// but its 42501 would surface as the generic "Couldn't record the invite.",
// which a reviewer reads as a bug. The action refuses first, with named copy.
describe('inviteUserAction / resendInviteAction — demo account', () => {
  const DEMO_ID = 'de300000-0000-7000-8000-00000000a001';
  const DEMO_EMAIL = 'app-review@demo.plus-one.io';
  const DEMO_COPY = 'Invites are turned off for the demo account.';

  it.each([
    ['by id and e-mail', { id: DEMO_ID, email: DEMO_EMAIL }],
    ['by id alone', { id: DEMO_ID, email: 'someone@else.example' }],
    ['by e-mail alone', { id: USER_ID, email: DEMO_EMAIL }],
  ])('refuses the demo account %s with the demo copy, before any read or insert', async (_label, user) => {
    const { client, callLog } = makeClient({ user });
    (createClient as Mock).mockResolvedValue(client);

    const result = await inviteUserAction({ ok: false }, inviteFormData());

    expect(result).toEqual({ ok: false, error: DEMO_COPY });
    expect(callLog).toEqual([]);
    expect(client.from).not.toHaveBeenCalled();
    expect(sendInviteEmail).not.toHaveBeenCalled();
  });

  it('refuses a resend from the demo account with the same copy, touching nothing', async () => {
    const { client } = makeClient({ user: { id: DEMO_ID, email: DEMO_EMAIL } });
    (createClient as Mock).mockResolvedValue(client);
    const fd = new FormData();
    fd.set('inviteId', '22222222-2222-4222-8222-222222222222');

    const result = await resendInviteAction({ ok: false }, fd);

    expect(result).toEqual({ ok: false, error: DEMO_COPY });
    expect(client.from).not.toHaveBeenCalled();
    expect(sendInviteEmail).not.toHaveBeenCalled();
  });

  it('a normal admin still reaches the insert', async () => {
    const { client, callLog } = makeClient({ user: { id: USER_ID, email: 'admin@plusone.test' } });
    (createClient as Mock).mockResolvedValue(client);

    const result = await inviteUserAction({ ok: false }, inviteFormData());

    expect(result.ok).toBe(true);
    expect(callLog).toEqual(['insert']);
  });
});

// Mail-infra F0 (z8uq9m2yvt): the action hands sendInviteEmail the display
// context for the team mail an EXISTING account gets. Whether that mail or the
// magic link goes out is sendInviteEmail's call (invite-mail.test.ts).
describe('inviteUserAction — team mail context', () => {
  it('passes inviter + company for the existing-account team mail', async () => {
    const { client } = makeClient({});
    (createClient as Mock).mockResolvedValue(client);

    const result = await inviteUserAction({ ok: false }, inviteFormData());

    expect(result.ok).toBe(true);
    expect(sendInviteEmail).toHaveBeenCalledWith('newcrew@venue.com', {
      existingAccountMail: {
        template: 'team_join',
        venueId: VENUE_ID,
        inviterName: 'Max',
        companyName: 'Club Vesper',
      },
    });
  });

  it('passes no context when the venue name is unreadable (magic-link fallback stays)', async () => {
    const { client } = makeClient({ venueName: null });
    (createClient as Mock).mockResolvedValue(client);

    await inviteUserAction({ ok: false }, inviteFormData());

    expect(sendInviteEmail).toHaveBeenCalledWith('newcrew@venue.com', { existingAccountMail: undefined });
  });

  it('a failed team mail (notify) never fails the invite itself', async () => {
    const { client } = makeClient({});
    (createClient as Mock).mockResolvedValue(client);
    (sendInviteEmail as Mock).mockResolvedValue({ ok: false, reason: 'notify' });

    const result = await inviteUserAction({ ok: false }, inviteFormData());

    expect(result.ok).toBe(true);
  });
});
