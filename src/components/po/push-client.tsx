'use client';

/**
 * Push in the po shell (Fase 17 N5, 86ey6bfkb). `usePushClient` runs in the
 * chrome (`app-chrome.tsx`), never in the shell root: it reads no query at all,
 * so it adds nothing to the door's ancestor path (86eykm76k). It does nothing
 * on the web — every path starts at `provider.isSupported()`.
 *
 * - Registration: on mount, if the person turned push on for this device (ask
 *   card or Profile) and the OS allows it, register again — this refreshes the
 *   `push_tokens` row. Every later token refresh is stored too (while still on).
 *   The OS grant alone never registers: Android 12 and below grant from install,
 *   so the card is the consent step on every Android version.
 * - Asking: never on launch. After ASK_DELAY_MS, and only for a role that can
 *   receive something (the caller decides), off the Deur tab (the chrome only
 *   renders `PushAskCard` outside it), when nothing was decided on this device
 *   yet, and not while snoozed: a card that explains the value first. The OS
 *   prompt only appears after "Turn on". A denial is respected — `enablePush`
 *   records it (Android 13+ still reports a first denial as askable), so the
 *   card does not come back; Profile is the way back in.
 * - Taps: kind + ids → a real /app URL (`push-routes.ts`). A notification for
 *   another venue goes through the chrome's own `switchToVenue` (one venue-switch
 *   path: its "Switching…", its refusal/failure toasts, its reload), landing on
 *   the target; a refused switch stays where it is.
 * - Foreground: an in-app toast from our own copy, never a system notification
 *   and never the text that travelled through FCM.
 */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { t } from '@/lib/i18n';
import { getNotificationProvider } from '@/features/notifications/provider';
import { parsePushPayload, type PushPayload } from '@/features/notifications/payload';
import {
  enablePush,
  isPushPromptSnoozed,
  isPushUndecided,
  resumePush,
  savePushToken,
  snoozePushPrompt,
} from '@/features/notifications/push-client';
import { Btn, GuideCard } from './kit';
import { pushTargetPath } from './push-routes';

/** Long enough that the card never competes with the first paint or the MFA/consent nudges. */
export const ASK_DELAY_MS = 8000;

export interface PushAsk {
  /** Show the explain-first card now. */
  show: boolean;
  busy: boolean;
  turnOn: () => void;
  later: () => void;
}

export function usePushClient({
  canReceive,
  activeVenueId,
  switchToVenue,
  onToast,
}: {
  /** The user holds a role that push v1 delivers to (approvers + staff). */
  canReceive: boolean;
  activeVenueId: string | null;
  /** The chrome's venue switch (context `switchToVenue`), landing on `landing`. */
  switchToVenue: (venueId: string, landing: string) => void;
  onToast: (text: string) => void;
}): PushAsk {
  const router = useRouter();
  const [askable, setAskable] = useState(false);
  const [busy, setBusy] = useState(false);

  // Listeners are registered once; they read the latest props through a ref.
  const live = useRef({ activeVenueId, switchToVenue, onToast, router });
  useEffect(() => {
    live.current = { activeVenueId, switchToVenue, onToast, router };
  }, [activeVenueId, switchToVenue, onToast, router]);

  useEffect(() => {
    const provider = getNotificationProvider();
    if (!provider.isSupported()) return;
    const supabase = createClient();

    const open = (p: PushPayload): void => {
      const path = pushTargetPath(p);
      const { activeVenueId: current, router: r, switchToVenue: switchVenue } = live.current;
      if (!current || p.venueId === current) r.push(path);
      else switchVenue(p.venueId, path);
    };

    const offs = [
      provider.onRegistration((reg) => void savePushToken(supabase, reg).catch(() => undefined)),
      provider.onTap((msg) => {
        const p = parsePushPayload(msg.data);
        if (p) open(p);
      }),
      provider.onForeground((msg) => {
        const p = parsePushPayload(msg.data);
        if (p) live.current.onToast(t.push.foreground[p.kind]);
      }),
    ];

    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    void resumePush(supabase)
      .then((perm) => {
        // `granted` counts too: Android 12 and below grant from install, and
        // the card is the consent step there as well.
        const askable = perm === 'default' || perm === 'granted';
        if (cancelled || !askable || !isPushUndecided() || isPushPromptSnoozed()) return;
        timer = setTimeout(() => setAskable(true), ASK_DELAY_MS);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      for (const off of offs) off();
    };
  }, []);

  const turnOn = useCallback((): void => {
    setBusy(true);
    void enablePush(createClient())
      .catch(() => 'denied' as const)
      .then((perm) => {
        setBusy(false);
        setAskable(false);
        if (perm !== 'granted') {
          // enablePush already recorded the refusal; the snooze also covers a
          // throw on the way, so the card cannot come straight back either way.
          snoozePushPrompt();
          live.current.onToast(t.push.deniedToast);
        }
      });
  }, []);
  const later = useCallback((): void => {
    snoozePushPrompt();
    setAskable(false);
  }, []);

  return { show: askable && canReceive, busy, turnOn, later };
}

/** The explain-first card. Rendered by the chrome where the Toast goes (content
 *  column, above the in-flow tab bar), never on the Deur tab. */
export function PushAskCard({ ask }: { ask: PushAsk }): JSX.Element | null {
  if (!ask.show) return null;
  return (
    <div className="po-anim-toast absolute inset-x-4 bottom-[26px] z-20 mx-auto max-w-[560px]">
      <GuideCard
        icon="bell"
        title={t.push.askTitle}
        body={t.push.askBody}
        className="mb-0 shadow-[0_16px_40px_rgba(0,0,0,0.4)]"
        actions={
          <>
            <Btn sm kind="primary" disabled={ask.busy} onClick={ask.turnOn}>
              {t.push.askEnable}
            </Btn>
            <Btn sm kind="ghost" disabled={ask.busy} onClick={ask.later}>
              {t.push.askLater}
            </Btn>
          </>
        }
      />
    </div>
  );
}
