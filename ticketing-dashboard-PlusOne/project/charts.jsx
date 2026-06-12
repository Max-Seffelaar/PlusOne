/* Mainstage HQ — chart components (hand-built SVG, no libraries).
   Each measures its container for crisp rendering and reads the active palette
   from the `pal` prop so the Tweaks accent-theme switch updates charts live. */

// --- responsive measure hook ---
function useMeasure() {
  const ref = React.useRef(null);
  const [w, setW] = React.useState(0);
  React.useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setW(e.contentRect.width);
    });
    ro.observe(ref.current);
    setW(ref.current.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// --- helpers ---
const niceMax = (v) => {
  if (v <= 0) return 10;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * mag;
};
const kfmt = (n) => (n >= 1000 ? (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + "k" : "" + n);
function linePath(pts) {
  return pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
}
// smooth (catmull-rom -> bezier) for nicer curves
function smoothPath(pts) {
  if (pts.length < 3) return linePath(pts);
  let d = "M" + pts[0][0].toFixed(1) + " " + pts[0][1].toFixed(1);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i], p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += "C" + c1x.toFixed(1) + " " + c1y.toFixed(1) + "," + c2x.toFixed(1) + " " + c2y.toFixed(1) + "," + p2[0].toFixed(1) + " " + p2[1].toFixed(1);
  }
  return d;
}

const AX = "rgba(255,255,255,0.40)";
const GRID = "rgba(255,255,255,0.07)";

// ============================================================
// Daily sales area (Verkoop per dag)
// ============================================================
function DailyArea({ data, pal, height = 240, accent = "a1" }) {
  const [ref, w] = useMeasure();
  const padL = 40, padR = 14, padT = 14, padB = 26;
  const iw = Math.max(10, w - padL - padR);
  const ih = height - padT - padB;
  const max = niceMax(Math.max(...data.map((d) => d.sold)) * 1.1);
  const x = (i) => padL + (i / (data.length - 1)) * iw;
  const y = (v) => padT + ih - (v / max) * ih;
  const pts = data.map((d, i) => [x(i), y(d.sold)]);
  const area = (w ? smoothPath(pts) : "") + (w ? ` L${x(data.length - 1).toFixed(1)} ${(padT + ih).toFixed(1)} L${padL} ${(padT + ih).toFixed(1)} Z` : "");
  const peak = data.reduce((a, b) => (b.sold > a.sold ? b : a), data[0]);
  const col = pal[accent];
  const ticks = 4;
  const xlabels = [0, Math.floor(data.length * 0.33), Math.floor(data.length * 0.66), data.length - 1];
  return (
    <div ref={ref} style={{ width: "100%" }}>
      {w > 0 && (
        <svg width={w} height={height} style={{ display: "block", overflow: "visible" }}>
          <defs>
            <linearGradient id={"da-" + accent} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={col} stopOpacity="0.34" />
              <stop offset="100%" stopColor={col} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {Array.from({ length: ticks + 1 }).map((_, i) => {
            const v = (max / ticks) * i;
            return (
              <g key={i}>
                <line x1={padL} y1={y(v)} x2={w - padR} y2={y(v)} stroke={GRID} />
                <text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill={AX} fontFamily="'JetBrains Mono', monospace">{kfmt(v)}</text>
              </g>
            );
          })}
          <path d={area} fill={"url(#da-" + accent + ")"} />
          <path d={smoothPath(pts)} fill="none" stroke={col} strokeWidth="2.4" strokeLinejoin="round" />
          {/* peak marker */}
          <g>
            <line x1={x(peak.i)} y1={y(peak.sold)} x2={x(peak.i)} y2={padT + ih} stroke={col} strokeOpacity="0.4" strokeDasharray="3 3" />
            <circle cx={x(peak.i)} cy={y(peak.sold)} r="4.5" fill={col} stroke="#0e0e14" strokeWidth="2" />
            <text x={x(peak.i)} y={y(peak.sold) - 10} textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff" fontFamily="'JetBrains Mono', monospace">+{peak.sold}</text>
          </g>
          {xlabels.map((i, k) => (
            <text key={k} x={x(i)} y={height - 6} textAnchor={k === 0 ? "start" : k === xlabels.length - 1 ? "end" : "middle"} fontSize="11" fill={AX} fontFamily="'JetBrains Mono', monospace">{data[i].label}</text>
          ))}
        </svg>
      )}
    </div>
  );
}

