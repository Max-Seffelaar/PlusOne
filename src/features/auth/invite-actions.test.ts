import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { inviteUserAction } from './invite-actions';
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

function makeClient(opts: { insertError?: { code?: string; message: string } | null }) {
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

  const from = vi.fn((table: string) => {
    if (table === 'venue_memberships') return membershipsChain;
    if (table === 'invites') return invitesChain;
    throw new Error(`unexpected table ${table}`);
  });

  return {
    client: {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })) },
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
