// @vitest-environment jsdom
/**
 * PushSettingsRow (Fase 17 N5): the Profile toggle has the same role gate as the
 * ask card, and a turn-on that could not register yet says so.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
const p = vi.hoisted(() => ({ perm: 'granted' as string }));
vi.mock('@/features/notifications/provider', () => ({
  getNotificationProvider: () => ({ isSupported: () => true, checkPermission: async () => p.perm }),
}));
const pc = vi.hoisted(() => ({
  on: false,
  enable: vi.fn(async () => ({ perm: 'granted', registered: false })),
  disable: vi.fn(async () => undefined),
}));
vi.mock('@/features/notifications/push-client', () => ({
  isPushOnHere: () => pc.on,
  enablePush: pc.enable,
  disablePush: pc.disable,
}));

import { PushSettingsRow } from './push-settings-card';
import { t } from '@/lib/i18n';

beforeEach(() => {
  p.perm = 'granted';
  pc.on = false;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function mount(canReceive: boolean) {
  await act(async () => {
    render(<PushSettingsRow canReceive={canReceive} />);
  });
}

describe('PushSettingsRow', () => {
  it('renders nothing for a role push v1 never targets', async () => {
    await mount(false);
    expect(screen.queryByText(t.push.profileTitle)).toBeNull();
  });

  it('renders the toggle for a role that receives push', async () => {
    await mount(true);
    expect(screen.getByText(t.push.profileTitle)).toBeTruthy();
    expect(screen.getByText(t.push.profileSubOff)).toBeTruthy();
  });

  it('turn on that could not register yet shows the pending line', async () => {
    await mount(true);
    await act(async () => {
      fireEvent.click(screen.getByRole('switch'));
    });
    expect(pc.enable).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert').textContent).toBe(t.push.onPending);
  });

  it('a failed "off" shows the offline-pending line', async () => {
    pc.on = true;
    pc.disable.mockRejectedValueOnce(new Error('push-off-incomplete'));
    await mount(true);
    await act(async () => {
      fireEvent.click(screen.getByRole('switch'));
    });
    expect(screen.getByRole('alert').textContent).toBe(t.push.profileOffPending);
  });
});
