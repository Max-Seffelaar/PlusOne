/**
 * Static, server-renderable skeleton of the Event-dag cockpit (#2b a).
 *
 * The cockpit itself (`EventDayCockpit`) is fully client-rendered behind the
 * `'use client'` PoLiveProvider boundary, so without this the initial HTML for
 * /eventday carried no meaningful content → a white screen until JS hydrated
 * (FCP == LCP ≈ 3.56s). This component is intentionally NOT `'use client'`: it
 * renders on the server (it is wired as the `next/dynamic` `loading` fallback for
 * the cockpit gate, which Next emits into the initial HTML), so the browser paints
 * the cockpit's frame — page header, LIVE strip, the 4 KPI tiles and the two-column
 * list/side frame — immediately. FCP now lands on this skeleton (≪ LCP) and, because
 * the geometry matches the real cockpit (same spacing, rounded-[20px], 4-tile grid),
 * the client hydration swaps in live data with no layout jump.
 *
 * Pure presentational, no recharts (the cockpit uses CSS bars). Tokens/classes are
 * copied — not imported from the client `DCard` — to keep this a plain server module.
 */

const card = 'rounded-[20px] border border-line bg-elev';
const block = 'animate-pulse rounded-[8px] bg-elev2';

function Bar({ className }: { className: string }): JSX.Element {
  return <div className={`${block} ${className}`} />;
}

export function EventDaySkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-[18px]" aria-hidden="true">
      {/* page header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <Bar className="h-[24px] w-[180px]" />
          <Bar className="h-[14px] w-[220px]" />
        </div>
        <Bar className="h-[42px] w-[140px] rounded-[12px]" />
      </div>

      {/* LIVE strip */}
      <div
        className="rounded-[20px] border border-line p-[22px]"
        style={{ background: 'radial-gradient(120% 160% at 0% 0%, rgba(181,166,255,0.13), #161618 58%)' }}
      >
        <div className="flex flex-wrap items-center gap-4">
          <Bar className="h-[30px] w-[150px] rounded-full" />
          <div className="min-w-0 space-y-2">
            <Bar className="h-[23px] w-[200px]" />
            <Bar className="h-[13px] w-[160px]" />
          </div>
          <div className="flex-1" />
          <Bar className="h-[38px] w-[110px]" />
          <Bar className="h-[44px] w-[140px] rounded-[12px]" />
        </div>
        <div className="mb-[9px] mt-5 flex items-baseline justify-between">
          <Bar className="h-[12px] w-[90px]" />
          <Bar className="h-[15px] w-[140px]" />
        </div>
        <div className="h-3 overflow-hidden rounded-[7px] bg-elev2">
          <div className="h-full w-1/3 rounded-[7px] bg-acc-dim" />
        </div>
        <div className="mt-3">
          <Bar className="h-[12px] w-[280px] max-w-full" />
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`${card} p-[18px]`}>
            <Bar className="h-[34px] w-[60px]" />
            <div className="mt-3 space-y-2">
              <Bar className="h-[14px] w-[70px]" />
              <Bar className="h-[12px] w-[90px]" />
            </div>
          </div>
        ))}
      </div>

      {/* main grid: cockpit list (left) + side column (right) */}
      <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] items-start gap-4">
        <div className={`${card} overflow-hidden p-0`}>
          {/* search + filter header */}
          <div className="flex flex-col gap-[13px] border-b border-line2 p-[18px]">
            <div className="flex flex-wrap items-center gap-[10px]">
              <Bar className="h-[44px] min-w-[240px] flex-1 rounded-[12px]" />
              <Bar className="h-[44px] w-[220px] rounded-[12px]" />
            </div>
            <div className="flex flex-wrap gap-[7px]">
              <Bar className="h-[32px] w-[90px] rounded-full" />
              <Bar className="h-[32px] w-[80px] rounded-full" />
              <Bar className="h-[32px] w-[80px] rounded-full" />
            </div>
          </div>
          {/* table head */}
          <div className="grid grid-cols-[1fr_120px_150px_96px] border-b border-line2 bg-bg px-[18px] py-[11px]">
            {[0, 1, 2, 3].map((i) => (
              <Bar key={i} className="h-[11px] w-[48px]" />
            ))}
          </div>
          {/* rows */}
          <div>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_120px_150px_96px] items-center border-b border-line2 px-[18px] py-3"
              >
                <div className="flex items-center gap-3">
                  <Bar className="h-[38px] w-[38px] rounded-full" />
                  <div className="space-y-2">
                    <Bar className="h-[15px] w-[120px]" />
                    <Bar className="h-[11px] w-[80px]" />
                  </div>
                </div>
                <Bar className="h-[13px] w-[60px]" />
                <Bar className="h-[13px] w-[70px]" />
                <div className="flex justify-end gap-[7px]">
                  <Bar className="h-10 w-10 rounded-[11px]" />
                  <Bar className="h-10 w-10 rounded-[11px]" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* right column */}
        <div className="flex flex-col gap-4">
          <div className={`${card} p-[22px]`}>
            <Bar className="h-[17px] w-[160px]" />
            <div className="mt-2">
              <Bar className="h-[12px] w-[200px] max-w-full" />
            </div>
            <div className="mt-4 space-y-3">
              <Bar className="h-[34px] w-full rounded-[10px]" />
              <Bar className="h-[34px] w-full rounded-[10px]" />
            </div>
          </div>
          <div className={`${card} p-[22px]`}>
            <Bar className="h-[17px] w-[150px]" />
            <div className="mt-4 space-y-[15px]">
              {[0, 1, 2].map((i) => (
                <Bar key={i} className="h-[10px] w-full rounded-[6px]" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
