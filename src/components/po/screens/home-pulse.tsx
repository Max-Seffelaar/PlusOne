'use client';

/**
 * Home's pulse-strip tile (S14), split out of home.tsx (z8uq9m0hw4) so the
 * screen stays under the ~800 LOC rule while the Open requests tile gains its
 * pending-count badge.
 */
import type { JSX } from 'react';
import { cn } from '@/lib/utils';
import { Icon, type IconName } from '../icon';
import { CountBadge, press } from '../kit';

// ── pulse strip ─────────────────────────────────────────────────────────────
// A tile is a plain readout, or — when `onClick` is set (Requests / Quota) — a
// button that jumps into the approval inbox. Clickable tiles show a → affordance.
// `badge` (z8uq9m0hw4, Joeri walkthrough) adds a pulsing count bubble next to
// the → so waiting requests catch the eye on Home. On a phone this tile is the
// first thing under the greeting, not only the More tab's dot.
export function PulseTile({
  icon,
  label,
  value,
  action,
  badge = 0,
  onClick,
  className,
}: {
  icon: IconName;
  label: string;
  value: string | number;
  action?: boolean;
  /** Pending count for the pulsing icon badge; nothing renders at 0. */
  badge?: number;
  onClick?: () => void;
  className?: string;
}): JSX.Element {
  const cls = cn(
    'flex min-w-0 flex-1 flex-col rounded-[18px] border p-[16px_18px] text-left',
    action ? 'border-transparent bg-acc-dim' : 'border-line bg-elev',
    onClick && press,
    className
  );
  const inner = (
    <>
      <div className="mb-3 flex items-center gap-2">
        <span className={action ? 'text-acc' : 'text-faint'}>
          <Icon name={icon} size={16} />
        </span>
        <span className="font-body text-[11.5px] font-bold uppercase tracking-[0.03em] text-faint">{label}</span>
        {(onClick || badge > 0) && (
          <span className={cn('ml-auto flex shrink-0 items-center gap-2', action ? 'text-acc' : 'text-ghost')}>
            {/* aria-hidden: the tile already reads out the same number below. */}
            <span aria-hidden className="flex">
              <CountBadge n={badge} pulse />
            </span>
            {onClick && <Icon name="arrowR" size={15} />}
          </span>
        )}
      </div>
      <div
        className={cn(
          'font-display text-[34px] font-extrabold leading-none tracking-[-0.03em]',
          action ? 'text-acc' : 'text-text'
        )}
      >
        {value}
      </div>
    </>
  );
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={cls}>
        {inner}
      </button>
    );
  return <div className={cls}>{inner}</div>;
}
