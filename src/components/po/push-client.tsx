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
 * - Taps: kind + ids → a real /app URL (`push-routes.ts`), opened with
 *   `router.replace` — Back must not return to a screen the person never chose.
 *   A notification for another venue goes through the chrome's own
 *   `switchToVenue` (one venue-switch path: its "Switching…", its
 *   refusal/failure toasts, its reload), landing on the target; a refused switch
 *   stays where it is. One tap is opened once, even when it arrives twice (the
 *   launch read below + the push plugin's retained event): deduped on its id.
 * - Cold start (Bug 5): the push plugin's retained tap only reaches the web app
 *   after its lazy chunk, the Firebase check and the channel — Home had long
 *   painted by then. So on the first chrome mount of a native page load the
 *   screen slot shows a neutral "Opening…" while `takeLaunchTap()` (one bridge
 *   call to the local config plugin, no Firebase) answers. No launch tap → the
 *   screen renders at once; a tap → replace to the target, and the slot opens on
 *   the URL change. Hard cap LAUNCH_GATE_MS either way, so it can never hang. Off
 *   the Deur tab only (the chrome decides), and never on the web.
 * - Foreground: an actionable in-app notice from our own copy (never a system
 *   notification, never the text that travelled through FCM): tap it or "View"
 *   to open the target (same rule as a tap), × to dismiss, gone by itself after
 *   PUSH_NOTICE_MS. Rendered where the toasts go, so never on the Deur tab.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { t } from '@/lib/i18n';
import { useTransientValue } from '@/lib/use-transient-value';
import { getNotificationProvider, type PushMessage } from '@/features/notifications/provider';
import { parsePushPayload, type PushPayload } from '@/features/notifications/payload';
import {
  enablePush,
  isPushPromptSnoozed,
  isPushUndecided,
  resumePush,
  savePushToken,
  snoozePushPrompt,
} from '@/features/notifications/push-client';
import { Btn, GuideCard, Loading } from './kit';
import { Toast } from './shell';
import { pushTargetPath } from './push-routes';

/** Long enough that the card never competes with the first paint or the MFA/consent nudges. */
export const ASK_DELAY_MS = 8000;
/** The longest the screen slot waits on a cold-start tap before it renders anyway. */
export const LAUNCH_GATE_MS = 1500;
/** Foreground notice lifetime: long enough to read and reach for it. */
export const PUSH_NOTICE_MS = 8000;

// Once per page load, not per mount: a remounted chrome never gates again, and
// React's dev double-mount shares the one native read instead of consuming it twice.
let launchRead: Promise<PushMessage | null> | null = null;
// Tap ids already opened this page load (launch read + retained event = one tap).
const openedTapIds = new Set<string>();

/** Tests only. */
export function __resetPushLaunchForTests(): void {
  launchRead = null;
  openedTapIds.clear();
}

/** Push v1 delivers to admins + event organizers (new requests) and to the
 *  requester (decisions, i.e. staff). One gate for the ask card and the Profile
 *  row, so nobody registers a token nothing will ever target. */
export function canReceivePush(roles: readonly string[], organizesHere: boolean): boolean {
  return roles.includes('admin') || roles.includes('staff') || organizesHere;
}

/** The actionable foreground notice (Bug 6). */
export interface PushNotice {
  text: string;
  open: () => void;
  dismiss: () => void;
}

export interface PushClient {
  ask: PushAsk;
  /** Foreground push waiting to be tapped, or null. */
  notice: PushNotice | null;
  /** A cold-start tap may still be on its way: show "Opening…", not a screen. */
  opening: boolean;
}

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
  locationKey,
}: {
  /** The user holds a role that push v1 delivers to (approvers + staff). */
  canReceive: boolean;
  activeVenueId: string | null;
  /** The chrome's venue switch (context `switchToVenue`), landing on `landing`. */
  switchToVenue: (venueId: string, landing: string) => void;
  onToast: (text: string) => void;
  /** Changes on every URL change (pathname + query): ends "Opening…" once the
   *  cold-start tap's navigation has landed. */
  locationKey: string;
}): PushClient {
  const router = useRouter();
  const [askable, setAskable] = useState(false);
  const [busy, setBusy] = useState(false);
  // Decided at mount: only the first chrome of a native page load can be gated.
  const [opening, setOpening] = useState(() => launchRead === null && getNotificationProvider().isSupported());
  const [notice, showNotice, clearNotice] = useTransientValue<PushPayload>(PUSH_NOTICE_MS);
  // The URL at the moment a gated tap navigated; the slot opens once it changes.
  const gatedFrom = useRef<string | null>(null);

  // Listeners are registered once; they read the latest props through a ref.
  const live = useRef({ activeVenueId, switchToVenue, onToast, router, locationKey, opening });
  useEffect(() => {
    live.current = { activeVenueId, switchToVenue, onToast, router, locationKey, opening };
  }, [activeVenueId, switchToVenue, onToast, router, locationKey, opening]);

  const open = useCallback((p: PushPayload): void => {
    const path = pushTargetPath(p);
    const { activeVenueId: current, router: r, switchToVenue: switchVenue, locationKey: here, opening: gated } = live.current;
    if (!current || p.venueId === current) {
      if (gated) {
        // Already there (same URL): nothing will change, so open the slot now.
        if (`${window.location.pathname}${window.location.search}` === path) setOpening(false);
        else gatedFrom.current = here;
      }
      r.replace(path);
    } else {
      switchVenue(p.venueId, path);
    }
  }, []);

  // The gated tap's navigation landed → show the target.
  useEffect(() => {
    if (opening && gatedFrom.current !== null && locationKey !== gatedFrom.current) setOpening(false);
  }, [opening, locationKey]);

  useEffect(() => {
    const provider = getNotificationProvider();
    if (!provider.isSupported()) return;
    const supabase = createClient();
    let cancelled = false;

    /** true when the message was a valid tap (opened now or already). */
    const tap = (msg: PushMessage): boolean => {
      const p = parsePushPayload(msg.data);
      if (!p) return false;
      if (msg.id) {
        if (openedTapIds.has(msg.id)) return true;
        openedTapIds.add(msg.id);
      }
      open(p);
      return true;
    };

    const offs = [
      provider.onRegistration((reg) => void savePushToken(supabase, reg).catch(() => undefined)),
      provider.onTap((msg) => void tap(msg)),
      provider.onForeground((msg) => {
        const p = parsePushPayload(msg.data);
        if (p) showNotice(p);
      }),
    ];

    // Cold start: the gate is up (initial state); settle it from the launch read.
    let gateTimer: ReturnType<typeof setTimeout> | undefined;
    if (live.current.opening) {
      const release = (): void => {
        if (!cancelled) setOpening(false);
      };
      gateTimer = setTimeout(release, LAUNCH_GATE_MS);
      launchRead ??= provider.takeLaunchTap().catch(() => null);
      void launchRead.then((msg) => {
        if (cancelled) return;
        // No tap (or a malformed one): render the screen now. A tap keeps the
        // gate until its navigation lands, or the cap.
        if (!msg || !tap(msg)) release();
      });
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
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
      clearTimeout(gateTimer);
      for (const off of offs) off();
    };
  }, [open, showNotice]);

  const turnOn = useCallback((): void => {
    setBusy(true);
    void enablePush(createClient())
      .catch(() => ({ perm: 'denied' as const, registered: false }))
      .then(({ perm, registered }) => {
        setBusy(false);
        setAskable(false);
        if (perm !== 'granted') {
          // enablePush already recorded the refusal; the snooze also covers a
          // throw on the way, so the card cannot come straight back either way.
          snoozePushPrompt();
          live.current.onToast(t.push.deniedToast);
        } else if (!registered) {
          // The choice is saved; FCM or the network did not answer yet. Every
          // later start retries — say so rather than implying it is done.
          live.current.onToast(t.push.onPending);
        }
      });
  }, []);
  const later = useCallback((): void => {
    snoozePushPrompt();
    setAskable(false);
  }, []);

  const pushNotice = useMemo((): PushNotice | null => {
    if (!notice) return null;
    return {
      text: t.push.foreground[notice.kind],
      open: () => {
        clearNotice();
        open(notice);
      },
      dismiss: clearNotice,
    };
  }, [notice, clearNotice, open]);

  return { ask: { show: askable && canReceive, busy, turnOn, later }, notice: pushNotice, opening };
}

/** The foreground notice: the kit Toast with its action + dismiss slots. */
export function PushNoticeToast({ notice }: { notice: PushNotice }): JSX.Element {
  return (
    <Toast action={{ label: t.push.foregroundView, onClick: notice.open }} onDismiss={notice.dismiss}>
      {notice.text}
    </Toast>
  );
}

/** What the screen slot shows while a cold-start tap is resolved: neutral, never Home. */
export function PushOpening(): JSX.Element {
  return <Loading text={t.push.opening} className="flex-1" />;
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
