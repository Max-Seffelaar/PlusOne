import { test, expect } from '@playwright/test';

/**
 * Real-stack regression guard for 86ey9ea00 #55 (PR #243 security review):
 * `/api/health` moved off the service-role client onto an anon-key client
 * (`src/lib/supabase/health-client.ts`) probing `request_links`. A mocked
 * unit test (route.test.ts) cannot catch a real Postgres `42501 permission
 * denied` — the mock always returns whatever the test tells it to, ACL
 * grants and RLS policies never enter into it. This spec hits the actual
 * running dev server against the actual local Supabase stack (started by
 * `supabase start` in CI, already running locally per "One local stack" —
 * see CLAUDE.md), so a wrong table choice fails here for real, the same way
 * `venues` (no anon grant at all) and later `events` (anon grant revoked by
 * the P0 hotfix, `20260707170000_p0_security_hotfixes.sql`) would have.
 */
test('GET /api/health round-trips the real database and returns ok', async ({ request }) => {
  const response = await request.get('/api/health');

  expect(response.status()).toBe(200);
  await expect(response.json()).resolves.toEqual({ status: 'ok' });
});
