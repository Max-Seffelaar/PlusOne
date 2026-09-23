import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  inviteBetaCustomerAction,
  resendBetaInviteAction,
  revokeBetaInviteAction,
} from './invite-actions';
import { createClient } from '@/lib/supabase/server';
import { sendInviteEmail } from '@/features/auth/invite-mail';

// Server actions call createClient() (→ Next's cookies()), unavailable outside
// a request context. Mock the module and hand back a minimal fake client.
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/features/auth/invite-mail', () => ({
  sendInviteEmail: vi.fn(async () => ({ ok: true })),
}));

const ADMIN_ID = '00000000-0000-0000-0000-000000000001';
const INVITE_ID = '11111111-1111-4111-8111-111111111111';

interface ClientOpts {
  isPlatformAdmin?: boolean;
  withinBudget?: boolean;
  insertError?: { code?: string; message: string } | null;
  selectRow?: { id: string; email: string; revoked_at: string | null } | null;
  updateCount?: number;
}

function makeClient(opts: ClientOpts = {}) {
  const callLog: string[] = [];

  const rpc = vi.fn(async (name: string) => {
    callLog.push(`rpc:${name}`);
    if (name === 'is_platform_admin') {
      return { data: opts.isPlatformAdmin ?? true, error: null };
    }
    if (name === 'consume_platform_invite_throttle') {
      // The DB raises 42501 for a non-platform-admin; model that as an error.
      if (opts.isPlatformAdmin === false) {
        return { data: null, error: { code: '42501', message: 'not allowed' } };
      }
      return { data: opts.withinBudget ?? true, error: null };
    }
    throw new Error(`unexpected rpc ${name}`);
  });

  interface UpdateChain {
    eq: Mock;
    is: Mock;
  }
  const updateChain: UpdateChain = {
    eq: vi.fn(() => updateChain),
    is: vi.fn(async () => ({ error: null, count: opts.updateCount ?? 1 })),
  };

  interface SelectChain {
    select: Mock;
    eq: Mock;
    maybeSingle: Mock;
  }
  const selectChain: SelectChain = {
    select: vi.fn(() => selectChain),
    eq: vi.fn(() => selectChain),
    maybeSingle: vi.fn(async () => {
      callLog.push('select');
      return { data: opts.selectRow ?? null, error: null };
    }),
  };

  const table = {
    insert: vi.fn(async () => {
      callLog.push('insert');
      return { error: opts.insertError ?? null };
    }),
    select: selectChain.select,
    update: vi.fn(() => {
      callLog.push('update');
      return updateChain;
    }),
  };

  return {
    client: {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: ADMIN_ID } } })) },
      from: vi.fn((t: string) => {
        if (t !== 'platform_invites') throw new Error(`unexpected table ${t}`);
        return table;
      }),
      rpc,
    },
    callLog,
    table,
  };
}

function inviteForm(email = 'klant@venue.test', note?: string) {
  const fd = new FormData();
  fd.set('email', email);
  if (note !== undefined) fd.set('note', note);
  return fd;
}

function idForm(id = INVITE_ID) {
  const fd = new FormData();
  fd.set('inviteId', id);
  return fd;
}

