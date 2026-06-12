/* Mainstage HQ — UI primitives + shell (sidebar, topbar, KPI cards, panels). */

// ---------- icons (simple geometric strokes) ----------
const ICONS = {
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  pulse: "M3 13h3l2.5-7 4 14 3-9 2 2h3.5",
  users: "M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11zM2.5 20c0-3.4 2.9-5.4 6.5-5.4s6.5 2 6.5 5.4M16 5.2a3 3 0 0 1 0 5.8M18 14.6c2.3.5 3.7 2.1 3.7 4.4",
  forecast: "M3 17l5-5 3.5 3.5L20 8M20 8h-4M20 8v4",
  plug: "M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0zM12 16v5",
  search: "M11 11m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0M20 20l-4.3-4.3",
  bell: "M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6M9.5 20a2.5 2.5 0 0 0 5 0",
  chevron: "M6 9l6 6 6-6",
  bolt: "M13 2L4 14h6l-1 8 9-12h-6z",
  filter: "M3 5h18l-7 8v6l-4 2v-8z",
  download: "M12 3v12M7 11l5 4 5-4M4 20h16",
  check: "M5 12l5 5 9-11",
  dot: "M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0",
  arrowUp: "M12 19V5M6 11l6-6 6 6",
  ext: "M14 4h6v6M20 4l-9 9M18 14v5H5V6h5",
  pin: "M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11zM12 10m-2.4 0a2.4 2.4 0 1 0 4.8 0a2.4 2.4 0 1 0-4.8 0",
  calendar: "M3 6h18v15H3zM3 10h18M8 3v4M16 3v4",
  ticket: "M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H5a2 2 0 0 1-2-2 2 2 0 0 0 0-4zM14 6v12",
};
function Icon({ name, size = 18, stroke = 1.8, color = "currentColor", fill = "none" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", flexShrink: 0 }}>
      <path d={ICONS[name]} />
    </svg>
  );
}

// ---------- brand logo ----------
function Logo({ pal, compact }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
      <div style={{ position: "relative", width: 34, height: 34, flexShrink: 0 }}>
        <svg width="34" height="34" viewBox="0 0 34 34">
          <rect x="2" y="2" width="30" height="30" rx="9" fill="#15151d" stroke="rgba(255,255,255,0.08)" />
          {[0, 1, 2, 3].map((i) => {
            const cols = [pal.a1, pal.a5, pal.a2, pal.a3];
            const hs = [10, 18, 13, 8];
            return <rect key={i} x={8 + i * 5} y={24 - hs[i]} width="3.2" height={hs[i]} rx="1.6" fill={cols[i]} />;
          })}
        </svg>
      </div>
      {!compact && (
        <div style={{ lineHeight: 1.05 }}>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 16, letterSpacing: "-0.01em", color: "#fff" }}>Mainstage<span style={{ color: pal.a1 }}> HQ</span></div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.08em", marginTop: 1 }}>EVENT CONTROL</div>
        </div>
      )}
    </div>
  );
}

// ---------- panel / card ----------
function Card({ title, sub, accent, pal, action, children, style, bodyStyle, noPad }) {
  return (
    <section style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 18, display: "flex", flexDirection: "column", minWidth: 0, ...style }}>
      {(title || action) && (
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "16px 18px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            {accent && <span style={{ width: 4, height: 17, borderRadius: 4, background: pal[accent], boxShadow: "0 0 8px " + pal[accent] + "88", flexShrink: 0 }} />}
            <div style={{ minWidth: 0 }}>
              <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 600, color: "#fff", letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</h3>
              {sub && <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.42)", marginTop: 2 }}>{sub}</div>}
            </div>
          </div>
          {action}
        </header>
      )}
      <div style={{ padding: noPad ? 0 : "0 18px 18px", flex: 1, minWidth: 0, ...bodyStyle }}>{children}</div>
    </section>
  );
}

// ---------- badge / pill ----------
function Badge({ children, color, bg, style }) {
  return <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 999, color: color || "#fff", background: bg || "rgba(255,255,255,0.08)", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.02em", whiteSpace: "nowrap", ...style }}>{children}</span>;
}

