'use client';

/**
 * Profile → Security: the push on/off row for THIS device (Fase 17 N5,
 * 86ey6bfkb). The way back in after "Not now" or a denial. Renders nothing on
 * the web or in a native build that cannot push (no Firebase config, iOS before
 * S1b), so the Profile screen needs no platform checks of its own.
 *
 * - On: shows the OS prompt when the permission was never asked; registers.
 *   "On" means the person turned it on here — an OS grant alone (Android ≤12
 *   grants from install) still reads Off until they do.
 * - Off: deletes this device's `push_tokens` rows, invalidates the FCM token,
 *   and remembers the choice on this device. When the delete cannot reach the
 *   server the row says so; the next start online finishes it.
 * - Blocked at OS level (Android denied twice): Android will not prompt again,
 *   so the row explains where to allow it instead of a toggle that does nothing.
 */
import { useCallback, useEffect, useState, type JSX } from 'react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { createClient } from '@/lib/supabase/client';
import { getNotificationProvider, type PushPermission } from '@/features/notifications/provider';
import { disablePush, enablePush, isPushOnHere } from '@/features/notifications/push-client';
import { Icon } from './icon';
import { Toggle } from './kit';

export function PushSettingsRow({ canReceive }: { canReceive: boolean }): JSX.Element | null {
  const [perm, setPerm] = useState<PushPermission | null>(null);
  const [onHere, setOnHere] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    const provider = getNotificationProvider();
    if (!provider.isSupported()) {
      setPerm('unsupported');
      return;
    }
    setOnHere(isPushOnHere());
    void provider
      .checkPermission()
      .then(setPerm)
      .catch(() => setPerm('unsupported'));
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Same gate as the ask card: a role push v1 never targets gets no toggle.
  if (!canReceive || perm === null || perm === 'unsupported') return null;

  const on = perm === 'granted' && onHere;
  const blocked = perm === 'denied';

  const toggle = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const turningOff = on;
    try {
      if (turningOff) await disablePush(createClient());
      else {
        const { perm: after, registered } = await enablePush(createClient());
        if (after === 'granted' && !registered) setError(t.push.onPending);
      }
    } catch {
      setError(turningOff ? t.push.profileOffPending : t.push.profileError);
    }
    setBusy(false);
    refresh();
  };

  return (
    <div className="flex items-start gap-[12px] border-b border-line2 py-[14px]">
      <span className={cn('mt-px', on ? 'text-acc' : 'text-faint')}>
        <Icon name="bell" size={19} />
      </span>
      <div className="flex-1">
        <div className="text-[14.5px] font-semibold text-text">{t.push.profileTitle}</div>
        <div className="mt-0.5 text-[12px] leading-[1.4] text-faint">
          {blocked ? t.push.profileBlocked : on ? t.push.profileSubOn : t.push.profileSubOff}
        </div>
        {error && (
          <p className="mt-1 text-[12.5px] text-red-300" role="alert">
            {error}
          </p>
        )}
      </div>
      {!blocked && <Toggle on={on} onClick={busy ? undefined : () => void toggle()} />}
    </div>
  );
}
