import { describe, expect, it } from 'vitest';
import { DEFAULT_STALE_RESUME_MS, shouldShowStaleResumeOverlay } from './staleResume';

const T0 = 1_000_000_000_000;
const THRESHOLD = 5 * 60_000;

describe('shouldShowStaleResumeOverlay', () => {
  it('never fires on the first-ever observation, even with no sync yet', () => {
    expect(
      shouldShowStaleResumeOverlay({ prev: null, next: 'visible', lastSyncAt: null, now: T0, thresholdMs: THRESHOLD }),
    ).toBe(false);
  });

  it('never fires on a visible→visible no-op', () => {
    expect(
      shouldShowStaleResumeOverlay({
        prev: 'visible',
        next: 'visible',
        lastSyncAt: T0 - 10 * 60_000,
        now: T0,
        thresholdMs: THRESHOLD,
      }),
    ).toBe(false);
  });

  it('never fires when going to hidden', () => {
    expect(
      shouldShowStaleResumeOverlay({ prev: 'visible', next: 'hidden', lastSyncAt: null, now: T0, thresholdMs: THRESHOLD }),
    ).toBe(false);
  });

  it('fires on a genuine hidden→visible resume when the last sync is older than the threshold', () => {
    expect(
      shouldShowStaleResumeOverlay({
        prev: 'hidden',
        next: 'visible',
        lastSyncAt: T0 - (THRESHOLD + 1),
        now: T0,
        thresholdMs: THRESHOLD,
      }),
    ).toBe(true);
  });

  it('does not fire on resume when the last sync is within the threshold', () => {
    expect(
      shouldShowStaleResumeOverlay({
        prev: 'hidden',
        next: 'visible',
        lastSyncAt: T0 - (THRESHOLD - 1_000),
        now: T0,
        thresholdMs: THRESHOLD,
      }),
    ).toBe(false);
  });

  it('treats the threshold boundary as stale (>=)', () => {
    expect(
      shouldShowStaleResumeOverlay({ prev: 'hidden', next: 'visible', lastSyncAt: T0 - THRESHOLD, now: T0, thresholdMs: THRESHOLD }),
    ).toBe(true);
  });

  it('treats "never synced" as always stale on resume', () => {
    expect(
      shouldShowStaleResumeOverlay({ prev: 'hidden', next: 'visible', lastSyncAt: null, now: T0, thresholdMs: THRESHOLD }),
    ).toBe(true);
  });

  it('is configurable — a shorter threshold trips sooner', () => {
    expect(
      shouldShowStaleResumeOverlay({ prev: 'hidden', next: 'visible', lastSyncAt: T0 - 2_000, now: T0, thresholdMs: 1_000 }),
    ).toBe(true);
    expect(
      shouldShowStaleResumeOverlay({ prev: 'hidden', next: 'visible', lastSyncAt: T0 - 2_000, now: T0, thresholdMs: 5_000 }),
    ).toBe(false);
  });

  it('DEFAULT_STALE_RESUME_MS is 5 minutes (spec default)', () => {
    expect(DEFAULT_STALE_RESUME_MS).toBe(5 * 60_000);
  });
});