const STATUS_MAP = {
  live: { label: "VERKOOP LOOPT", c: "a2" },
  selling: { label: "VERKOOP LOOPT", c: "a2" },
  announce: { label: "AANGEKONDIGD", c: "a3" },
  done: { label: "AFGEROND", c: null },
};
function StatusPill({ status, statusLabel, pal, live }) {
  if (live || status === "live-now") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, padding: "3px 9px 3px 7px", borderRadius: 999, color: pal.a1, background: pal.a1 + "1f", fontFamily: "'JetBrains Mono', monospace" }}>
        <span style={{ position: "relative", display: "inline-flex" }}>
          <span style={{ width: 7, height: 7, borderRadius: 99, background: pal.a1, display: "block" }} />
          <span className="ping" style={{ position: "absolute", inset: 0, borderRadius: 99, background: pal.a1 }} />
        </span>
        LIVE
      </span>
    );
  }
  const m = STATUS_MAP[status] || { label: statusLabel || status, c: "a3" };
  const col = m.c ? pal[m.c] : "rgba(255,255,255,0.5)";
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, color: col, background: (m.c ? col : "#ffffff") + "1c", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.02em" }}>
    <span style={{ width: 6, height: 6, borderRadius: 99, background: col }} />{m.label}
  </span>;
}

// ---------- KPI card ----------
function Kpi({ label, value, unit, sub, accent, pal, spark, trend, big, icon }) {
  const col = pal[accent] || pal.a1;
  return (
    <div className="kpi" style={{ position: "relative", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: big ? "18px 20px" : "15px 16px", overflow: "hidden", minWidth: 0 }}>
      <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 3, background: col, opacity: 0.9 }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'JetBrains Mono', monospace" }}>{label}</span>
        {icon && <span style={{ color: col, opacity: 0.9 }}><Icon name={icon} size={16} /></span>}
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, marginTop: 9 }}>
        <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: big ? 34 : 27, color: "#fff", letterSpacing: "-0.02em", lineHeight: 1 }}>{value}{unit && <span style={{ fontSize: big ? 18 : 15, color: "rgba(255,255,255,0.55)", marginLeft: 2 }}>{unit}</span>}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 9 }}>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
          {trend != null && <span style={{ color: trend >= 0 ? pal.a2 : pal.a1, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{trend >= 0 ? "▲ " : "▼ "}{Math.abs(trend)}% </span>}
          {sub}
        </span>
        {spark && <Sparkline data={spark} color={col} width={64} height={24} />}
      </div>
    </div>
  );
}

