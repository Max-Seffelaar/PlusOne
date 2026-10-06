import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const captureException = vi.fn();
const addBreadcrumb = vi.fn();
vi.mock('./sentry-client', () => ({ captureException, addBreadcrumb }));

const { captureUnexpectedError } = await import('./capture');

const ctx = { source: 'mutation' as const };
let online = true;

beforeEach(() => {
  online = true;
  vi.stubGlobal('navigator', {
    get onLine() {
      return online;
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('expected user errors → breadcrumb, not exception', () => {
  it.each([
    ['42501', { ok: false, code: '42501', message: "You don't have rights for this." }],
    ['exists', { ok: false, code: 'exists', message: 'This email already has an account.' }],
    ['invalid_input', { ok: false, code: 'invalid_input', message: 'Nope.' }],
    ['already_handled', { ok: false, code: 'already_handled', message: 'Done.' }],
    ['billing_trial_expired', { ok: false, code: 'billing_trial_expired', message: 'Trial over.' }],
    ['quota 45001', { ok: false, code: '45001', message: 'Quota full.' }],
  ])('MutationError %s', (_n, err) => {
    captureUnexpectedError(err, ctx);
    expect(captureException).not.toHaveBeenCalled();
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'expected-error', data: expect.objectContaining({ code: err.code }) }),
    );
  });

  it.each([
    "You don't have rights for this.",
    'Your trial has ended. Set up your payment to make changes.',
    'The subscription is canceled. Reactivate billing to make changes.',
    'Start it with https://',
    'This request has already been handled.',
  ])('rethrown Error carrying known copy: %s', (msg) => {
    captureUnexpectedError(new Error(msg), ctx);
    expect(captureException).not.toHaveBeenCalled();
    expect(addBreadcrumb).toHaveBeenCalledOnce();
  });

  it('an unknown MutationError code is still reported (may be a bug)', () => {
    captureUnexpectedError({ ok: false, code: 'unknown', message: 'Something went wrong. Try again.' }, ctx);
    expect(captureException).toHaveBeenCalledOnce();
    expect(addBreadcrumb).not.toHaveBeenCalled();
  });

  it.each(['23502', '23514'])('MutationError %s (schema drift) is still reported', (code) => {
    captureUnexpectedError({ ok: false, code, message: 'Some details are missing or invalid.' }, ctx);
    expect(captureException).toHaveBeenCalledOnce();
  });

  it('the rethrown "Some details are missing or invalid." copy is still reported', () => {
    captureUnexpectedError(new Error('Some details are missing or invalid.'), ctx);
    expect(captureException).toHaveBeenCalledOnce();
  });

  it('an unrelated Error is still reported', () => {
    captureUnexpectedError(new Error('boom'), ctx);
    expect(captureException).toHaveBeenCalledOnce();
  });
});

describe('PostgrestError objects', () => {
  const pg = { code: 'PGRST116', details: 'secret row values', hint: 'Check the filter', message: 'JSON object requested' };

  it('becomes a readable Error with db_code tag and hint extra, without details', () => {
    captureUnexpectedError(pg, { source: 'query', key: 'guests' });
    const [err, opts] = captureException.mock.calls[0];
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('JSON object requested');
    expect(err.name).toBe('PostgrestError');
    expect(opts.tags).toEqual({ capture_source: 'query', db_code: 'PGRST116' });
    expect(opts.extra).toEqual({ key: 'guests', hint: 'Check the filter' });
    expect(JSON.stringify(captureException.mock.calls)).not.toContain('secret row values');
  });

  it('a raw 42501 PostgrestError stays reportable (RLS denial = possible policy bug)', () => {
    captureUnexpectedError({ ...pg, code: '42501' }, ctx);
    expect(captureException).toHaveBeenCalledOnce();
  });
});

describe('network noise', () => {
  it.each([
    new TypeError('Load failed'),
    new TypeError('Failed to fetch'),
    Object.assign(new Error('fetch failed'), { name: 'AuthRetryableFetchError' }),
  ])('dropped while offline: %s', (err) => {
    online = false;
    captureUnexpectedError(err, ctx);
    expect(captureException).not.toHaveBeenCalled();
    expect(addBreadcrumb).not.toHaveBeenCalled();
  });

  it('reported with tag network=true while online', () => {
    captureUnexpectedError(new TypeError('Failed to fetch'), ctx);
    const [, opts] = captureException.mock.calls[0];
    expect(opts.tags).toEqual({ capture_source: 'mutation', network: 'true' });
  });

  it('online TypeError with bug text is reported without the network tag', () => {
    captureUnexpectedError(new TypeError("Cannot read properties of undefined (reading 'id')"), ctx);
    expect(captureException).toHaveBeenCalledOnce();
    expect(captureException.mock.calls[0][1].tags).toEqual({ capture_source: 'mutation' });
  });

  it('offline TypeError (any text) is dropped', () => {
    online = false;
    captureUnexpectedError(new TypeError('anything'), ctx);
    expect(captureException).not.toHaveBeenCalled();
  });

  it('AuthRetryableFetchError online is tagged too', () => {
    captureUnexpectedError(Object.assign(new Error('x'), { name: 'AuthRetryableFetchError' }), ctx);
    expect(captureException.mock.calls[0][1].tags.network).toBe('true');
  });

  it('AbortError is always dropped', () => {
    captureUnexpectedError(new DOMException('aborted', 'AbortError'), ctx);
    expect(captureException).not.toHaveBeenCalled();
  });
});
