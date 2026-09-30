'use client';

/**
 * Quiet offline indicator (Fase 17 N7 follow-up, Max's Android test 2026-09-30).
 *
 * Driven ONLY by `navigator.onLine`, the window `online`/`offline` events and a
 * cheap re-read of that flag (focus, visibility, a slow tick) — no React Query
 * read, no Supabase call, no network request — and mounted by `AppShellChrome` as a
 * sibling of the screen slot, never above it. Its state is its own, so going
 * offline re-renders this component and nothing else; above all not the door
 * (86eykm76k, guarded by `door-render-isolation.test.tsx`).
 *
 * One offline episode:
 *  - under OFFLINE_CHIP_AFTER_MS: nothing, not even a render (blips);
 *  - from OFFLINE_CHIP_AFTER_MS: the kit's `OfflineChip` at the top of the
 *    content column; tapping it opens a Sheet with the explanation;
 *  - at OFFLINE_HINT_AFTER_MS, once per episode: a hint card with the same
 *    explanation, "Got it" and "Don't show again" (a per-device, PII-free
 *    localStorage flag; the chip stays either way);
 *  - back online (the flag confirms it, not just an `online` event): everything
 *    goes and the episode resets.
 *
 * On the Deur tab the door's own SyncBar already reads "Offline · {age}" and
 * "{n} queued", so a second "Offline" pill beside it would only repeat it: the
 * chip is left out there, and the hint card (bottom, clear of the sync bar and
 * the search) explains what the sync bar means instead.
 */
import { useEffect, useState, type JSX } from 'react';
import { t } from '@/lib/i18n';
import { Btn, OfflineChip } from './kit';
import { Sheet } from './shell';
import { readDoorVariant } from './use-door-variant';

export const OFFLINE_CHIP_AFTER_MS = 3000;
export const OFFLINE_HINT_AFTER_MS = 4000;
/** A visible chip goes only once `navigator.onLine` has read true this long. */
export const OFFLINE_END_CONFIRM_MS = 1000;
/** Slow re-read of `navigator.onLine`, for a missed or spurious event. */
export const OFFLINE_RECHECK_MS = 2000;
/** Per-device preference, no personal data. */
export const OFFLINE_HINT_OFF_KEY = 'po:offline-hint-off';

function isOfflineNow(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function hintSilenced(): boolean {
  try {
    return window.localStorage.getItem(OFFLINE_HINT_OFF_KEY) === '1';
  } catch {
    return false;
  }
}

function silenceHint(): void {
  try {
    window.localStorage.setItem(OFFLINE_HINT_OFF_KEY, '1');
  } catch {
    /* storage unavailable: the hint just comes back next episode */
  }
}

export interface OfflineEpisode {
  /** Offline long enough to show the chip. */
  chip: boolean;
  /** The once-per-episode hint is up. */
  hint: boolean;
  dismissHint: (forever: boolean) => void;
}

export function useOfflineEpisode(): OfflineEpisode {
  const [chip, setChip] = useState(false);
  const [hint, setHint] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let inEpisode = false;
    let chipShown = false;
    let chipTimer: ReturnType<typeof setTimeout> | undefined;
    let hintTimer: ReturnType<typeof setTimeout> | undefined;
    let endTimer: ReturnType<typeof setTimeout> | undefined;

    const start = (): void => {
      // Still offline after all: a pending "back online" was a flicker.
      clearTimeout(endTimer);
      endTimer = undefined;
      if (inEpisode) return;
      inEpisode = true;
      chipTimer = setTimeout(() => {
        chipShown = true;
        setChip(true);
      }, OFFLINE_CHIP_AFTER_MS);
      hintTimer = setTimeout(() => {
        if (!hintSilenced()) setHint(true);
      }, OFFLINE_HINT_AFTER_MS);
    };
    const end = (): void => {
      endTimer = undefined;
      if (!inEpisode) return;
      inEpisode = false;
      clearTimeout(chipTimer);
      clearTimeout(hintTimer);
      // A blip never set state, so it never costs a render either.
      if (chipShown) {
        chipShown = false;
        setChip(false);
        setHint(false);
      }
    };
    // Android WebView can fire `online` while the device is still offline (a
    // radio tearing down reports a transient connection), and the matching
    // `offline` never follows. Ending on the event alone hid the chip for the
    // rest of the episode (Max's device test, 2026-09-30). So `online` only
    // ends an episode when `navigator.onLine` agrees, and a visible chip only
    // after it still agrees OFFLINE_END_CONFIRM_MS later.
    const maybeEnd = (): void => {
      if (isOfflineNow()) {
        start();
        return;
      }
      if (!inEpisode) return;
      if (!chipShown) {
        end();
        return;
      }
      if (endTimer !== undefined) return;
      endTimer = setTimeout(() => {
        if (isOfflineNow()) start();
        else end();
      }, OFFLINE_END_CONFIRM_MS);
    };
    // Events can be missed or spurious, so also re-read the flag on the way
    // back to the foreground and on a slow tick. Reading a boolean only: no
    // request, no query, and no render unless the state actually flips.
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') maybeEnd();
    };

    window.addEventListener('offline', start);
    window.addEventListener('online', maybeEnd);
    window.addEventListener('focus', maybeEnd);
    document.addEventListener('visibilitychange', onVisible);
    const recheck = setInterval(maybeEnd, OFFLINE_RECHECK_MS);
    if (isOfflineNow()) start();
    return () => {
      window.removeEventListener('offline', start);
      window.removeEventListener('online', maybeEnd);
      window.removeEventListener('focus', maybeEnd);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(recheck);
      clearTimeout(chipTimer);
      clearTimeout(hintTimer);
      clearTimeout(endTimer);
    };
  }, []);

  const dismissHint = (forever: boolean): void => {
    if (forever) silenceHint();
    setHint(false);
  };

  return { chip, hint, dismissHint };
}

