/* Gastenlijst wireframe kit — shared tokens + primitives. Futuristic-blueprint style:
   dark ink, structural outlines, mono micro-labels, one controlled accent set. */

const GL = {
  ink: "#0b0b11", device: "#111119", panel: "#171721", panel2: "#1d1d28",
  line: "rgba(255,255,255,0.09)", line2: "rgba(255,255,255,0.055)",
  text: "#ffffff", dim: "rgba(255,255,255,0.55)", faint: "rgba(255,255,255,0.34)",
  primary: "#FF5D73", cyan: "#46D5E6", green: "#5BE08A", amber: "#FFB14E", violet: "#A98BFF",
  mono: "'JetBrains Mono', monospace", disp: "'Space Grotesk', sans-serif", body: "'Hanken Grotesk', sans-serif",
};

const GLI = {
  search: "M11 11m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0M20 20l-4.3-4.3",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.6-6 8-6s8 2 8 6",
  users: "M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11zM2.5 20c0-3.4 2.9-5.4 6.5-5.4s6.5 2 6.5 5.4M16 5.2a3 3 0 0 1 0 5.8M18 14.6c2.3.5 3.7 2.1 3.7 4.4",
  check: "M5 12l5 5 9-11",
  checkc: "M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M8 12l2.5 2.5L16 9",
  plus: "M12 5v14M5 12h14", minus: "M5 12h14",
  crown: "M4 18h16M4 18l-1.5-9 5 4 4.5-7 4.5 7 5-4L20 18",
  star: "M12 3l2.6 5.6 6.1.8-4.5 4.2 1.2 6L12 17l-5.4 2.8 1.2-6L3.3 9.4l6.1-.8z",
  ticket: "M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H5a2 2 0 0 1-2-2 2 2 0 0 0 0-4zM14 6v12",
  note: "M5 4h11l4 4v12H5zM15 4v5h5M8 13h8M8 17h6",
  money: "M3 6h18v12H3zM12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0",
  phone: "M7 3h10v18H7zM10 18h4",
  upload: "M12 16V4M7 9l5-5 5 5M5 20h14",
  paste: "M9 4h6v3H9zM7 5H5v16h14V5h-2M9 12h6M9 16h4",
  bell: "M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6M9.5 20a2.5 2.5 0 0 0 5 0",
  shield: "M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z",
  x: "M6 6l12 12M18 6L6 18", chevR: "M9 6l6 6-6 6", chevD: "M6 9l6 6 6-6",
  dots: "M5 12h.01M12 12h.01M19 12h.01", grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  arrowR: "M5 12h14M13 6l6 6-6 6", clock: "M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 7v5l3 2",
  share: "M12 15V3M8 7l4-4 4 4M4 13v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6",
  filter: "M3 5h18l-7 8v6l-4 2v-8z", contact: "M4 5h16v14H4zM8 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 17c0-2 1.5-3 3-3s3 1 3 3M15 9h3M15 13h3",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z",
};
function GIcon({ name, size = 18, stroke = 1.7, color = "currentColor", fill = "none" }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", flexShrink: 0 }}><path d={GLI[name]} /></svg>;
}

function Avatar({ name, accent = GL.cyan, size = 38, ring }) {
  const init = name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
  return <div style={{ width: size, height: size, borderRadius: 999, flexShrink: 0, background: accent + "22", color: accent, border: ring ? "1.5px solid " + accent : "1px dashed " + accent + "66", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.36, fontWeight: 700, fontFamily: GL.disp }}>{init}</div>;
}

function Tag({ label, color = GL.dim, icon, solid, style }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 700, fontFamily: GL.mono, letterSpacing: "0.02em", padding: "3px 8px", borderRadius: 7, whiteSpace: "nowrap", color: solid ? GL.ink : color, background: solid ? color : color + "1e", ...style }}>{icon && <GIcon name={icon} size={11} stroke={2.2} color={solid ? GL.ink : color} />}{label}</span>;
}

const ROLE = { VIP: { c: "#FFB14E", icon: "crown" }, "All Access": { c: "#A98BFF", icon: "shield" }, Artist: { c: "#46D5E6", icon: "star" }, Gast: { c: "rgba(255,255,255,0.5)", icon: "user" }, Crew: { c: "#5BE08A", icon: "users" }, Pers: { c: "#46D5E6", icon: "note" } };
function RoleTag({ role }) { const m = ROLE[role] || ROLE.Gast; return <Tag label={role.toUpperCase()} color={m.c} icon={m.icon} />; }

