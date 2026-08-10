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
 * Mounted once in PoDoorTab (covers both the mobile /door/[eventId] route and
 * the desktop cockpit's Deur tab — both render PoDoorTab under the same
 * DoorProvider), so it blocks every door surface uniformly, including the
 * guest-detail and add-on-spot overlays.
 */
import { Icon } from '@/components/po/icon';
import { Btn, Spinner } from '@/components/po/kit';
import { t } from '@/lib/i18n';
import { useDoorSyncStatus } from '../DoorProvider';
import { useStaleResumeGuard } from '../sync/useStaleResumeGuard';

export function StaleResumeOverlay(): JSX.Element | null {
  const sync = useDoorSyncStatus();
  const { phase, offline, continueAnyway } = useStaleResumeGuard(sync);

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
          <Btn onClick={continueAnyway} full className="max-w-[280px]">
            {t.door.resumeContinueAnyway}
          </Btn>
        </>
      )}
    </div>
  );
}
