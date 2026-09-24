'use client';

/**
 * Permanent sync-status bar (spec §4 point 4). Traffic-light state is an explicit
 * requirement of this task, so it intentionally steps outside the single-accent
 * palette: live=mint, stale=gold (both already used as tier colours in the design
 * data), warn=red (the one genuinely new hue — flagged in the build summary).
 */
import type { JSX } from 'react';
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import { Icon } from '@/components/po/icon';
import { SYNC_STATUS_COLOR, SyncDot } from '@/components/po/kit';
import { useDoor, useDoorSyncStatus } from '../DoorProvider';
import { useWakeLock } from '../sync/useWakeLock';

const press = 'transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.94]';
// Tap-target floor (CLAUDE.md: >= 44px) without moving the bar's pixels: the 30px
// chips keep their size and an invisible `::before` ring makes each hit area
// 44x44 (7px above/below inside the 48px bar). The chips are 10px apart, so the
// ring is lopsided: 5px on the inner side (the two rings meet exactly, never
// overlap) and 9px on the outer side (into the label gap / the bar's padding).
// Each inset is 1px more than that because an absolute box is placed against
// the padding box, inside the chip's 1px border.
const hitWake = "relative before:absolute before:-inset-y-[8px] before:-left-[10px] before:-right-[6px] before:content-['']";
const hitSync = "relative before:absolute before:-inset-y-[8px] before:-left-[6px] before:-right-[10px] before:content-['']";

export function SyncBar(): JSX.Element {
  const { pendingCount } = useDoor();
  const sync = useDoorSyncStatus();
  const wakeLock = useWakeLock();
  const color = SYNC_STATUS_COLOR[sync.status];

  const label =
    sync.status === 'live'
      ? t.door.syncLive
      : sync.status === 'warn'
        ? t.door.syncWarn
        : !sync.online
          ? fmt(t.door.syncOffline, { age: sync.ageLabel })
          : sync.ageLabel;

  return (
    // Fixed height (#2b deur-CLS): the row must not grow/shrink as the status
    // label, warn icon or queue badge changes, or the list below it would shift
    // on load (poor CLS on the full-bleed mobile viewport). h-[48px] + items-center
    // locks the geometry across every sync state (label uses `truncate`, so it
    // never wraps to a second line either).
    <div className="flex h-[48px] flex-none items-center gap-[10px] border-b border-line2 bg-elev px-4">
      {/* The kit's SyncDot, shared with the desktop cockpit header (z8uq9m0hw4). */}
      <SyncDot status={sync.status} />

      <span className="flex min-w-0 flex-1 items-center gap-[7px]">
        {sync.status === 'warn' && <Icon name="warn" size={14} stroke={color} sw={2.2} />}
        <span className="truncate font-body text-[12.5px] font-semibold" style={{ color: sync.status === 'warn' ? color : undefined }}>
          {label}
        </span>
        {pendingCount > 0 && (
          <span className="shrink-0 rounded-full border border-line bg-elev2 px-[7px] py-[1px] font-body text-[10.5px] font-bold text-dim">
            {fmt(t.door.syncQueued, { n: pendingCount })}
          </span>
        )}
      </span>

      {wakeLock.supported && (
        // Three distinct looks — never claim a lock that isn't actually held:
        // off (user turned it off, gray) / pending (on, but not currently
        // holding — refused or a re-acquire in flight, gold — reuses the
        // "stale" traffic-light colour above) / on (solid accent, holding it).
        // The pending colour is a runtime SYNC_STATUS_COLOR reference, so it goes
        // through inline `style` rather than a Tailwind arbitrary-value class
        // (a template-literal class name isn't statically analyzable by the
        // Tailwind JIT scanner and would silently compile to no CSS at all).
        <button
          type="button"
          onClick={wakeLock.toggle}
          aria-label={t.door.wakeLockAria}
          aria-pressed={wakeLock.enabled}
          title={wakeLock.enabled && !wakeLock.active ? t.door.wakeLockPendingAria : t.door.wakeLockAria}
          className={cn(
            'flex h-[30px] w-[30px] items-center justify-center rounded-[10px] border',
            !wakeLock.enabled
              ? 'border-line bg-elev2 text-dim'
              : wakeLock.active
                ? 'border-acc/40 bg-acc-dim text-acc'
                : 'bg-elev2',
            press,
            hitWake,
          )}
          style={wakeLock.enabled && !wakeLock.active ? { borderColor: `${SYNC_STATUS_COLOR.stale}66`, color: SYNC_STATUS_COLOR.stale } : undefined}
        >
          <Icon name="bolt" size={15} sw={2.1} fill={wakeLock.enabled && wakeLock.active ? 'currentColor' : 'none'} />
        </button>
      )}

      <button
        type="button"
        onClick={sync.forceSync}
        aria-label={t.door.syncNowAria}
        className={cn('flex h-[30px] w-[30px] items-center justify-center rounded-[10px] border border-line bg-elev2 text-dim', press, hitSync)}
      >
        <Icon name="refresh" size={16} className={cn(sync.syncing && 'motion-safe:animate-spin')} />
      </button>
    </div>
  );
}
