// @vitest-environment jsdom
/**
 * Profile → Notifications (guest mail 6b): which kinds each role sees, and
 * that a change saves the whole preference object (daily email switches the
 * summary on).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { t } from '@/lib/i18n';
import { DEFAULT_NOTIFICATION_PREFS } from '@/features/notifications/prefs-schema';

const H = vi.hoisted(() => ({ mutate: vi.fn(), prefs: null as unknown }));
vi.mock('@/features/po/notification-prefs', () => ({
  usePoNotificationPrefs: () => ({ data: H.prefs }),
  usePoSaveNotificationPrefs: () => ({ mutate: H.mutate, isPending: false, isError: false, isSuccess: false }),
}));

import { NotificationPrefsSection } from './notification-prefs';

afterEach(() => {
  cleanup();
  H.mutate.mockReset();
});

describe('NotificationPrefsSection', () => {
  it('an admin sees requests, quota, answers and the daily summary', () => {
    H.prefs = DEFAULT_NOTIFICATION_PREFS;
    render(<NotificationPrefsSection canDecideRequests isAdmin />);
    for (const id of ['prefs-requests', 'prefs-quota', 'prefs-decisions', 'prefs-digest']) {
      expect(screen.getByTestId(id)).not.toBeNull();
    }
  });

  it('staff only sees answers to their own quota requests', () => {
    H.prefs = DEFAULT_NOTIFICATION_PREFS;
    render(<NotificationPrefsSection canDecideRequests={false} isAdmin={false} />);
    expect(screen.queryByTestId('prefs-requests')).toBeNull();
    expect(screen.queryByTestId('prefs-quota')).toBeNull();
    expect(screen.queryByTestId('prefs-digest')).toBeNull();
    expect(screen.getByTestId('prefs-decisions')).not.toBeNull();
  });

  it('an organizer (not an admin) sees requests and the summary, not quota', () => {
    H.prefs = DEFAULT_NOTIFICATION_PREFS;
    render(<NotificationPrefsSection canDecideRequests isAdmin={false} />);
    expect(screen.getByTestId('prefs-requests')).not.toBeNull();
    expect(screen.queryByTestId('prefs-quota')).toBeNull();
  });

  it('picking "Daily summary" saves the whole object with the summary on', () => {
    H.prefs = { ...DEFAULT_NOTIFICATION_PREFS, digest: false };
    render(<NotificationPrefsSection canDecideRequests isAdmin />);
    const block = screen.getByTestId('prefs-requests');
    fireEvent.click(block.querySelectorAll('button')[2] as HTMLElement); // Push, Right away, [Daily summary]
    expect(H.mutate).toHaveBeenCalledWith({ ...DEFAULT_NOTIFICATION_PREFS, requests: { push: true, email: 'daily' }, digest: true });
  });

  it('the push switch flips only push for that kind', () => {
    H.prefs = DEFAULT_NOTIFICATION_PREFS;
    render(<NotificationPrefsSection canDecideRequests isAdmin />);
    fireEvent.click(screen.getByRole('switch', { name: `${t.notifications.prefs.quotaTitle}: ${t.notifications.prefs.push}` }));
    expect(H.mutate).toHaveBeenCalledWith({ ...DEFAULT_NOTIFICATION_PREFS, quota: { push: false, email: 'immediate' } });
  });
});
