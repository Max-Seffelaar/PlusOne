/**
 * Platform-invite adapter (P-04, z8uq9m0tnw).
 *
 * The one place that turns a `platform_invite_overview()` row into the shape
 * the Platform screen renders. It carries a real risk the generator hides:
 * every `RETURNS TABLE` column is typed non-null, while `user_id`,
 * `confirmed_at`, `last_sign_in_at`, `note`, `revoked_at`, `revoked_by` and
 * `invited_by_name` are nullable at runtime (PR #325, "For P-04"). A screen
 * that trusted the types would render "null" or crash on `.length`; these tests
 * pin the normalisation instead.
 */
import { describe, expect, it } from 'vitest';
import { toPlatformInvite, toPlatformFunnel, PLATFORM_INVITE_STAGES } from './adapters';
import type { PlatformInviteRow } from './queries';

function row(over: Partial<PlatformInviteRow> = {}): PlatformInviteRow {
  return {
    id: '018f3a2e-0000-7000-8000-000000000001',
    email: 'venue@example.com',
    note: null,
    created_at: '2026-09-01T10:00:00.000Z',
    last_sent_at: '2026-09-01T10:00:00.000Z',
    revoked_at: null,
    invited_by_name: null,
    user_id: null,
    confirmed_at: null,
    last_sign_in_at: null,
    venue_count: 0,
    event_count: 0,
    stage: 'invited',
    ...over,
  };
}

describe('toPlatformInvite', () => {
  it('maps a fresh invite with every nullable column actually null', () => {
    const inv = toPlatformInvite(row());
    expect(inv.stage).toBe('invited');
    expect(inv.stageIndex).toBe(0);
    expect(inv.revoked).toBe(false);
    expect(inv.signedIn).toBe(false);
    expect(inv.note).toBeNull();
    expect(inv.invitedByName).toBeNull();
    expect(inv.venueCount).toBe(0);
    expect(inv.eventCount).toBe(0);
  });

  it('reports signedIn from confirmed_at, not from the stage string', () => {
    expect(toPlatformInvite(row({ confirmed_at: '2026-09-02T09:00:00.000Z' })).signedIn).toBe(true);
    expect(toPlatformInvite(row({ stage: 'signed_in' })).signedIn).toBe(false);
  });

  it('gives each progression stage its funnel index', () => {
    PLATFORM_INVITE_STAGES.forEach((stage, i) => {
      expect(toPlatformInvite(row({ stage })).stageIndex).toBe(i);
    });
  });

  it('treats revoked as terminal: no index, revoked flag set', () => {
    const inv = toPlatformInvite(row({ stage: 'revoked', revoked_at: '2026-09-03T12:00:00.000Z' }));
    expect(inv.stageIndex).toBeNull();
    expect(inv.revoked).toBe(true);
    expect(inv.revokedAt).toBe('2026-09-03T12:00:00.000Z');
  });

  it('flags a revoked row even when the RPC still reports a progression stage', () => {
    // The stage function computes progress; `revoked_at` is the operator's
    // decision. The row-level stamp wins, otherwise a revoked invite would
    // still render Resend/Stop actions.
    const inv = toPlatformInvite(row({ stage: 'company_created', revoked_at: '2026-09-04T12:00:00.000Z' }));
    expect(inv.revoked).toBe(true);
  });

  it('falls back to `invited` for an unknown stage string instead of throwing', () => {
    expect(toPlatformInvite(row({ stage: 'something_new' })).stage).toBe('invited');
  });

  it('falls back to created_at when last_sent_at is missing', () => {
    const inv = toPlatformInvite(row({ last_sent_at: null as unknown as string }));
    expect(inv.lastSentAt).toBe('2026-09-01T10:00:00.000Z');
  });

  it('keeps the note as plain text, untouched', () => {
    const inv = toPlatformInvite(row({ note: '<b>ADE</b> & co' }));
    expect(inv.note).toBe('<b>ADE</b> & co');
  });
});

describe('toPlatformFunnel', () => {
  it('zero-fills every stage the RPC did not return', () => {
    expect(toPlatformFunnel([{ stage: 'invited', invite_count: 3 }])).toEqual({
      invited: 3,
      signed_in: 0,
      company_created: 0,
      first_event: 0,
      revoked: 0,
    });
  });

  it('sums rows per stage and buckets an unknown stage under `invited`', () => {
    const out = toPlatformFunnel([
      { stage: 'invited', invite_count: 2 },
      { stage: 'mystery', invite_count: 1 },
      { stage: 'first_event', invite_count: 4 },
      { stage: 'revoked', invite_count: 1 },
    ]);
    expect(out.invited).toBe(3);
    expect(out.first_event).toBe(4);
    expect(out.revoked).toBe(1);
  });

  it('returns all-zero for an empty funnel', () => {
    const out = toPlatformFunnel([]);
    expect(Object.values(out).every((n) => n === 0)).toBe(true);
  });
});
