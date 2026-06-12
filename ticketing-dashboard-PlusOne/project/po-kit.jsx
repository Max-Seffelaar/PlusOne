/* PLUSONE kit — tokens + primitives. High-contrast dark, one lavender accent, warm grotesk. */

const P = {
  bg: "#0B0B0D", elev: "#161618", elev2: "#1E1E21", line: "rgba(255,255,255,0.10)", line2: "rgba(255,255,255,0.06)",
  text: "#FFFFFF", dim: "rgba(255,255,255,0.58)", faint: "rgba(255,255,255,0.40)", ghost: "rgba(255,255,255,0.26)",
  acc: "#B5A6FF", accSoft: "#C9BEFF", accDim: "rgba(181,166,255,0.16)", onAcc: "#16132B",
  disp: "'Bricolage Grotesque', sans-serif", body: "'Hanken Grotesk', system-ui, sans-serif",
};

const PI = {
  back: "M15 5l-7 7 7 7", close: "M6 6l12 12M18 6L6 18", search: "M11 11m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0M20 20l-3.8-3.8",
  plus: "M12 5v14M5 12h14", minus: "M5 12h14", check: "M5 12l5 5 9-11",
  chev: "M9 6l6 6-6 6", chevD: "M6 9l6 6 6-6", dots: "M5 12h.01M12 12h.01M19 12h.01", share: "M14 4h6v6M20 4l-9 9M18 13v6H5V6h6",
  cal: "M4 7h16v13H4zM4 11h16M8 4v4M16 4v4", users: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3.3 2.7-5 6-5s6 1.7 6 5M16 5.4a3 3 0 0 1 0 5.6M18 15c2.2.4 3.6 1.9 3.6 4",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.6-6 8-6s8 2 8 6",
  ticket: "M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H6a2 2 0 0 1-2-2 2 2 0 0 0 0-4zM14 6v12",
  star: "M12 3l2.5 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.5 6.8 19.2l1.1-5.9L3.6 9.2l5.9-.8z",
  crown: "M4 18h16M4 18l-1.3-8 4.6 3.4L12 6l4.7 7.4L21 10l-1.3 8", note: "M5 4h10l4 4v12H5zM14 4v5h5M8 13h7M8 16h5",
  money: "M3 6h18v12H3zM12 12m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0", bell: "M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6M9.5 20a2.5 2.5 0 0 0 5 0",
  shield: "M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z", clock: "M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 7v5l3 2",
  paste: "M9 4h6v3H9zM7 5H5v16h14V5h-2M9 12h6M9 16h4", contact: "M4 5h16v14H4zM8 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 16c0-1.6 1.3-2.6 3-2.6s3 1 3 2.6", upload: "M12 15V4M8 8l4-4 4 4M5 19h14",
  cog: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l1.6-1-1.5-2.6-1.8.6-1.5-1-.3-1.9h-3l-.3 1.9-1.5 1-1.8-.6L5 9l1.6 1L6.6 12 5 13l1.5 2.6 1.8-.6 1.5 1 .3 1.9h3l.3-1.9 1.5-1 1.8.6L20.6 13z",
  building: "M5 21V4h9v17M14 9h5v12M8 8h2M8 12h2M8 16h2M18 13h0M18 17h0", arrowR: "M5 12h14M13 6l6 6-6 6", grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  flag: "M5 21V4M5 4c3-2 6 2 9 0s5-1 5-1v9s-2 1-5 1-6-2-9 0", check2: "M4 12l5 5L20 6", warn: "M12 3l9 16H3zM12 9v5M12 17h0", history: "M3 12a9 9 0 1 0 3-6.7L3 8M3 4v4h4M12 8v4l3 2",
  spark: "M12 3l1.7 5L19 9.7 14 11.4 12 16l-1.7-4.6L5 9.7 10.3 8z", logo: "M12 4v16M4 12h16",
};
function I({ d, size = 22, sw = 1.9, c = "currentColor", fill = "none" }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", flexShrink: 0 }}><path d={PI[d]} /></svg>;
}

const ROLES = { VIP: PI.crown, "All Access": PI.shield, Artist: PI.star, Pers: PI.note, Crew: PI.users, Gast: PI.user };
function initials(n) { return n.split(" ").map((x) => x[0]).slice(0, 2).join("").toUpperCase(); }

function Avatar({ name, size = 44, accent }) {
  return <div style={{ width: size, height: size, borderRadius: size * 0.32, flexShrink: 0, background: accent ? P.acc : P.elev2, color: accent ? P.onAcc : P.text, border: "1px solid " + (accent ? "transparent" : P.line), display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.34, fontWeight: 700, fontFamily: P.disp, letterSpacing: "-0.02em" }}>{initials(name)}</div>;
}

function Pill({ children, on, icon, style }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, padding: "5px 10px", borderRadius: 999, fontFamily: P.body, whiteSpace: "nowrap", color: on ? P.text : P.dim, background: "transparent", border: "1px solid " + (on ? P.line : P.line2), ...style }}>{icon && <I d={icon} size={12} sw={2} />}{children}</span>;
}