// ============================================================
// Cumulative comparison: dit jaar vs vorig jaar
// ============================================================
function CompareLines({ data, last, pal, height = 240 }) {
  const [ref, w] = useMeasure();
  const padL = 44, padR = 16, padT = 16, padB = 26;
  const iw = Math.max(10, w - padL - padR);
  const ih = height - padT - padB;
  const max = niceMax(Math.max(data[data.length - 1].cum, last[last.length - 1].cum) * 1.08);
  const x = (i) => padL + (i / (data.length - 1)) * iw;
  const y = (v) => padT + ih - (v / max) * ih;
  const cur = data.map((d, i) => [x(i), y(d.cum)]);
  const ly = last.map((d, i) => [x(i), y(d.cum)]);
  const ticks = 4;
  const c1 = pal.a3, c2 = "rgba(255,255,255,0.42)";
  const xlabels = [0, Math.floor(data.length * 0.5), data.length - 1];
  return (
    <div ref={ref} style={{ width: "100%" }}>
      {w > 0 && (
        <svg width={w} height={height} style={{ display: "block", overflow: "visible" }}>
          {Array.from({ length: ticks + 1 }).map((_, i) => {
            const v = (max / ticks) * i;
            return (
              <g key={i}>
                <line x1={padL} y1={y(v)} x2={w - padR} y2={y(v)} stroke={GRID} />
                <text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill={AX} fontFamily="'JetBrains Mono', monospace">{kfmt(v)}</text>
              </g>
            );
          })}
          <path d={smoothPath(ly)} fill="none" stroke={c2} strokeWidth="2" strokeDasharray="5 4" />
          <path d={smoothPath(cur)} fill="none" stroke={c1} strokeWidth="2.6" strokeLinejoin="round" />
          <circle cx={cur[cur.length - 1][0]} cy={cur[cur.length - 1][1]} r="4.5" fill={c1} stroke="#0e0e14" strokeWidth="2" />
          {xlabels.map((i, k) => (
            <text key={k} x={x(i)} y={height - 6} textAnchor={k === 0 ? "start" : k === xlabels.length - 1 ? "end" : "middle"} fontSize="11" fill={AX} fontFamily="'JetBrains Mono', monospace">{data[i].label}</text>
          ))}
        </svg>
      )}
    </div>
  );
}

