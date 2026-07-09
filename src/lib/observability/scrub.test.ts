import { describe, expect, it } from 'vitest';
import type { Breadcrumb, ErrorEvent } from '@sentry/nextjs';
import { scrubBreadcrumb, scrubEvent, scrubText } from './scrub';

// Minimal EventHint stand-in — scrubEvent ignores it (the param is `_hint`).
const noHint = {} as never;

describe('scrubText', () => {
  it('redacts an email address', () => {
    expect(scrubText('duplicate for jan@example.nl already exists')).toBe(
      'duplicate for [email] already exists',
    );
  });

  it('redacts a phone number', () => {
    expect(scrubText('bel +31 6 12345678 terug')).toBe('bel [phone] terug');
  });

  it('redacts a Postgres Key (col)=(value) detail entirely', () => {
    expect(scrubText('Key (email)=(jan@x.nl) already exists.')).toBe(
      'Key ([redacted])=([redacted]) already exists.',
    );
  });

  it('leaves quota messages with short numbers untouched', () => {
    expect(scrubText('Quota vol: 2 van 2 gebruikt')).toBe('Quota vol: 2 van 2 gebruikt');
  });
});

describe('scrubEvent', () => {
  it('redacts an email inside an exception value', () => {
    const event: ErrorEvent = {
      exception: { values: [{ type: 'Error', value: 'insert failed for guest@venue.nl' }] },
    } as ErrorEvent;
    const out = scrubEvent(event, noHint);
    expect(out.exception?.values?.[0]?.value).toBe('insert failed for [email]');
  });

  it('deletes the request section and reduces user to id only', () => {
    const event = {
      request: { cookies: 'session=secret', headers: { authorization: 'Bearer x' } },
      user: { id: 'uuid-123', email: 'jan@x.nl', ip_address: '1.2.3.4' },
    } as unknown as ErrorEvent;
    const out = scrubEvent(event, noHint);
    expect(out.request).toBeUndefined();
    expect(out.user).toEqual({ id: 'uuid-123' });
  });

  it('scrubs breadcrumb messages', () => {
    const event = {
      breadcrumbs: [{ message: 'looked up jan@x.nl' }],
    } as ErrorEvent;
    const out = scrubEvent(event, noHint);
    expect(out.breadcrumbs?.[0]?.message).toBe('looked up [email]');
  });
});

describe('scrubBreadcrumb', () => {
  it('drops console breadcrumbs (app logs may carry guest objects)', () => {
    const crumb: Breadcrumb = { category: 'console', message: 'guest {name: Jan}' };
    expect(scrubBreadcrumb(crumb)).toBeNull();
  });

  it('keeps non-console breadcrumbs but scrubs their message', () => {
    const crumb: Breadcrumb = { category: 'navigation', message: 'to jan@x.nl' };
    const out = scrubBreadcrumb(crumb);
    expect(out).not.toBeNull();
    expect(out?.message).toBe('to [email]');
  });
});
