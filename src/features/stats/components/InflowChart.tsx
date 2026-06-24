'use client';

// Instroomgrafiek (#26, spec §6): check-ins per 15-min bucket, rendered with
// recharts. Data arrives pre-bucketed and pre-formatted from the server (labels
// already in Amsterdam TZ), so there is no aggregation or TZ logic on the
// client. The busiest bucket is accented in lavender, matching the mock.
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const ACC = '#B5A6FF';
const ELEV2 = '#1E1E21';
const LINE = 'rgba(255,255,255,0.10)';
const FAINT = 'rgba(255,255,255,0.40)';

export interface InflowDatum {
  label: string;
  checkins: number;
  headcount: number;
}

// Minimal shape of the props recharts injects into a custom tooltip — typed
// locally so we don't depend on recharts' (version-shifting) TooltipProps.
interface TooltipInjected<T> {
  active?: boolean;
  payload?: { payload: T }[];
}

function InflowTooltip({ active, payload }: TooltipInjected<InflowDatum>): JSX.Element | null {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="rounded-[10px] border border-line bg-elev2 px-3 py-2 text-[12.5px] shadow-lg">
      <div className="font-display font-bold text-text">{d.label}</div>
      <div className="text-dim">{d.checkins} check-ins</div>
      <div className="text-faint">{d.headcount} people inside</div>
    </div>
  );
}

export function InflowChart({ data, peakLabel }: { data: InflowDatum[]; peakLabel: string | null }): JSX.Element {
  if (data.length === 0) {
    return <div className="py-12 text-center text-[14px] text-faint">No check-ins yet.</div>;
  }
  return (
    // min-w-0 keeps ResponsiveContainer from feeding its width back into a
    // flex/grid track (ResizeObserver-loop guard). Height is an explicit number
    // on the container — a percentage height resolves to 0 in this layout.
    <div className="w-full min-w-0 overflow-hidden">
      <ResponsiveContainer width="100%" height={210} debounce={80}>
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -24 }} barCategoryGap="22%">
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: LINE }}
            tick={{ fill: FAINT, fontSize: 10.5 }}
            interval="preserveStartEnd"
            minTickGap={8}
          />
          <YAxis
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            width={40}
            tick={{ fill: FAINT, fontSize: 10.5 }}
          />
          <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<InflowTooltip />} />
          <Bar dataKey="checkins" radius={[6, 6, 0, 0]} maxBarSize={40} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.label} fill={d.label === peakLabel ? ACC : ELEV2} stroke={d.label === peakLabel ? ACC : LINE} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
