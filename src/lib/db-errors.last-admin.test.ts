/**
 * P0LA1 (refuse_last_admin_removal, 20261012120000): mapped to the same copy
 * the venues actions' early check returns, and treated as an expected user
 * error (a Sentry breadcrumb, not an exception) in both shapes it reaches the
 * client: the MutationError, and the Error po/mutations.ts rethrows with only
 * the message left.
 */
import { describe, it, expect } from 'vitest';
import { asExpectedMutationError, LAST_ADMIN, LAST_ADMIN_MESSAGE, mapMutationError } from './db-errors';

describe('last-admin SQLSTATE', () => {
  it('maps P0LA1 to the last-admin copy, not the raw DB message', () => {
    expect(
      mapMutationError({ code: 'P0LA1', message: 'a company always keeps at least one admin' }),
    ).toEqual({ ok: false, code: LAST_ADMIN, message: LAST_ADMIN_MESSAGE });
    expect(LAST_ADMIN_MESSAGE).toBe('This is the last admin. Make someone else an admin first.');
  });

  it('is an expected error as a MutationError', () => {
    expect(asExpectedMutationError(mapMutationError({ code: 'P0LA1' }))).toEqual({
      code: 'P0LA1',
      message: LAST_ADMIN_MESSAGE,
    });
  });

  it('is an expected error as a bare Error carrying only the copy', () => {
    expect(asExpectedMutationError(new Error(LAST_ADMIN_MESSAGE))).not.toBeNull();
  });

  it('a raw PostgrestError with P0LA1 (no ok:false) is still reported', () => {
    expect(asExpectedMutationError({ code: 'P0LA1', message: 'x' })).toBeNull();
  });
});