function PayTag({ status }) {
  if (status === "paid") return <Tag label="BETAALD" color={GL.green} icon="check" />;
  if (status === "pay") return <Tag label="MOET BETALEN" color={GL.amber} icon="money" />;
  return <Tag label="GRATIS" color="rgba(255,255,255,0.4)" />;
}
function StatusTag({ status, big }) {
  if (status === "in") return <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: big ? 12 : 11, fontWeight: 700, fontFamily: GL.mono, color: GL.green }}><GIcon name="checkc" size={big ? 16 : 13} color={GL.green} stroke={2} />BINNEN</span>;
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: big ? 12 : 11, fontWeight: 700, fontFamily: GL.mono, color: GL.cyan }}><span style={{ width: 7, height: 7, borderRadius: 99, border: "2px solid " + GL.cyan }} />ONDERWEG</span>;
}

function Btn({ children, kind = "ghost", sm, icon, onClick, full, style }) {
  const base = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, cursor: "pointer", fontFamily: GL.disp, fontWeight: 700, borderRadius: 10, fontSize: sm ? 12.5 : 14, padding: sm ? "7px 12px" : "11px 18px", width: full ? "100%" : "auto", transition: "all .14s", border: "1px solid transparent" };
  const kinds = {
    primary: { background: GL.primary, color: GL.ink, border: "1px solid " + GL.primary },
    green: { background: GL.green, color: GL.ink, border: "1px solid " + GL.green },
    ghost: { background: "rgba(255,255,255,0.04)", color: GL.text, border: "1px solid " + GL.line },
    dash: { background: "transparent", color: GL.dim, border: "1.5px dashed " + GL.line },
  };
  return <button className="glbtn" onClick={onClick} style={{ ...base, ...kinds[kind], ...style }}>{icon && <GIcon name={icon} size={sm ? 14 : 16} stroke={2.1} />}{children}</button>;
}

function Field({ placeholder, icon, value, onChange, big, mono, style }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 10, background: GL.device, border: "1px solid " + GL.line, borderRadius: 11, padding: big ? "13px 16px" : "9px 13px", ...style }}>
    {icon && <span style={{ color: GL.faint }}><GIcon name={icon} size={big ? 22 : 16} /></span>}
    {onChange != null
      ? <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", color: GL.text, fontSize: big ? 18 : 14, fontFamily: mono ? GL.mono : GL.body }} />
      : <span style={{ flex: 1, color: value ? GL.text : GL.faint, fontSize: big ? 18 : 14, fontFamily: mono ? GL.mono : GL.body }}>{value || placeholder}</span>}
  </div>;
}

// companion stepper (interactive)
function Stepper({ value, onChange, label = "+ gasten" }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
    <button className="glbtn" onClick={() => onChange(Math.max(0, value - 1))} style={stepBtn}><GIcon name="minus" size={18} stroke={2.4} /></button>
    <div style={{ textAlign: "center", minWidth: 56 }}>
      <div style={{ fontFamily: GL.disp, fontWeight: 700, fontSize: 26, color: GL.text, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, color: GL.faint, fontFamily: GL.mono, marginTop: 2 }}>{label}</div>
    </div>
    <button className="glbtn" onClick={() => onChange(value + 1)} style={stepBtn}><GIcon name="plus" size={18} stroke={2.4} /></button>
  </div>;
}
const stepBtn = { width: 42, height: 42, borderRadius: 11, border: "1px solid " + GL.line, background: "rgba(255,255,255,0.04)", color: GL.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" };

// section label inside a screen (wireframe micro-heading)
function Lbl({ children, color = GL.faint, style }) {
  return <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.12em", color, fontFamily: GL.mono, textTransform: "uppercase", ...style }}>{children}</div>;
}

// tablet device frame
function Tablet({ children, title }) {
  return <div style={{ width: "100%", height: "100%", background: GL.ink, borderRadius: 22, border: "1px solid " + GL.line, overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "inset 0 0 0 7px #06060a" }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 18px", fontFamily: GL.mono, fontSize: 11, color: GL.faint, borderBottom: "1px solid " + GL.line2 }}>
      <span>{title}</span>
      <span style={{ display: "flex", gap: 7, alignItems: "center" }}><GIcon name="phone" size={12} color={GL.faint} />21:14 · entree · tablet</span>
    </div>
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>{children}</div>
  </div>;
}

// desktop window chrome
function Win({ children, title }) {
  return <div style={{ width: "100%", height: "100%", background: GL.ink, borderRadius: 16, border: "1px solid " + GL.line, overflow: "hidden", display: "flex", flexDirection: "column" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: "1px solid " + GL.line2, background: GL.device }}>
      <div style={{ display: "flex", gap: 6 }}>{["#FF5D73", "#FFB14E", "#5BE08A"].map((c) => <span key={c} style={{ width: 10, height: 10, borderRadius: 99, background: c, opacity: 0.85 }} />)}</div>
      <span style={{ fontFamily: GL.mono, fontSize: 11.5, color: GL.faint, marginLeft: 6 }}>{title}</span>
    </div>
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>{children}</div>
  </div>;
}

Object.assign(window, { GL, GLI, GIcon, Avatar, Tag, RoleTag, PayTag, StatusTag, Btn, Field, Stepper, Lbl, Tablet, Win, ROLE, stepBtn });