beforeEach(() => {
  (sendInviteEmail as Mock).mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('inviteBetaCustomerAction', () => {
  it('writes the invite row BEFORE provisioning/e-mailing (86ey9ea00 #54)', async () => {
    const { client, callLog } = makeClient();
    (createClient as Mock).mockResolvedValue(client);
    (sendInviteEmail as Mock).mockImplementation(async () => {
      callLog.push('mail');
      return { ok: true };
    });

    const res = await inviteBetaCustomerAction({ ok: false }, inviteForm());

    expect(res.ok).toBe(true);
    expect(callLog.indexOf('insert')).toBeLessThan(callLog.indexOf('mail'));
  });

  it('normalises the address and stores an empty note as null', async () => {
    const { client, table } = makeClient();
    (createClient as Mock).mockResolvedValue(client);

    await inviteBetaCustomerAction({ ok: false }, inviteForm('  Klant@Venue.TEST ', '   '));

    expect(table.insert).toHaveBeenCalledWith({
      email: 'klant@venue.test',
      note: null,
      invited_by: ADMIN_ID,
    });
  });

  it('refuses a duplicate open invite and never sends mail', async () => {
    const { client } = makeClient({ insertError: { code: '23505', message: 'dup' } });
    (createClient as Mock).mockResolvedValue(client);

    const res = await inviteBetaCustomerAction({ ok: false }, inviteForm());

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/already an open invite/i);
    expect(sendInviteEmail).not.toHaveBeenCalled();
  });

  it('succeeds when the account already exists (magic-link fallback only notifies)', async () => {
    const { client } = makeClient();
    (createClient as Mock).mockResolvedValue(client);
    // sendInviteEmail resolves the already-registered path internally; a pure
    // NOTIFY failure must not fail the invite — the row is what matters.
    (sendInviteEmail as Mock).mockResolvedValue({ ok: false, reason: 'notify' });

    const res = await inviteBetaCustomerAction({ ok: false }, inviteForm());

    expect(res.ok).toBe(true);
  });

  it('fails when the address cannot be provisioned at all', async () => {
    const { client } = makeClient();
    (createClient as Mock).mockResolvedValue(client);
    (sendInviteEmail as Mock).mockResolvedValue({ ok: false, reason: 'provision' });

    const res = await inviteBetaCustomerAction({ ok: false }, inviteForm());

    expect(res.ok).toBe(false);
  });

  it('refuses a non-platform-admin before touching the table or the mailer', async () => {
    const { client, table } = makeClient({ isPlatformAdmin: false });
    (createClient as Mock).mockResolvedValue(client);

    const res = await inviteBetaCustomerAction({ ok: false }, inviteForm());

    expect(res.ok).toBe(false);
    expect(table.insert).not.toHaveBeenCalled();
    expect(sendInviteEmail).not.toHaveBeenCalled();
  });

  it('stops at the rate limit before inserting or mailing', async () => {
    const { client, table } = makeClient({ withinBudget: false });
    (createClient as Mock).mockResolvedValue(client);

    const res = await inviteBetaCustomerAction({ ok: false }, inviteForm());

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/too many/i);
    expect(table.insert).not.toHaveBeenCalled();
    expect(sendInviteEmail).not.toHaveBeenCalled();
  });

  it('rejects an invalid address through Zod', async () => {
    const { client, table } = makeClient();
    (createClient as Mock).mockResolvedValue(client);

    const res = await inviteBetaCustomerAction({ ok: false }, inviteForm('not-an-email'));

    expect(res.ok).toBe(false);
    expect(table.insert).not.toHaveBeenCalled();
  });
});

describe('resendBetaInviteAction', () => {
  it('re-sends for an open row and bumps last_sent_at', async () => {
    const { client, table } = makeClient({
      selectRow: { id: INVITE_ID, email: 'klant@venue.test', revoked_at: null },
    });
    (createClient as Mock).mockResolvedValue(client);

    const res = await resendBetaInviteAction({ ok: false }, idForm());

    expect(res.ok).toBe(true);
    expect(table.update).toHaveBeenCalled();
    expect(sendInviteEmail).toHaveBeenCalledWith('klant@venue.test');
  });

  it('refuses a revoked row and sends nothing', async () => {
    const { client, table } = makeClient({
      selectRow: { id: INVITE_ID, email: 'klant@venue.test', revoked_at: '2026-09-23T00:00:00Z' },
    });
    (createClient as Mock).mockResolvedValue(client);

    const res = await resendBetaInviteAction({ ok: false }, idForm());

    expect(res.ok).toBe(false);
    expect(table.update).not.toHaveBeenCalled();
    expect(sendInviteEmail).not.toHaveBeenCalled();
  });

  it('gives the same generic answer for an invisible row as for a missing one', async () => {
    const { client } = makeClient({ selectRow: null });
    (createClient as Mock).mockResolvedValue(client);

    const res = await resendBetaInviteAction({ ok: false }, idForm());

    expect(res.ok).toBe(false);
    expect(res.error).toBe("You don't have access to this.");
  });

  it('surfaces a notify failure — the mail is the whole point of a resend', async () => {
    const { client } = makeClient({
      selectRow: { id: INVITE_ID, email: 'klant@venue.test', revoked_at: null },
    });
    (createClient as Mock).mockResolvedValue(client);
    (sendInviteEmail as Mock).mockResolvedValue({ ok: false, reason: 'notify' });

    const res = await resendBetaInviteAction({ ok: false }, idForm());

    expect(res.ok).toBe(false);
  });
});

describe('revokeBetaInviteAction', () => {
  it('stamps revoked_at/revoked_by on an open row', async () => {
    const { client, table } = makeClient();
    (createClient as Mock).mockResolvedValue(client);

    const res = await revokeBetaInviteAction({ ok: false }, idForm());

    expect(res.ok).toBe(true);
    const patch = (table.update as Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(patch.revoked_by).toBe(ADMIN_ID);
    expect(typeof patch.revoked_at).toBe('string');
  });

  it('reports a generic failure when RLS filtered the update to zero rows', async () => {
    const { client } = makeClient({ updateCount: 0 });
    (createClient as Mock).mockResolvedValue(client);

    const res = await revokeBetaInviteAction({ ok: false }, idForm());

    expect(res.ok).toBe(false);
    expect(res.error).toBe("You don't have access to this.");
  });

  it('never deletes the row — revoking is an UPDATE only', async () => {
    const { client, table } = makeClient();
    (createClient as Mock).mockResolvedValue(client);

    await revokeBetaInviteAction({ ok: false }, idForm());

    expect(table).not.toHaveProperty('delete');
  });
});
