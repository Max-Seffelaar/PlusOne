// One KPI card — the desktop mock's stat tile. Server component (pure display),
// shared by the event-stats and venue-overview screens.
import { cn } from '@/lib/utils';
import { DCard } from '@/components/po/desktop/kit';

export function StatCard({
  value,
  label,
  sub,
  accent,
}: {
  value: string;
  label: string;
  sub?: string;
  accent?: boolean;
}): JSX.Element {
  return (
    <DCard className="p-5">
      <div
        className={cn(
          'font-display text-[32px] font-extrabold tracking-[-0.02em]',
          accent ? 'text-acc' : 'text-text'
        )}
      >
        {value}
      </div>
      <div className="mt-[10px] text-[14px] font-semibold text-text">{label}</div>
      {sub && <div className="mt-0.5 text-[12.5px] text-faint">{sub}</div>}
    </DCard>
  );
}
