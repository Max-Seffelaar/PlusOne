// @vitest-environment jsdom
/**
 * Platform > Venues visibility (P-05, z8uq9m0tnx).
 *
 * Mirrors platform-tab-visibility.test.tsx (P-04): a non-platform-admin who
 * reaches this screen (bookmarked/guessed `/app/platform/venues`) must see
 * the flat "not available" state and must NOT fire the windowed venue read —
 * RLS is the real boundary, but a doomed read is still noise, and this gate
 * can regress silently (nothing else fails if it's removed).
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { t } from '@/lib/i18n';

const H = vi.hoisted(() => ({
  isPlatformAdmin: false,
  venuesCalls: 0,
  countCalls: 0,
}));

vi.mock('../context', () => ({
  useNav: () => ({ push: vi.fn(), back: vi.fn(), canGoBack: false }),
  usePo: () => ({ switchToVenue: vi.fn() }),
}));
vi.mock('@/features/po/hooks', () => ({
  usePoIsPlatformAdmin: () => H.isPlatformAdmin,
  usePoPlatformVenues: () => {
    H.venuesCalls += 1;
    return { data: [], isLoading: false, isError: false };
  },
  usePoPlatformVenuesCount: () => {
    H.countCalls += 1;
    return { data: 0 };
  },
}));

const { PlatformVenues } = await import('./platform-venues');

afterEach(() => {
  cleanup();
  H.isPlatformAdmin = false;
  H.venuesCalls = 0;
  H.countCalls = 0;
});

describe('Platform > Venues visibility (z8uq9m0tnx)', () => {
  it('shows "not available" and fires no read for a non-platform-admin', () => {
    render(<PlatformVenues />);
    expect(screen.getByText(t.platform.notAvailable)).toBeDefined();
    expect(H.venuesCalls).toBe(0);
    expect(H.countCalls).toBe(0);
  });

  it('renders the console and fires the windowed read for a platform admin', () => {
    H.isPlatformAdmin = true;
    render(<PlatformVenues />);
    expect(screen.queryByText(t.platform.notAvailable)).toBeNull();
    expect(screen.getByText(t.platform.venuesSubtitle)).toBeDefined();
    expect(H.venuesCalls).toBeGreaterThan(0);
  });
});
