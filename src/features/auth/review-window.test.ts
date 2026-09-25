import { describe, expect, it } from 'vitest';
import {
  MAX_WINDOW_DAYS,
  MIN_CODE_CHARS,
  configuredReviewCode,
  demoSessionMustEnd,
  isDemoReviewUser,
  isExactDemoAccount,
  reviewWindowOpen,
} from './review-window';

const NOW = Date.parse('2026-09-24T12:00:00Z');
const DAY = 86_400_000;
const CODE = 'abcd-efgh-ijkm-nopq-rstu-vwxy-z234'; // 28 letters/digits
const FUTURE = new Date(NOW + 7 * DAY).toISOString();
const open = { REVIEW_LOGIN_CODE: CODE, REVIEW_LOGIN_EXPIRES_AT: FUTURE };

describe('reviewWindowOpen — expiry must be a real, near-future ISO timestamp', () => {
  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['garbage', 'next friday'],
    ['a Date.parse-able non-ISO string', 'Oct 1 2026'],
    ['a bare date (no time, no zone)', '2026-10-01'],
    ['no zone', '2026-10-01T12:00:00'],
    ['in the past', '2026-09-24T11:59:59Z'],
    ['exactly now', '2026-09-24T12:00:00Z'],
    ['more than 60 days out', new Date(NOW + (MAX_WINDOW_DAYS * DAY + 1000)).toISOString()],
  ])('%s → closed', (_label, value) => {
    expect(reviewWindowOpen({ REVIEW_LOGIN_EXPIRES_AT: value }, NOW)).toBe(false);
  });

  it.each([
    ['UTC, a week out', FUTURE],
    ['offset form', '2026-10-01T23:00:00+02:00'],
    ['exactly 60 days out', new Date(NOW + MAX_WINDOW_DAYS * DAY).toISOString()],
  ])('%s → open', (_label, value) => {
    expect(reviewWindowOpen({ REVIEW_LOGIN_EXPIRES_AT: value }, NOW)).toBe(true);
  });
});

describe('configuredReviewCode — any weak or missing piece reads as "route does not exist"', () => {
  it.each([
    ['code unset', { REVIEW_LOGIN_EXPIRES_AT: FUTURE }],
    ['code empty', { ...open, REVIEW_LOGIN_CODE: '' }],
    ['code whitespace', { ...open, REVIEW_LOGIN_CODE: '   \t\n ' }],
    ['code too short', { ...open, REVIEW_LOGIN_CODE: 'a'.repeat(MIN_CODE_CHARS - 1) }],
    ['dashes do not count toward strength', { ...open, REVIEW_LOGIN_CODE: `${'-'.repeat(20)}${'a'.repeat(MIN_CODE_CHARS - 1)}` }],
    ['expiry missing', { REVIEW_LOGIN_CODE: CODE }],
    ['expiry past', { ...open, REVIEW_LOGIN_EXPIRES_AT: '2026-09-01T00:00:00Z' }],
  ])('%s → null', (_label, env) => {
    expect(configuredReviewCode(env, NOW)).toBeNull();
  });

  it('a strong code inside an open window is returned trimmed', () => {
    expect(configuredReviewCode({ ...open, REVIEW_LOGIN_CODE: `  ${CODE}\n` }, NOW)).toBe(CODE);
  });

  it('closes by itself once the expiry passes, with no env change', () => {
    expect(configuredReviewCode(open, NOW)).toBe(CODE);
    expect(configuredReviewCode(open, NOW + 8 * DAY)).toBeNull();
  });
});

describe('demo-account identity: id OR e-mail catches it, the login needs both', () => {
  const ID = 'de300000-0000-7000-8000-00000000a001';
  const EMAIL = 'app-review@demo.plus-one.io';

  it('isDemoReviewUser: the id alone, or the e-mail alone (any case), is enough', () => {
    expect(isDemoReviewUser({ id: ID, email: EMAIL })).toBe(true);
    expect(isDemoReviewUser({ id: ID, email: 'rebound@attacker.example' })).toBe(true);
    expect(isDemoReviewUser({ id: 'other', email: 'App-Review@Demo.Plus-One.io' })).toBe(true);
  });

  it('isDemoReviewUser: never anyone else', () => {
    for (const user of [{ id: 'u', email: 'max@venue.com' }, { id: 'u', email: `${EMAIL}.evil.com` }, null, undefined, {}]) {
      expect(isDemoReviewUser(user)).toBe(false);
    }
  });

  it('isExactDemoAccount: requires both the id and the e-mail', () => {
    expect(isExactDemoAccount({ id: ID, email: EMAIL })).toBe(true);
    expect(isExactDemoAccount({ id: ID, email: 'rebound@attacker.example' })).toBe(false);
    expect(isExactDemoAccount({ id: 'other', email: EMAIL })).toBe(false);
  });
});

describe('demoSessionMustEnd — only the demo account, only when the window is closed', () => {
  const DEMO = { id: 'de300000-0000-7000-8000-00000000a001', email: 'app-review@demo.plus-one.io' };

  it('demo account + closed window → end (also when its e-mail was rebound)', () => {
    expect(demoSessionMustEnd(DEMO, {}, NOW)).toBe(true);
    expect(demoSessionMustEnd({ ...DEMO, email: 'rebound@attacker.example' }, { REVIEW_LOGIN_CODE: CODE }, NOW)).toBe(true);
  });

  it('demo account + open window → keep', () => {
    expect(demoSessionMustEnd(DEMO, open, NOW)).toBe(false);
  });

  it('never touches anyone else, window open or closed', () => {
    for (const user of [{ id: 'u', email: 'max@venue.com' }, null, undefined]) {
      expect(demoSessionMustEnd(user, {}, NOW)).toBe(false);
      expect(demoSessionMustEnd(user, open, NOW)).toBe(false);
    }
  });
});
