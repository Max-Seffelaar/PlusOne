/**
 * Platform test mails (z8uq9m49k1): every template the Platform tab offers
 * renders with made-up data, says "[Test]" in the subject, carries the
 * mail_log idempotency key, and holds no one-time link (no sign-in, no
 * unsubscribe, no status page). The client-safe picker list matches exactly
 * what the server can render.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { MAIL_TYPE_GROUPS } from '@/lib/mail-type-groups';
import { buildTestMail, isTestMailType, TEST_MAIL_GROUPS, TEST_MAIL_TYPES } from './test-mails';

const LOG = '01a12200-0000-7000-8000-0000000000a1';
const ALL = Object.values(MAIL_TYPE_GROUPS).flat();

describe('test mail types', () => {
  it('the Platform picker offers exactly what the server renders', () => {
    expect(Object.fromEntries(Object.entries(TEST_MAIL_GROUPS).map(([k, v]) => [k, [...v]]))).toEqual(
      Object.fromEntries(Object.entries(MAIL_TYPE_GROUPS).map(([k, v]) => [k, [...v]])),
    );
    expect([...TEST_MAIL_TYPES].sort()).toEqual([...ALL].sort());
  });

  it('refuses anything else', () => {
    expect(isTestMailType('auth_invite')).toBe(false);
    expect(isTestMailType('platform_digest')).toBe(false);
    expect(isTestMailType('<script>')).toBe(false);
  });
});

describe('buildTestMail', () => {
  it.each(ALL)('%s renders, marked as a test, with no one-time link', (type) => {
    const m = buildTestMail(type, 'max@plus-one.io', 'https://app.plus-one.io/', LOG);
    expect(m.to).toBe('max@plus-one.io');
    expect(m.type).toBe(type);
    expect(m.idempotencyKey).toBe(`mail_log/${LOG}`);
    expect(m.subject.startsWith('[Test] ')).toBe(true);
    expect(m.subject.length).toBeGreaterThan('[Test] '.length);
    expect(m.text.length).toBeGreaterThan(20);
    for (const body of [m.html, m.text]) {
      expect(body).not.toMatch(/\/auth\/confirm|token_hash=|\/u\/[A-Za-z0-9_-]{20}|\/s\/[A-Za-z0-9_-]{20}|\/n\/[A-Za-z0-9_-]{20}/);
    }
  });

  it('guest mails come from the event name via PlusOne, replies to support', () => {
    const m = buildTestMail('guest_on_list', 'max@plus-one.io', 'https://app.plus-one.io', LOG);
    expect(m.from).toMatch(/^".+" <noreply@plus-one\.io>$/);
    expect(m.replyTo).toBe('support@plus-one.io');
  });
});
