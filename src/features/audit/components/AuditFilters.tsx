'use client';

// Audit-log filter bar (#15: "filters op event/user/gast/actiesoort"). All
// filtering is server-side: each control rewrites the URL query string and the
// page re-fetches through audit_feed. Visual language mirrors the desktop mock
// (action chips + select + search), composed from the shared kit.
import { useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Icon } from '@/components/po/icon';

const ACTIONS: [string, string][] = [
  ['all', 'All'],
  ['check_in', 'Check-ins'],
  ['create', 'Added'],
  ['tier_change', 'Tier'],
  ['quota_grant', 'Quota'],
  ['approve', 'Approvals'],
  ['refuse', 'Refusals'],
  ['lock', 'Lock'],
];

export interface AuditFiltersProps {
  events: { id: string; name: string }[];
  actors: { id: string; name: string }[];
  current: { action: string; eventId?: string; actorId?: string; search?: string };
}

export function AuditFilters({ events, actors, current }: AuditFiltersProps): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [search, setSearch] = useState(current.search ?? '');
  const firstRender = useRef(true);

  // Build the next URL from the current params with one key changed; clearing a
  // value drops the key. `guest` is always cleared — changing a filter leaves
  // the per-guest history view back to the chronological log.
  function pushParam(key: string, value: string | null): void {
    const next = new URLSearchParams(params.toString());
    if (value && value !== 'all') next.set(key, value);
    else next.delete(key);
    next.delete('guest');
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  }

  // Debounced free-text search → URL.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const id = setTimeout(() => pushParam('q', search.trim() || null), 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const selectClass =
    'rounded-[11px] border border-line bg-elev px-[13px] py-[9px] text-[13.5px] text-text outline-none';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {ACTIONS.map(([k, l]) => {
          const on = (current.action || 'all') === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => pushParam('action', k)}
              className={cn(
                'cursor-pointer rounded-full border px-[15px] py-2 font-display text-[13px] font-bold transition-[filter] hover:brightness-[1.08]',
                on ? 'border-transparent bg-text text-bg' : 'border-line bg-transparent text-dim'
              )}
            >
              {l}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Filter by event"
          className={selectClass}
          value={current.eventId ?? ''}
          onChange={(e) => pushParam('event', e.target.value || null)}
        >
          <option value="">All events</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by person"
          className={selectClass}
          value={current.actorId ?? ''}
          onChange={(e) => pushParam('user', e.target.value || null)}
        >
          <option value="">All people</option>
          {actors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>

        <div className="flex-1" />

        <div className="inline-flex min-w-[220px] items-center gap-2 rounded-[11px] border border-line bg-elev px-[13px] py-[9px] text-faint">
          <Icon name="search" size={16} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search the log…"
            className="w-full flex-1 border-none bg-transparent text-[13.5px] text-text outline-none placeholder:text-faint"
          />
        </div>
      </div>
    </div>
  );
}
