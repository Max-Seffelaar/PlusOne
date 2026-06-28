import { describe, it, expect } from 'vitest';
import { NoopNotificationProvider, notifications } from './provider';

describe('NoopNotificationProvider (MVP stub)', () => {
  it('reports push as unsupported', () => {
    expect(new NoopNotificationProvider().isSupported()).toBe(false);
  });

  it('resolves requestPermission to "unsupported"', async () => {
    await expect(new NoopNotificationProvider().requestPermission()).resolves.toBe('unsupported');
  });

  it('registers to null — no transport wired yet', async () => {
    await expect(new NoopNotificationProvider().register()).resolves.toBeNull();
  });

  it('unregister is a no-op that resolves', async () => {
    await expect(new NoopNotificationProvider().unregister()).resolves.toBeUndefined();
  });
});

describe('notifications singleton', () => {
  it('is the no-op stub for MVP (swap the construction when a real adapter ships)', () => {
    expect(notifications).toBeInstanceOf(NoopNotificationProvider);
  });
});