export function OfflineIndicator({ surface }: { surface: 'app' | 'door' }): JSX.Element | null {
  const { chip, hint, dismissHint } = useOfflineEpisode();
  const [sheetOpen, setSheetOpen] = useState(false);

  // Back online closes an open explanation too.
  useEffect(() => {
    if (!chip) setSheetOpen(false);
  }, [chip]);

  if (!chip && !hint) return null;

  const onDoor = surface === 'door';
  // The online-only cockpit (desktop Deur variant) has no outbox, so it gets the
  // general copy; only the outbox door queues check-ins on the device.
  const body = onDoor && readDoorVariant() === 'outbox' ? t.shared.offline.bodyDoor : t.shared.offline.body;

  return (
    <>
      {chip && !onDoor ? (
        <div role="status" aria-live="polite" className="flex flex-none justify-center px-4 pt-[8px]">
          <OfflineChip onClick={() => setSheetOpen(true)} />
        </div>
      ) : null}
      {hint ? (
        <div
          role="status"
          aria-live="polite"
          className={
            'po-anim-offline absolute inset-x-4 z-30 rounded-[16px] border border-line bg-elev p-[15px] shadow-[0_16px_40px_rgba(0,0,0,0.4)] ' +
            (onDoor ? 'bottom-[26px]' : 'top-[46px]')
          }
        >
          <div className="font-display text-[15px] font-bold text-text">{t.shared.offline.title}</div>
          <p className="m-0 mt-1 text-[14px] leading-[1.45] text-dim">{body}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Btn sm onClick={() => dismissHint(false)}>
              {t.shared.offline.gotIt}
            </Btn>
            <Btn sm kind="ghost" onClick={() => dismissHint(true)}>
              {t.shared.offline.dontShowAgain}
            </Btn>
          </div>
        </div>
      ) : null}
      {sheetOpen && chip ? (
        <Sheet onClose={() => setSheetOpen(false)} center={false}>
          <div className="font-display text-[18px] font-bold text-text">{t.shared.offline.title}</div>
          <p className="m-0 mt-2 text-[14.5px] leading-[1.5] text-dim">{body}</p>
          <Btn full className="mt-4" onClick={() => setSheetOpen(false)}>
            {t.shared.offline.gotIt}
          </Btn>
        </Sheet>
      ) : null}
    </>
  );
}
