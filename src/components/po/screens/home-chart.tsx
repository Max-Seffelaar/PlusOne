'use client';

/**
 * Home's combined requested-vs-on-the-list chart (S14), split out of home.tsx
 * (z8uq9m0hw4) to keep the screen under the ~800 LOC rule. Unchanged.
 */
import { type JSX, useState } from 'react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

// ── combined graph (requested vs on-the-list, grouped per event) ──────────────
// One chart, two bars per event on a SHARED y-scale so the comparison is honest.
// Hovering (desktop) or tapping (touch) a column reveals a tooltip with both
// exact numbers — the bars themselves stay number-free so 8 events read clean.
export function ComboChart({
  data,
}: {
  data: { id: string; label: string; live: boolean; requested: number; onList: number }[];
}): JSX.Element {
  const [active, setActive] = useState<number | null>(null);
  const H = 168;
  const top = Math.max(...data.flatMap((d) => [d.requested, d.onList]), 1);
  const last = data.length - 1;
  const barH = (v: number): number => (v <= 0 ? 0 : Math.max((v / top) * (H - 16), 3));
  return (
    <div className="card flex min-w-0 flex-col rounded-[22px] border border-line bg-elev p-[22px]">
      {/* header + legend */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="font-display text-[16.5px] font-bold tracking-[-0.01em] text-text">
            {t.home.graphComboTitle}
          </div>
          <div className="mt-0.5 text-[12.5px] text-faint">{t.home.graphComboSub}</div>
        </div>
        <div className="flex items-center gap-[14px]">
          <span className="inline-flex items-center gap-[7px] font-body text-[12px] font-semibold text-dim">
            <span className="h-[10px] w-[10px] rounded-[3px] bg-acc-soft" />
            {t.home.legRequested}
          </span>
          <span className="inline-flex items-center gap-[7px] font-body text-[12px] font-semibold text-dim">
            <span className="h-[10px] w-[10px] rounded-[3px] bg-acc" />
            {t.home.legOnList}
          </span>
        </div>
      </div>

      {/* plot */}
      <div className="relative mb-[10px]" style={{ height: H }}>
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={i === 3 ? 'h-px bg-line' : 'h-px bg-line2'} />
          ))}
        </div>
        <div className="relative flex h-full items-end gap-1">
          {data.map((d, i) => {
            const on = active === i;
            return (
              <button
                type="button"
                key={d.id}
                aria-label={`${d.label}: ${d.requested} ${t.home.legRequested}, ${d.onList} ${t.home.legOnList}`}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive((cur) => (cur === i ? null : cur))}
                onClick={() => setActive((cur) => (cur === i ? null : i))}
                className="group relative flex h-full min-w-0 flex-1 items-end justify-center rounded-[8px] transition-colors"
                style={{ background: on ? 'rgba(255,255,255,0.04)' : undefined }}
              >
                <span className="flex h-full items-end justify-center gap-[4px] px-0.5">
                  <span
                    className="w-full max-w-[15px] rounded-[5px_5px_2px_2px] bg-acc-soft transition-[height,filter] duration-300 group-hover:brightness-110"
                    style={{ height: barH(d.requested), minWidth: 6 }}
                  />
                  <span
                    className="relative w-full max-w-[15px] rounded-[5px_5px_2px_2px] bg-acc transition-[height,filter] duration-300 group-hover:brightness-110"
                    style={{ height: barH(d.onList), minWidth: 6 }}
                  >
                    {d.live && (
                      <span className="absolute -top-[3px] left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-white motion-safe:animate-pulse" />
                    )}
                  </span>
                </span>

                {on && (
                  <span
                    className={cn(
                      'absolute bottom-[calc(100%+8px)] z-10 w-max max-w-[200px] rounded-[12px] border border-line bg-elev2 p-[10px_12px] text-left shadow-[0_10px_34px_rgba(0,0,0,0.5)]',
                      i === 0 ? 'left-0' : i === last ? 'right-0' : 'left-1/2 -translate-x-1/2'
                    )}
                  >
                    <span className="mb-1.5 block truncate font-display text-[13px] font-bold text-text">{d.label}</span>
                    <span className="flex items-center justify-between gap-5 font-body text-[12.5px]">
                      <span className="inline-flex items-center gap-[6px] text-dim">
                        <span className="h-[9px] w-[9px] rounded-[2px] bg-acc-soft" />
                        {t.home.legRequested}
                      </span>
                      <span className="font-display font-extrabold text-text">{d.requested}</span>
                    </span>
                    <span className="mt-1 flex items-center justify-between gap-5 font-body text-[12.5px]">
                      <span className="inline-flex items-center gap-[6px] text-dim">
                        <span className="h-[9px] w-[9px] rounded-[2px] bg-acc" />
                        {t.home.legOnList}
                      </span>
                      <span className="font-display font-extrabold text-text">{d.onList}</span>
                    </span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex gap-1">
        {data.map((d, i) => (
          <div
            key={d.id}
            className={cn(
              'min-w-0 flex-1 truncate px-0.5 text-center font-body text-[10.5px] font-semibold',
              active === i ? 'text-text' : d.live ? 'text-acc-soft' : 'text-faint'
            )}
          >
            {d.label}
          </div>
        ))}
      </div>
    </div>
  );
}
