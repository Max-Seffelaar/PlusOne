import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { createDoorQueryClient, getDoorQueryClient } from './query-client';

const WEEK_MS = 1000 * 60 * 60 * 24 * 7;

// The leak (86ey9e8pm / L1): DoorQueryProvider used `useState(() =>
// createDoorQueryClient())`, so every remount of the /app shell built a NEW client
// whose gcTime:WEEK_MS timers pinned the abandoned snapshot for a week. The fix is a
// per-session singleton — these assert the singleton identity + that the offline
// gcTime is preserved (it's still needed, just on ONE live client, not one per mount).
describe('getDoorQueryClient — per-session singleton (86ey9e8pm / L1)', () => {
  it('returns the same client instance across calls (not rebuilt per mount)', () => {
    const a = getDoorQueryClient();
    const b = getDoorQueryClient();
    expect(a).toBe(b);
    expect(a).toBeInstanceOf(QueryClient);
  });

  it('keeps the week-long gcTime the door needs to survive days offline', () => {
    expect(getDoorQueryClient().getDefaultOptions().queries?.gcTime).toBe(WEEK_MS);
  });

  it('leaves the createDoorQueryClient factory building fresh, independent clients', () => {
    // The factory is still exported (tests / a future isolated client); only
    // DoorQueryProvider switched to the singleton accessor.
    expect(createDoorQueryClient()).not.toBe(getDoorQueryClient());
  });
});
