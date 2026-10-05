import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reviewLoginEnabled } from '@/features/auth/review-window';

// The "App review sign-in" link on /login (86ey6bfug): rendered only while the
// review window is open, decided on the server with the route's own predicate,
// and nothing but that boolean ever reaches the page.

const formProps: Array<Record<string, unknown>> = [];

vi.mock('@/features/auth/components/OtpLoginForm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/auth/components/OtpLoginForm')>();
  return {
    ...actual,
    // The real form is a client component (browser Supabase client); this test
    // only cares what the server page hands it and what it renders around it.
    OtpLoginForm: (props: Record<string, unknown>) => {
      formProps.push(props);
      return <div data-testid="otp-form" />;
    },
  };
});

const { default: LoginPage } = await import('./page');

const CODE = 'k7p2-x9qm-4hzt-8wva-3bcd-efgh-jk';
const DAY = 86_400_000;
const inDays = (days: number): string => new Date(Date.now() + days * DAY).toISOString();

async function renderLogin(params: { next?: string; error?: string } = {}): Promise<string> {
  const element = await LoginPage({ searchParams: Promise.resolve(params) });
  return renderToStaticMarkup(element);
}

function linkCount(html: string): number {
  return html.split('href="/auth/review-login"').length - 1;
}

beforeEach(() => {
  formProps.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/login review sign-in link', () => {
  it('renders one same-origin link to /auth/review-login while the window is open', async () => {
    vi.stubEnv('REVIEW_LOGIN_CODE', CODE);
    vi.stubEnv('REVIEW_LOGIN_EXPIRES_AT', inDays(7));
    expect(reviewLoginEnabled()).toBe(true);

    const html = await renderLogin();
    expect(linkCount(html)).toBe(1);
    expect(html).toContain('App review sign-in');
    // Stays inside the webview: no new tab, no external-link plumbing.
    expect(html).not.toContain('target=');
    expect(html).not.toContain('rel=');
    // ≥44px tap target on touch (CLAUDE.md density rule).
    expect(html).toContain('min-h-[44px]');
  });

  it.each<[string, Record<string, string | undefined>]>([
    ['both env vars missing', { REVIEW_LOGIN_CODE: undefined, REVIEW_LOGIN_EXPIRES_AT: undefined }],
    ['both env vars empty strings', { REVIEW_LOGIN_CODE: '', REVIEW_LOGIN_EXPIRES_AT: '' }],
    ['code missing', { REVIEW_LOGIN_CODE: undefined, REVIEW_LOGIN_EXPIRES_AT: inDays(7) }],
    ['code empty string', { REVIEW_LOGIN_CODE: '', REVIEW_LOGIN_EXPIRES_AT: inDays(7) }],
    ['code whitespace only', { REVIEW_LOGIN_CODE: '   ', REVIEW_LOGIN_EXPIRES_AT: inDays(7) }],
    ['code too weak', { REVIEW_LOGIN_CODE: 'abcd-efgh', REVIEW_LOGIN_EXPIRES_AT: inDays(7) }],
    ['expiry missing', { REVIEW_LOGIN_CODE: CODE, REVIEW_LOGIN_EXPIRES_AT: undefined }],
    ['expiry empty string', { REVIEW_LOGIN_CODE: CODE, REVIEW_LOGIN_EXPIRES_AT: '' }],
    ['expired', { REVIEW_LOGIN_CODE: CODE, REVIEW_LOGIN_EXPIRES_AT: inDays(-1) }],
    ['expiry too far out', { REVIEW_LOGIN_CODE: CODE, REVIEW_LOGIN_EXPIRES_AT: inDays(61) }],
    ['expiry without a zone', { REVIEW_LOGIN_CODE: CODE, REVIEW_LOGIN_EXPIRES_AT: inDays(7).replace('Z', '') }],
    ['expiry not ISO', { REVIEW_LOGIN_CODE: CODE, REVIEW_LOGIN_EXPIRES_AT: 'Dec 1 2099' }],
  ])('does not render the link when %s', async (_label, env) => {
    for (const [key, value] of Object.entries(env)) {
      // stubEnv records the original for unstubAllEnvs; then truly unset a missing one.
      vi.stubEnv(key, value ?? '');
      if (value === undefined) delete process.env[key];
    }
    expect(reviewLoginEnabled()).toBe(false);

    const html = await renderLogin();
    expect(linkCount(html)).toBe(0);
    expect(html).not.toContain('review-login');
    expect(html).not.toContain('App review sign-in');
    // The OTP login itself is untouched.
    expect(html).toContain('data-testid="otp-form"');
  });

  it('cannot be forced on by the request: next/error params pointing at the route change nothing', async () => {
    vi.stubEnv('REVIEW_LOGIN_CODE', '');
    vi.stubEnv('REVIEW_LOGIN_EXPIRES_AT', '');

    const html = await renderLogin({ next: '/auth/review-login', error: 'review' });
    expect(linkCount(html)).toBe(0);
    expect(html).not.toContain('App review sign-in');
  });

  it('keeps the href fixed whatever the request carries (no open redirect)', async () => {
    vi.stubEnv('REVIEW_LOGIN_CODE', CODE);
    vi.stubEnv('REVIEW_LOGIN_EXPIRES_AT', inDays(7));

    const html = await renderLogin({ next: 'https://evil.example/', error: 'link' });
    expect(linkCount(html)).toBe(1);
    expect(html).not.toContain('evil.example');
  });

  it('never leaks the code or the expiry into the HTML or the client props', async () => {
    const expiresAt = inDays(7);
    vi.stubEnv('REVIEW_LOGIN_CODE', CODE);
    vi.stubEnv('REVIEW_LOGIN_EXPIRES_AT', expiresAt);

    const html = await renderLogin();
    const props = JSON.stringify(formProps);
    for (const secret of [CODE, CODE.replace(/-/g, ''), expiresAt, expiresAt.slice(0, 10)]) {
      expect(html).not.toContain(secret);
      expect(props).not.toContain(secret);
    }
    // The client form gets exactly what it got before this link existed.
    expect(formProps).toHaveLength(1);
    expect(Object.keys(formProps[0] ?? {}).sort()).toEqual(['errorKind', 'nextPath']);
  });
});