// ---------- sidebar ----------
const NAV = [
  { id: "portfolio", label: "Portfolio", icon: "grid" },
  { id: "overzicht", label: "Overzicht", icon: "pulse" },
  { id: "gastenlijst", label: "Gastenlijst", icon: "users" },
  { id: "prognose", label: "Prognose", icon: "forecast" },
  { id: "bronnen", label: "Bronnen", icon: "plug" },
];
function Sidebar({ active, onNav, pal, event }) {
  return (
    <aside style={{ width: 232, flexShrink: 0, background: "var(--rail)", borderRight: "1px solid var(--line)", display: "flex", flexDirection: "column", padding: "20px 16px", gap: 22, position: "sticky", top: 0, height: "100vh" }}>
      <div style={{ padding: "0 4px" }}><Logo pal={pal} /></div>

      <nav style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.12em", padding: "0 10px 6px", fontFamily: "'JetBrains Mono', monospace" }}>NAVIGATIE</div>
        {NAV.map((n) => {
          const on = active === n.id;
          return (
            <button key={n.id} onClick={() => onNav(n.id)} className="navbtn" style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 11px", borderRadius: 11, border: "none", cursor: "pointer", textAlign: "left", background: on ? "var(--nav-on)" : "transparent", color: on ? "#fff" : "rgba(255,255,255,0.6)", fontSize: 14, fontWeight: on ? 600 : 500, transition: "background .15s, color .15s", position: "relative" }}>
              {on && <span style={{ position: "absolute", left: -16, top: "50%", transform: "translateY(-50%)", width: 3, height: 20, borderRadius: 3, background: pal.a1, boxShadow: "0 0 8px " + pal.a1 }} />}
              <Icon name={n.icon} size={18} color={on ? pal.a1 : "currentColor"} />
              {n.label}
            </button>
          );
        })}
      </nav>

      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, padding: "13px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 9 }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: pal.a2, boxShadow: "0 0 7px " + pal.a2 }} />
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>3 BRONNEN LIVE</span>
          </div>
          <div style={{ display: "flex", gap: 5 }}>
            {["Eventix", "POS", "Scans"].map((s, i) => (
              <span key={s} style={{ flex: 1, textAlign: "center", fontSize: 9.5, padding: "4px 0", borderRadius: 6, background: pal[["a3", "a2", "a1"][i]] + "22", color: pal[["a3", "a2", "a1"][i]], fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{s}</span>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 6px" }}>
          <div style={{ width: 30, height: 30, borderRadius: 99, background: "linear-gradient(135deg," + pal.a4 + "," + pal.a1 + ")", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#fff", fontFamily: "'Space Grotesk', sans-serif" }}>MS</div>
          <div style={{ lineHeight: 1.1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, color: "#fff", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Max Seffelaar</div>
            <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.4)" }}>Organisator</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

// ---------- topbar with event selector ----------
function Topbar({ event, portfolio, onSelectEvent, pal, clock, tab }) {
  const [open, setOpen] = React.useState(false);
  const TAB_TITLES = { portfolio: "Portfolio", overzicht: "Overzicht", gastenlijst: "Gastenlijst", prognose: "Prognose", bronnen: "Bronnen & integraties" };
  return (
    <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "16px 26px", borderBottom: "1px solid var(--line)", position: "sticky", top: 0, zIndex: 30, background: "var(--topbar)", backdropFilter: "blur(14px)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
        {tab === "portfolio" ? (
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#fff", fontFamily: "'Space Grotesk', sans-serif", letterSpacing: "-0.01em" }}>Alle events</h1>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginTop: 2 }}>{portfolio.length} events · seizoen 2026</div>
          </div>
        ) : (
          <div style={{ position: "relative" }}>
            <button onClick={() => setOpen((o) => !o)} className="evsel" style={{ display: "flex", alignItems: "center", gap: 13, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 13, padding: "8px 12px 8px 10px", cursor: "pointer" }}>
              <span style={{ width: 36, height: 36, borderRadius: 9, background: "linear-gradient(135deg," + pal[event.accent || "a1"] + "55,#15151d)", border: "1px solid " + pal[event.accent || "a1"] + "55", display: "flex", alignItems: "center", justifyContent: "center", color: pal[event.accent || "a1"] }}><Icon name="ticket" size={18} /></span>
              <span style={{ textAlign: "left", lineHeight: 1.15 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "#fff", fontFamily: "'Space Grotesk', sans-serif", whiteSpace: "nowrap" }}>{event.name}</span>
                  <span style={{ color: "rgba(255,255,255,0.4)" }}><Icon name="chevron" size={15} /></span>
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "rgba(255,255,255,0.45)", marginTop: 1, whiteSpace: "nowrap" }}>
                  <Icon name="pin" size={12} />{event.venue} · {event.dateLabel}
                </span>
              </span>
            </button>
            {open && (
              <>
                <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                <div style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, width: 340, background: "var(--pop)", border: "1px solid var(--line)", borderRadius: 14, padding: 8, zIndex: 50, boxShadow: "0 24px 60px rgba(0,0,0,0.55)" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em", padding: "6px 10px", fontFamily: "'JetBrains Mono', monospace" }}>WISSEL EVENT</div>
                  {portfolio.map((p) => (
                    <button key={p.id} onClick={() => { onSelectEvent(p.id); setOpen(false); }} className="evrow" style={{ width: "100%", display: "flex", alignItems: "center", gap: 11, padding: "9px 10px", borderRadius: 10, border: "none", background: p.id === event.id ? "rgba(255,255,255,0.06)" : "transparent", cursor: "pointer", textAlign: "left" }}>
                      <span style={{ width: 9, height: 9, borderRadius: 99, background: pal[p.accent || "a1"], flexShrink: 0 }} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 13.5, color: "#fff", fontWeight: 600, display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{p.venue} · {p.dateLabel}</span>
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.55)", fontFamily: "'JetBrains Mono', monospace" }}>{Math.round((p.sold / p.capacity) * 100)}%</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderRadius: 11, background: "var(--surface)", border: "1px solid var(--line)" }}>
          <span style={{ width: 7, height: 7, borderRadius: 99, background: pal.a2, boxShadow: "0 0 7px " + pal.a2 }} />
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", fontFamily: "'JetBrains Mono', monospace" }}>Sync 2m</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderRadius: 11, background: "var(--surface)", border: "1px solid var(--line)", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: "#fff", fontWeight: 600 }}>
          <Icon name="dot" size={9} color={pal.a1} fill={pal.a1} />{clock}
        </div>
        <button className="iconbtn" style={iconBtnStyle}><Icon name="search" size={18} /></button>
        <button className="iconbtn" style={iconBtnStyle}><Icon name="bell" size={18} /></button>
        <button style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", borderRadius: 11, border: "none", background: pal.a1, color: "#15151d", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif" }}><Icon name="download" size={16} stroke={2.2} />Export</button>
      </div>
    </header>
  );
}
const iconBtnStyle = { width: 38, height: 38, borderRadius: 11, border: "1px solid var(--line)", background: "var(--surface)", color: "rgba(255,255,255,0.6)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" };

Object.assign(window, { Icon, Logo, Card, Badge, StatusPill, Kpi, Sidebar, Topbar, NAV });
