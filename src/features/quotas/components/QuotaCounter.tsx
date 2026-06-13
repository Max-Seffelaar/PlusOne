import { cn } from '@/lib/utils';

interface QuotaCounterProps {
  quota: number;
  consumed: number;
  remaining: number;
  exempt: boolean;
}

/** "8 van 10 over voor dit event" (decisions #4/#17). Staff-facing counter. */
export function QuotaCounter({ quota, consumed, remaining, exempt }: QuotaCounterProps) {
  if (exempt) {
    return (
      <div className="card">
        <p className="label mb-1">Jouw plekken</p>
        <p className="font-display text-lg">Onbeperkt</p>
        <p className="text-sm text-dim">Als admin/organisator tel je niet op een quotum.</p>
      </div>
    );
  }

  const pct = quota > 0 ? Math.min(100, Math.round((consumed / quota) * 100)) : 0;
  const low = remaining <= 0;

  return (
    <div className="card">
      <p className="label mb-1">Jouw plekken</p>
      <p className="font-display text-2xl">
        <span className={cn(low && 'text-acc-soft')}>{remaining}</span>
        <span className="text-dim"> van {quota} over</span>
      </p>
      <p className="text-sm text-dim">voor dit event</p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-elev2" aria-hidden>
        <div
          className={cn('h-full rounded-full bg-acc transition-all', low && 'bg-acc-soft')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-faint">{consumed} gebruikt</p>
    </div>
  );
}
