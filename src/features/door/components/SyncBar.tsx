'use client';

/**
 * Permanent sync-status bar (spec §4 point 4). Traffic-light state is an explicit
 * requirement of this task, so it intentionally steps outside the single-accent
 * palette: live=mint, stale=gold (both already used as tier colours in the design
 * data), warn=red (the one genuinely new hue — flagged in the build summary).
 */
import { cn } from '@/lib/utils';
import { Icon } from '@/components/po/icon';
import { useDoor } from '../DoorProvider';

const STATUS_COLOR = { live: '#4FD1A1', stale: '#E8C98A', warn: '#E5704F' } as const;
const press = 'transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.94]';

export function SyncBar(): JSX.Element {
  const { sync, pendingCount } = useDoor();
  const color = STATUS_COLOR[sync.status];

  const label =
    sync.status === 'live'
      ? 'Live · realtime'
      : sync.status === 'warn'
        ? 'Geen sync >10 min — controleer verbinding'
        : !sync.online
          ? `Offline · ${sync.ageLabel}`
          : sync.ageLabel;

  return (
    // Fixed height (#2b deur-CLS): the row must not grow/shrink as the status
    // label, warn icon or queue badge changes, or the list below it would shift
    // on load (poor CLS on the full-bleed mobile viewport). h-[48px] + items-center
    // locks the geometry across every sync state (label uses `truncate`, so it
    // never wraps to a second line either).
    <div className="flex h-[48px] flex-none items-center gap-[10px] border-b border-line2 bg-elev px-4">
      <span className="relative flex h-[10px] w-[10px] items-center justify-center">
        {sync.status === 'live' && (
          <span
            className="absolute inline-flex h-full w-full rounded-full opacity-60 motion-safe:animate-ping"
            style={{ background: color }}
          />
        )}
        <span className="relative inline-flex h-[9px] w-[9px] rounded-full" style={{ background: color }} />
      </span>

      <span className="flex min-w-0 flex-1 items-center gap-[7px]">
        {sync.status === 'warn' && <Icon name="warn" size={14} stroke={color} sw={2.2} />}
        <span className="truncate font-body text-[12.5px] font-semibold" style={{ color: sync.status === 'warn' ? color : undefined }}>
          {label}
        </span>
        {pendingCount > 0 && (
          <span className="shrink-0 rounded-full border border-line bg-elev2 px-[7px] py-[1px] font-body text-[10.5px] font-bold text-dim">
            {pendingCount} in wachtrij
          </span>
        )}
      </span>

      <button
        type="button"
        onClick={sync.forceSync}
        aria-label="Nu synchroniseren"
        className={cn('flex h-[30px] w-[30px] items-center justify-center rounded-[10px] border border-line bg-elev2 text-dim', press)}
      >
        <Icon name="refresh" size={16} className={cn(sync.syncing && 'motion-safe:animate-spin')} />
      </button>
    </div>
  );
}