// ============================================================
// Horizontal bar list (steden, kanalen, vergelijkbare events)
// ============================================================
function BarList({ items, pal, valueKey = "sold", compareKey, accent = "a1", fmt = (n) => n, maxBars = 99 }) {
  const rows = items.slice(0, maxBars);
  const max = Math.max(...rows.map((r) => Math.max(r[valueKey], compareKey ? r[compareKey] : 0)));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
      {rows.map((r, i) => {
        const col = pal[r.accent || accent];
        const pct = (r[valueKey] / max) * 100;
        const cpct = compareKey ? (r[compareKey] / max) * 100 : null;
        const delta = compareKey ? r[valueKey] - r[compareKey] : null;
        return (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                <span style={{ fontSize: 13, color: "rgba(255,255,255,0.86)", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", fontFamily: "'JetBrains Mono', monospace", marginLeft: 8 }}>{fmt(r[valueKey])}</span>
              </div>
              <div style={{ position: "relative", height: compareKey ? 14 : 8, borderRadius: 6, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
                {compareKey && <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: cpct + "%", background: "rgba(255,255,255,0.14)", borderRadius: 6 }} />}
                <div style={{ position: "absolute", top: compareKey ? 3 : 0, left: 0, height: compareKey ? 8 : "100%", width: pct + "%", background: col, borderRadius: 6, boxShadow: "0 0 12px " + col + "55" }} />
              </div>
            </div>
            {compareKey && (
              <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: delta >= 0 ? pal.a2 : pal.a1, width: 46, textAlign: "right" }}>
                {delta >= 0 ? "+" : ""}{fmt(delta)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Donut (ticketsoort verdeling)
// ============================================================
function Donut({ items, pal, size = 180, total, centerLabel, centerSub }) {
  const sum = total || items.reduce((a, b) => a + b.sold, 0);
  const r = size / 2, rin = r * 0.62, cx = r, cy = r;
  let ang = -Math.PI / 2;
  const arcs = items.map((it) => {
    const frac = it.sold / sum;
    const a0 = ang, a1 = ang + frac * Math.PI * 2;
    ang = a1;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad, a) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
    const [x0, y0] = p(r, a0), [x1, y1] = p(r, a1), [x2, y2] = p(rin, a1), [x3, y3] = p(rin, a0);
    const d = `M${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${rin} ${rin} 0 ${large} 0 ${x3} ${y3} Z`;
    return { d, col: pal[it.accent || "a1"], frac };
  });
  return (
    <svg width={size} height={size} style={{ display: "block" }}>
      {arcs.map((a, i) => <path key={i} d={a.d} fill={a.col} stroke="#0e0e14" strokeWidth="2.5" />)}
      {centerLabel && <text x={cx} y={cy - 2} textAnchor="middle" fontSize={size * 0.16} fontWeight="800" fill="#fff" fontFamily="'Space Grotesk', sans-serif">{centerLabel}</text>}
      {centerSub && <text x={cx} y={cy + size * 0.12} textAnchor="middle" fontSize="11" fill={AX} fontFamily="'JetBrains Mono', monospace" letterSpacing="0.05em">{centerSub}</text>}
    </svg>
  );
}

// ============================================================
// Progress ring (capaciteit)
// ============================================================
function Ring({ pct, pal, size = 92, stroke = 9, accent = "a2", label }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const col = pal[accent];
  return (
    <svg width={size} height={size}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - pct)} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ filter: "drop-shadow(0 0 6px " + col + "66)" }} />
      <text x={size / 2} y={size / 2 + 1} textAnchor="middle" fontSize={size * 0.24} fontWeight="800" fill="#fff" fontFamily="'Space Grotesk', sans-serif">{Math.round(pct * 100)}<tspan fontSize={size * 0.14}>%</tspan></text>
      {label && <text x={size / 2} y={size / 2 + size * 0.2} textAnchor="middle" fontSize="9.5" fill={AX} fontFamily="'JetBrains Mono', monospace">{label}</text>}
    </svg>
  );
}

// ============================================================
// Scan progress / opkomst per uur (area with 'now' pointer)
// ============================================================
function ScanProgress({ data, nowIndex, pal, height = 200, accent = "a1", capLabel }) {
  const [ref, w] = useMeasure();
  const padL = 42, padR = 14, padT = 16, padB = 24;
  const iw = Math.max(10, w - padL - padR);
  const ih = height - padT - padB;
  const max = niceMax(Math.max(...data.map((d) => d.in)) * 1.05);
  const x = (i) => padL + (i / (data.length - 1)) * iw;
  const y = (v) => padT + ih - (v / max) * ih;
  const col = pal[accent];
  const livePts = data.slice(0, nowIndex + 1).map((d, i) => [x(i), y(d.in)]);
  const futPts = data.slice(nowIndex).map((d, i) => [x(i + nowIndex), y(d.in)]);
  const area = (w ? smoothPath(livePts) : "") + (w ? ` L${x(nowIndex).toFixed(1)} ${(padT + ih).toFixed(1)} L${padL} ${(padT + ih).toFixed(1)} Z` : "");
  const ticks = 3;
  return (
    <div ref={ref} style={{ width: "100%" }}>
      {w > 0 && (
        <svg width={w} height={height} style={{ display: "block", overflow: "visible" }}>
          <defs>
            <linearGradient id={"sc-" + accent} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={col} stopOpacity="0.4" />
              <stop offset="100%" stopColor={col} stopOpacity="0.03" />
            </linearGradient>
          </defs>
          {Array.from({ length: ticks + 1 }).map((_, i) => {
            const v = (max / ticks) * i;
            return (<g key={i}><line x1={padL} y1={y(v)} x2={w - padR} y2={y(v)} stroke={GRID} /><text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill={AX} fontFamily="'JetBrains Mono', monospace">{kfmt(v)}</text></g>);
          })}
          <path d={area} fill={"url(#sc-" + accent + ")"} />
          <path d={smoothPath(livePts)} fill="none" stroke={col} strokeWidth="2.6" />
          <path d={smoothPath(futPts)} fill="none" stroke={col} strokeWidth="2" strokeDasharray="4 4" strokeOpacity="0.45" />
          <circle cx={x(nowIndex)} cy={y(data[nowIndex].in)} r="5" fill={col} stroke="#0e0e14" strokeWidth="2" />
          <circle cx={x(nowIndex)} cy={y(data[nowIndex].in)} r="9" fill="none" stroke={col} strokeOpacity="0.5">
            <animate attributeName="r" values="6;13;6" dur="2s" repeatCount="indefinite" />
            <animate attributeName="stroke-opacity" values="0.6;0;0.6" dur="2s" repeatCount="indefinite" />
          </circle>
          {data.map((d, i) => (i % 2 === 0 ? <text key={i} x={x(i)} y={height - 6} textAnchor="middle" fontSize="10" fill={AX} fontFamily="'JetBrains Mono', monospace">{d.hour}</text> : null))}
        </svg>
      )}
    </div>
  );
}

// ============================================================
// Forecast chart: actuals + predicted continuation + confidence band
// ============================================================
function ForecastChart({ curve, pal, height = 260, capacity }) {
  const [ref, w] = useMeasure();
  const padL = 46, padR = 18, padT = 18, padB = 28;
  const iw = Math.max(10, w - padL - padR);
  const ih = height - padT - padB;
  const max = niceMax(Math.max(capacity, ...curve.map((p) => p.high || p.predicted)) * 1.02);
  const x = (i) => padL + (i / (curve.length - 1)) * iw;
  const y = (v) => padT + ih - (v / max) * ih;
  const col = pal.a4, act = pal.a3;
  const actualPts = curve.filter((p) => p.actual != null).map((p) => [x(p.d), y(p.actual)]);
  const predPts = curve.filter((p) => p.predicted != null && p.d >= (actualPts.length - 1)).map((p) => [x(p.d), y(p.predicted)]);
  const bandTop = curve.filter((p) => p.high != null).map((p) => [x(p.d), y(p.high)]);
  const bandBot = curve.filter((p) => p.low != null).map((p) => [x(p.d), y(p.low)]).reverse();
  const bandPath = w ? linePath(bandTop) + " " + bandBot.map((p) => "L" + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ") + " Z" : "";
  const ticks = 4;
  const capY = y(capacity);
  return (
    <div ref={ref} style={{ width: "100%" }}>
      {w > 0 && (
        <svg width={w} height={height} style={{ display: "block", overflow: "visible" }}>
          {Array.from({ length: ticks + 1 }).map((_, i) => {
            const v = (max / ticks) * i;
            return (<g key={i}><line x1={padL} y1={y(v)} x2={w - padR} y2={y(v)} stroke={GRID} /><text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill={AX} fontFamily="'JetBrains Mono', monospace">{kfmt(v)}</text></g>);
          })}
          {/* capacity line */}
          <line x1={padL} y1={capY} x2={w - padR} y2={capY} stroke={pal.a1} strokeOpacity="0.6" strokeDasharray="6 4" />
          <text x={w - padR} y={capY - 6} textAnchor="end" fontSize="10.5" fill={pal.a1} fontFamily="'JetBrains Mono', monospace" fontWeight="700">CAPACITEIT {kfmt(capacity)}</text>
          <path d={bandPath} fill={col} fillOpacity="0.16" />
          <path d={smoothPath(actualPts)} fill="none" stroke={act} strokeWidth="2.8" />
          <path d={smoothPath(predPts)} fill="none" stroke={col} strokeWidth="2.6" strokeDasharray="2 5" strokeLinecap="round" />
          <circle cx={actualPts[actualPts.length - 1][0]} cy={actualPts[actualPts.length - 1][1]} r="5" fill={act} stroke="#0e0e14" strokeWidth="2" />
          <circle cx={predPts[predPts.length - 1][0]} cy={predPts[predPts.length - 1][1]} r="5" fill={col} stroke="#0e0e14" strokeWidth="2" />
          <text x={padL} y={height - 8} textAnchor="start" fontSize="10.5" fill={AX} fontFamily="'JetBrains Mono', monospace">on-sale</text>
          <text x={actualPts[actualPts.length - 1][0]} y={height - 8} textAnchor="middle" fontSize="10.5" fill={act} fontFamily="'JetBrains Mono', monospace" fontWeight="700">nu</text>
          <text x={w - padR} y={height - 8} textAnchor="end" fontSize="10.5" fill={col} fontFamily="'JetBrains Mono', monospace" fontWeight="700">eventdag</text>
        </svg>
      )}
    </div>
  );
}

// ============================================================
// Sparkline (mini trend for portfolio cards / KPIs)
// ============================================================
function Sparkline({ data, color, width = 96, height = 30, fill = true }) {
  const max = Math.max(...data), min = Math.min(...data);
  const rng = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * width, height - 3 - ((v - min) / rng) * (height - 6)]);
  const id = "sp" + Math.round(width) + color.replace(/[^a-z0-9]/gi, "");
  return (
    <svg width={width} height={height} style={{ display: "block", overflow: "visible" }}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.3" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      {fill && <path d={smoothPath(pts) + ` L${width} ${height} L0 ${height} Z`} fill={"url(#" + id + ")"} />}
      <path d={smoothPath(pts)} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

Object.assign(window, { useMeasure, DailyArea, CompareLines, BarList, Donut, Ring, ScanProgress, ForecastChart, Sparkline });
