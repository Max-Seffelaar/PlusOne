'use client';

// Aanwezig vs. aangemeld per tier (spec §6), recharts horizontal stacked bars:
// the accent segment (in each tier's own colour) is who came (binnen), the faint
// segment the rest of those expected (aangemeld). Counts are headcount (people).
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const ACC = '#B5A6FF';
const WHITE_08 = 'rgba(255,255,255,0.08)';
const FAINT = 'rgba(255,255,255,0.40)';

export interface TierDatum {
  tier: string;
  present: number;
  registered: number;
  gap: number;
  color: string;
}

// Minimal shape of recharts' injected tooltip props (see InflowChart).
interface TooltipInjected<T> {
  active?: boolean;
  payload?: { payload: T }[];
}

function TierTooltip({ active, payload }: TooltipInjected<TierDatum>): JSX.Element | null {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="rounded-[10px] border border-line bg-elev2 px-3 py-2 text-[12.5px] shadow-lg">
      <div className="font-display font-bold text-text">{d.tier}</div>
      <div className="text-dim">
        <span className="text-acc">{d.present}</span> binnen / {d.registered} aangemeld
      </div>
    </div>
  );
}

export function TierChart({ data }: { data: TierDatum[] }): JSX.Element {
  if (data.length === 0) {
    return <div className="py-12 text-center text-[14px] text-faint">Nog geen tiers met gasten.</div>;
  }
  const height = Math.max(120, data.length * 48);
  return (
    // min-w-0: see InflowChart. Explicit numeric height on the container avoids
    // the recharts percentage-height-resolves-to-0 issue.
    <div className="w-full min-w-0 overflow-hidden">
      <ResponsiveContainer width="100%" height={height} debounce={80}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 8, bottom: 0, left: 8 }}
          barCategoryGap="28%"
        >
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="tier"
            tickLine={false}
            axisLine={false}
            width={120}
            tick={{ fill: FAINT, fontSize: 12 }}
          />
          <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<TierTooltip />} />
          <Bar dataKey="present" stackId="a" radius={[5, 0, 0, 5]} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.tier} fill={d.color || ACC} />
            ))}
          </Bar>
          <Bar dataKey="gap" stackId="a" radius={[0, 5, 5, 0]} fill={WHITE_08} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
