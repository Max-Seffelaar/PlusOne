'use client';

/**
 * Stale-resume guard overlay (86ey6x56p, spec §4): blocks the door screen the
 * moment it resumes from the background with a sync too old to trust. Online,
 * this is invisible in practice — the forced sync usually lands within a
 * second and the overlay auto-closes. Offline (or a genuinely stuck attempt),
 * it degrades to an explicit warning instead of quietly letting a doorhost
 * check people in against a guest list that might be minutes or hours stale —
 * the door itself must never silently "fall shut" on outdated data.
 *
 * Purely presentational — `phase`/`offline`/`continueAnyway`/`retry` come from
 * a SINGLE `useStaleResumeGuard()` call in the parent (`PoDoorTab`), which also
 * needs the phase to `inert` the rest of the door content while blocking
 * (keyboard/scanner-wedge input must not reach a check-in input underneath —
 * e.g. AddOnSpot's autofocused, Enter-to-commit field). Calling the guard hook
 * a second time here would run two independent state machines against the
 * same sync state and could disagree with each other.
 *
 * Covers the mobile `/door/[eventId]` route AND the mobile `/app` Deur tab —
 * both render `PoDoorTab` under the same `DoorProvider`, including the
 * guest-detail and add-on-spot overlays. Does NOT cover the desktop (≥1024px)
 * `/app` cockpit (`EventDayCockpitGate` in app.tsx) — that surface is a
 * separate, online-only React Query tree with no wake-lock/stale-resume
 * wiring; extending this feature there is tracked as a follow-up, not built
 * in this PR.
 */
import type { JSX } from 'react';
import { Icon } from '@/components/po/icon';
import { Btn, Spinner } from '@/components/po/kit';
import { t } from '@/lib/i18n';
import type { StaleResumeOverlayPhase } from '../sync/useStaleResumeGuard';

export interface StaleResumeOverlayProps {
  phase: StaleResumeOverlayPhase;
  offline: boolean;
  continueAnyway: () => void;
  retry: () => void;
}

export function StaleResumeOverlay({ phase, offline, continueAnyway, retry }: StaleResumeOverlayProps): JSX.Element | null {
  if (phase === 'closed') return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="stale-resume-title"
      className="po-anim-fade fixed inset-0 z-[70] flex flex-col items-center justify-center gap-5 bg-[rgba(6,6,8,0.88)] p-6 text-center backdrop-blur-[3px]"
    >
      {phase === 'syncing' ? (
        <>
          <Spinner size={28} />
          <div id="stale-resume-title" className="font-display text-[17px] font-extrabold tracking-[-0.01em] text-text">
            {t.door.resumeSyncingTitle}
          </div>
          <p className="max-w-[280px] text-[13.5px] leading-[1.5] text-faint">{t.door.resumeSyncingSub}</p>
        </>
      ) : (
        <>
          <span className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[#E5704F]/[0.14] text-[#E5704F]">
            <Icon name="warn" size={26} sw={2.1} />
          </span>
          <div id="stale-resume-title" className="font-display text-[17px] font-extrabold tracking-[-0.01em] text-text">
            {offline ? t.door.resumeOfflineTitle : t.door.resumeStuckTitle}
          </div>
          <p className="max-w-[280px] text-[13.5px] leading-[1.5] text-faint">
            {offline ? t.door.resumeOfflineSub : t.door.resumeStuckSub}
          </p>
          <div className="flex w-full max-w-[280px] flex-col gap-[10px]">
            {/* The guaranteed-safe escape hatch is primary + focused first — the
                door must never depend on connectivity to be usable. */}
            <Btn onClick={continueAnyway} full autoFocus>
              {t.door.resumeContinueAnyway}
            </Btn>
            <Btn onClick={retry} full kind="ghost">
              {t.door.resumeTryAgain}
            </Btn>
          </div>
        </>
      )}
    </div>
  );
}
