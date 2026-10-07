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

const capReached = vi.hoisted(() => ({ value: false }));
vi.mock('@/features/mail/limits', () => ({
  inviteMailCapReached: async () => capReached.value,
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
  capReached.value = false;
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

  const invitesChain: {
    insert: Mock;
    select: Mock;
    eq: Mock;
    maybeSingle: Mock;
    update: Mock;
  } = {
    insert: vi.fn(async () => {
      callLog.push('insert');
      return { error: opts.insertError ?? null };
    }),
    // resendInviteAction: read the pending invite, then bump expires_at.
    select: vi.fn(() => invitesChain),
    eq: vi.fn(() => invitesChain),
    maybeSingle: vi.fn(async () => ({
      data: { id: 'inv-1', email: 'crew@venue.com', venue_id: VENUE_ID, accepted_at: null },
    })),
    update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null, count: 1 })) })),
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
      mailCapVenueId: VENUE_ID,
    });
  });

  it('passes no context when the venue name is unreadable (magic-link fallback stays)', async () => {
    const { client } = makeClient({ venueName: null });
    (createClient as Mock).mockResolvedValue(client);

    await inviteUserAction({ ok: false }, inviteFormData());

    expect(sendInviteEmail).toHaveBeenCalledWith('newcrew@venue.com', {
      existingAccountMail: undefined,
      mailCapVenueId: VENUE_ID,
    });
  });

  it('a failed team mail (notify) never fails the invite itself', async () => {
    const { client } = makeClient({});
    (createClient as Mock).mockResolvedValue(client);
    (sendInviteEmail as Mock).mockResolvedValue({ ok: false, reason: 'notify' });

    const result = await inviteUserAction({ ok: false }, inviteFormData());

    expect(result.ok).toBe(true);
  });
});

// Review of PR #413: a throttled team mail (log_mail_attempt PM429) reaches the
// actions as sendInviteEmail's 'notify'. An initial invite still succeeds (the
// invite row grants access); a resend shows its existing error.
describe('team mail refused by the send limits', () => {
  it('resendInviteAction shows its usual error and passes the resend context', async () => {
    const { client } = makeClient({});
    (createClient as Mock).mockResolvedValue(client);
    (sendInviteEmail as Mock).mockResolvedValue({ ok: false, reason: 'notify' });
    const fd = new FormData();
    fd.set('inviteId', '22222222-2222-4222-8222-222222222222');

    const result = await resendInviteAction({ ok: false }, fd);

    expect(result).toEqual({ ok: false, error: "Couldn't send the invite e-mail. Try again." });
    expect(sendInviteEmail).toHaveBeenCalledWith('crew@venue.com', {
      existingAccountMail: {
        template: 'team_resend',
        kind: 'join',
        venueId: VENUE_ID,
        inviterName: 'Max',
        companyName: 'Club Vesper',
      },
      mailCapVenueId: VENUE_ID,
    });
  });
});

// A second mail to the same address within a minute (z8uq9m2yvp): the resend
// says so instead of the generic error; the send-time cap keeps the cap copy.
describe('resend within the 60-second window', () => {
  it('resendInviteAction shows "Already sent. Give it a minute before you resend."', async () => {
    const { client } = makeClient({});
    (createClient as Mock).mockResolvedValue(client);
    (sendInviteEmail as Mock).mockResolvedValue({ ok: false, reason: 'recent' });
    const fd = new FormData();
    fd.set('inviteId', '22222222-2222-4222-8222-222222222222');
    expect(await resendInviteAction({ ok: false }, fd)).toEqual({
      ok: false,
      error: 'Already sent. Give it a minute before you resend.',
    });
  });

  it('the cap hit at send time keeps the cap copy', async () => {
    const { client } = makeClient({});
    (createClient as Mock).mockResolvedValue(client);
    (sendInviteEmail as Mock).mockResolvedValue({ ok: false, reason: 'cap' });
    const fd = new FormData();
    fd.set('inviteId', '22222222-2222-4222-8222-222222222222');
    expect(await resendInviteAction({ ok: false }, fd)).toEqual({
      ok: false,
      error: "You've hit today's limit for inviting team members and crew. Need more today? Mail support@plus-one.io.",
    });
  });
});

// Daily invitation-mail cap per company (decision Max 2026-10-07): refused
// BEFORE anything is created, with the cap copy.
describe('invitation-mail cap reached', () => {
  const CAP_COPY = "You've hit today's limit for inviting team members and crew. Need more today? Mail support@plus-one.io.";

  it('inviteUserAction refuses before the invite insert and before any mail', async () => {
    capReached.value = true;
    const { client, callLog } = makeClient({});
    (createClient as Mock).mockResolvedValue(client);

    const result = await inviteUserAction({ ok: false }, inviteFormData());

    expect(result).toEqual({ ok: false, error: CAP_COPY });
    expect(callLog).toEqual([]);
    expect(sendInviteEmail).not.toHaveBeenCalled();
  });

  it('resendInviteAction refuses before bumping expires_at', async () => {
    capReached.value = true;
    const { client } = makeClient({});
    (createClient as Mock).mockResolvedValue(client);
    const fd = new FormData();
    fd.set('inviteId', '22222222-2222-4222-8222-222222222222');

    const result = await resendInviteAction({ ok: false }, fd);

    expect(result).toEqual({ ok: false, error: CAP_COPY });
    expect(sendInviteEmail).not.toHaveBeenCalled();
    const invites = (client.from as Mock).mock.results
      .map((r) => r.value)
      .find((v) => v && 'update' in v);
    expect(invites?.update).not.toHaveBeenCalled();
  });
});
