'use client';

/**
 * "Binnenkort" (coming soon) marker for screens that still render mock data and
 * are not yet wired to Supabase. `ComingSoonPill` is the bare pill (used inline
 * in the desktop topbar); `ComingSoonBadge` pins it into the mobile status-bar
 * band so it shows on top of any screen without colliding with its header.
 *
 * As each screen is wired to live data it is added to the WIRED allow-lists in
 * app.tsx / removed from the desktop topbar, and the marker disappears.
 */
import { cn } from '@/lib/utils';

export function ComingSoonPill({ className }: { className?: string }): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-acc/40 bg-acc-dim px-2.5 py-[3px] font-display text-[10px] font-extrabold uppercase tracking-[0.08em] text-acc-soft',
        className,
      )}
    >
      <span className="h-[5px] w-[5px] rounded-full bg-acc" />
      Binnenkort
    </span>
  );
}

export function ComingSoonBadge(): JSX.Element {
  return (
    <div className="pointer-events-none absolute left-1/2 top-[11px] z-30 -translate-x-1/2">
      <ComingSoonPill />
    </div>
  );
}
