'use client';

/**
 * Profile → Security: the push on/off row for THIS device (Fase 17 N5,
 * 86ey6bfkb). The way back in after "Not now" or a denial. Renders nothing on
 * the web or in a native build that cannot push (no Firebase config, iOS before
 * S1b), so the Profile screen needs no platform checks of its own.
 *
 * - On: shows the OS prompt when the permission was never asked; registers.
 * - Off: deletes this device's `push_tokens` rows, invalidates the FCM token,
 *   and remembers the choice on this device.
 * - Blocked at OS level (Android denied twice): Android will not prompt again,
 *   so the row explains where to allow it instead of a toggle that does nothing.
 */
import { useCallback, useEffect, useState, type JSX } from 'react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { createClient } from '@/lib/supabase/client';
import { getNotificationProvider, type PushPermission } from '@/features/notifications/provider';
import { disablePush, enablePush, isPushOptedOut } from '@/features/notifications/push-client';
import { Icon } from './icon';
import { Toggle } from './kit';

export function PushSettingsRow(): JSX.Element | null {
  const [perm, setPerm] = useState<PushPermission | null>(null);
  const [optedOut, setOptedOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const refresh = useCallback(() => {
    const provider = getNotificationProvider();
    if (!provider.isSupported()) {
      setPerm('unsupported');
      return;
    }
    setOptedOut(isPushOptedOut());
    void provider
      .checkPermission()
      .then(setPerm)
      .catch(() => setPerm('unsupported'));
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  if (perm === null || perm === 'unsupported') return null;

  const on = perm === 'granted' && !optedOut;
  const blocked = perm === 'denied';

  const toggle = async (): Promise<void> => {
    setBusy(true);
    setError(false);
    try {
      if (on) await disablePush(createClient());
      else await enablePush(createClient());
    } catch {
      setError(true);
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
            {t.push.profileError}
          </p>
        )}
      </div>
      {!blocked && <Toggle on={on} onClick={busy ? undefined : () => void toggle()} />}
    </div>
  );
}