function RoleChip({ role }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", padding: "3px 8px", borderRadius: 7, fontFamily: P.body, color: role === "Gast" ? P.faint : P.text, background: P.elev2, border: "1px solid " + P.line }}><I d={ROLES[role] || PI.user} size={11} sw={2} c={role === "Gast" ? P.faint : P.accSoft} />{role.toUpperCase()}</span>;
}

function StatusDot({ status, label }) {
  const inn = status === "in";
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, fontFamily: P.body, color: inn ? P.acc : P.faint }}>
    {inn ? <span style={{ width: 17, height: 17, borderRadius: 99, background: P.acc, display: "flex", alignItems: "center", justifyContent: "center" }}><I d="check" size={11} sw={3} c={P.onAcc} /></span> : <span style={{ width: 15, height: 15, borderRadius: 99, border: "2px solid " + P.ghost }} />}
    {label !== false && (inn ? "Binnen" : "Onderweg")}
  </span>;
}

function PayChip({ pay }) {
  if (pay === "pay") return <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 7, fontFamily: P.body, color: P.text, border: "1px dashed " + P.line, letterSpacing: "0.02em" }}>€ MOET BETALEN</span>;
  return null;
}

function Btn({ children, kind = "primary", icon, onClick, full, sm, style }) {
  const base = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9, cursor: "pointer", fontFamily: P.disp, fontWeight: 700, letterSpacing: "-0.01em", borderRadius: 14, border: "1px solid transparent", width: full ? "100%" : "auto", fontSize: sm ? 14 : 16, padding: sm ? "10px 16px" : "15px 20px", whiteSpace: "nowrap", transition: "filter .15s, transform .1s, background .15s" };
  const kinds = {
    primary: { background: P.acc, color: P.onAcc },
    dark: { background: P.elev2, color: P.text, border: "1px solid " + P.line },
    ghost: { background: "transparent", color: P.text, border: "1px solid " + P.line },
    quiet: { background: "transparent", color: P.dim, border: "1px solid " + P.line2 },
  };
  return <button className="pbtn" onClick={onClick} style={{ ...base, ...kinds[kind], ...style }}>{icon && <I d={icon} size={sm ? 16 : 19} sw={2.1} />}{children}</button>;
}

function Field({ icon, placeholder, value, onChange, autoFocus, style }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 11, background: P.elev, border: "1px solid " + P.line, borderRadius: 14, padding: "13px 15px", ...style }}>
    {icon && <span style={{ color: P.faint }}><I d={icon} size={19} /></span>}
    {onChange != null
      ? <input autoFocus={autoFocus} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", color: P.text, fontSize: 16, fontFamily: P.body }} />
      : <span style={{ flex: 1, color: value ? P.text : P.faint, fontSize: 16, fontFamily: P.body }}>{value || placeholder}</span>}
  </div>;
}

function Stepper({ value, onChange, max }) {
  const btn = { width: 52, height: 52, borderRadius: 16, border: "1px solid " + P.line, background: P.elev2, color: P.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" };
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, background: P.accDim, borderRadius: 20, padding: 10 }}>
    <button className="pbtn" onClick={() => onChange(Math.max(0, value - 1))} style={btn}><I d="minus" size={22} sw={2.4} /></button>
    <div style={{ textAlign: "center" }}><div style={{ fontFamily: P.disp, fontWeight: 700, fontSize: 30, color: P.text, lineHeight: 1 }}>{value}{max != null && <span style={{ color: P.faint }}>/{max}</span>}</div><div style={{ fontSize: 11, color: P.dim, marginTop: 3, fontFamily: P.body }}>personen</div></div>
    <button className="pbtn" onClick={() => onChange(value + 1)} style={btn}><I d="plus" size={22} sw={2.4} c={P.acc} /></button>
  </div>;
}

function Label({ children, style }) { return <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", color: P.faint, fontFamily: P.body, textTransform: "uppercase", ...style }}>{children}</div>; }

// list row used in settings / lists
function Row({ icon, title, sub, right, onClick, accent }) {
  return <button className="prow" onClick={onClick} style={{ width: "100%", display: "flex", alignItems: "center", gap: 13, padding: "14px 4px", background: "transparent", border: "none", borderBottom: "1px solid " + P.line2, cursor: onClick ? "pointer" : "default", textAlign: "left" }}>
    {icon && <span style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, background: P.elev2, border: "1px solid " + P.line, display: "flex", alignItems: "center", justifyContent: "center", color: accent ? P.acc : P.text }}><I d={icon} size={18} /></span>}
    <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: "block", fontSize: 15.5, fontWeight: 600, color: P.text, fontFamily: P.body }}>{title}</span>{sub && <span style={{ display: "block", fontSize: 12.5, color: P.faint, marginTop: 1 }}>{sub}</span>}</span>
    {right || (onClick && <span style={{ color: P.ghost }}><I d="chev" size={18} /></span>)}
  </button>;
}

window.POKIT = { P, PI, I, ROLES, initials, Avatar, Pill, RoleChip, StatusDot, PayChip, Btn, Field, Stepper, Label, Row };
Object.assign(window, { P, PI, I, ROLES, initials, Avatar, Pill, RoleChip, StatusDot, PayChip, Btn, Field, Stepper, Label, Row });
