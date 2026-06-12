/* PLUSONE — screens. Phone-first, high-contrast, one accent. All read window.PO. */

// shared header
function Top({ title, big, onBack, right, sub }) {
  if (big) return <div style={{ flex: "none", padding: "8px 20px 14px" }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <h1 style={{ margin: 0, fontFamily: P.disp, fontWeight: 800, fontSize: 34, letterSpacing: "-0.02em", color: P.text, whiteSpace: "nowrap" }}>{title}</h1>
      <div style={{ display: "flex", gap: 8 }}>{right}</div>
    </div>
    {sub && <div style={{ fontSize: 13.5, color: P.faint, marginTop: 2 }}>{sub}</div>}
  </div>;
  return <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 10, padding: "10px 16px 12px" }}>
    {onBack && <button className="pbtn" onClick={onBack} style={{ width: 40, height: 40, borderRadius: 12, border: "1px solid " + P.line, background: P.elev, color: P.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><I d="back" size={20} /></button>}
    <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontFamily: P.disp, fontWeight: 700, fontSize: 18, color: P.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>{sub && <div style={{ fontSize: 12, color: P.faint }}>{sub}</div>}</div>
    <div style={{ display: "flex", gap: 8 }}>{right}</div>
  </div>;
}
const IconBtn = ({ d, onClick }) => <button className="pbtn" onClick={onClick} style={{ width: 40, height: 40, borderRadius: 12, border: "1px solid " + P.line, background: P.elev, color: P.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><I d={d} size={19} /></button>;
const Scroll = ({ children, pad = 20, bottom = 24 }) => <div className="poscroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: `0 ${pad}px ${bottom}px` }}>{children}</div>;

// ============ WELCOME ============
function Welcome({ nav }) {
  return <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: "0 26px 30px", background: "radial-gradient(120% 80% at 50% 0%, #1a1830 0%, " + P.bg + " 55%)" }}>
    <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-start" }}>
      <div style={{ width: 64, height: 64, borderRadius: 20, background: P.acc, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 26 }}>
        <span style={{ fontFamily: P.disp, fontWeight: 800, fontSize: 30, color: P.onAcc, letterSpacing: "-0.04em" }}>+1</span>
      </div>
      <h1 style={{ margin: 0, fontFamily: P.disp, fontWeight: 800, fontSize: 52, lineHeight: 0.95, letterSpacing: "-0.03em", color: P.text }}>plus<br />one</h1>
      <p style={{ fontSize: 17, lineHeight: 1.5, color: P.dim, marginTop: 20, maxWidth: 260 }}>Zet ze op de lijst.<br /><span style={{ color: P.text }}>Wij doen de deur.</span></p>
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
      <Btn kind="primary" full onClick={() => nav.start()}>Aan de slag</Btn>
      <Btn kind="dark" full onClick={() => nav.start()}>Inloggen</Btn>
      <div style={{ textAlign: "center", fontSize: 12, color: P.ghost, marginTop: 6, fontFamily: P.body }}>gastenlijst by Mainstage HQ</div>
    </div>
  </div>;
}

// ============ EVENTS (tab) ============
function Events({ nav }) {
  const [when, setWhen] = React.useState("upcoming");
  const evs = window.PO.events.filter((e) => e.when === when);
  const months = [...new Set(evs.map((e) => e.month))];
  return <div style={col}>
    <Top big title="Events" right={<><IconBtn d="search" /><IconBtn d="plus" /></>} />
    <div style={{ flex: "none", display: "flex", gap: 8, padding: "0 20px 14px" }}>
      {[["upcoming", "Komend"], ["past", "Geweest"]].map(([k, l]) => <button key={k} className="pbtn" onClick={() => setWhen(k)} style={{ padding: "8px 16px", borderRadius: 999, border: "1px solid " + (when === k ? "transparent" : P.line), background: when === k ? P.text : "transparent", color: when === k ? P.bg : P.dim, fontWeight: 700, fontSize: 13.5, fontFamily: P.disp, cursor: "pointer" }}>{l}</button>)}
      <div style={{ flex: 1 }} />
      <Btn sm kind="ghost" icon="plus" onClick={() => { }}>Nieuw</Btn>
    </div>
    <Scroll bottom={100}>
      {months.map((m) => <div key={m} style={{ marginBottom: 8 }}>
        <Label style={{ margin: "12px 2px 10px" }}>{m}</Label>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {evs.filter((e) => e.month === m).map((e) => <button key={e.id} className="pcard" onClick={() => nav.push("event", { id: e.id })} style={{ display: "flex", alignItems: "center", gap: 14, padding: 14, borderRadius: 18, border: "1px solid " + P.line, background: P.elev, cursor: "pointer", textAlign: "left" }}>
            <div style={{ width: 52, flexShrink: 0, textAlign: "center" }}><div style={{ fontFamily: P.disp, fontWeight: 800, fontSize: 24, color: e.accent ? P.acc : P.text, lineHeight: 1 }}>{e.date}</div><div style={{ fontSize: 11, color: P.faint, fontWeight: 700, letterSpacing: "0.05em", marginTop: 2 }}>{e.mon}</div></div>
            <div style={{ width: 1, alignSelf: "stretch", background: P.line2 }} />
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontFamily: P.disp, fontWeight: 700, fontSize: 17, color: P.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.name}</div><div style={{ fontSize: 13, color: P.faint, marginTop: 3, display: "flex", alignItems: "center", gap: 6 }}><I d="clock" size={13} c={P.faint} />Deur {e.time} · {e.venue}</div></div>
            <div style={{ textAlign: "right", flexShrink: 0 }}><div style={{ fontFamily: P.disp, fontWeight: 700, fontSize: 16, color: P.text }}>{e.guests}</div><div style={{ fontSize: 11, color: P.faint }}>{when === "past" ? Math.round(e.inside / e.guests * 100) + "% op" : "gasten"}</div></div>
          </button>)}
        </div>
      </div>)}
    </Scroll>
  </div>;
}

// ============ EVENT detail / overzicht (pushed) ============
function EventView({ nav, ev, inside }) {
  const gs = window.PO.guests;
  const heads = (arr) => arr.reduce((a, g) => a + 1 + g.plus, 0);
  const inn = gs.filter((g) => inside.has(g.id));
  const total = heads(gs) + 130, inH = heads(inn) + 96; // scale to event feel
  const pct = inH / total;
  const recent = inn.slice().sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 3);
  return <div style={col}>
    <Top onBack={nav.back} title={ev.name} sub={ev.venue + " · " + ev.date + " " + ev.mon} right={<IconBtn d="dots" />} />
    <Scroll bottom={28}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        <Stat big v={total - inH} l="Onderweg" />
        <Stat big v={inH} l="Binnen" acc />
      </div>
      <div style={{ background: P.elev, border: "1px solid " + P.line, borderRadius: 18, padding: 16, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 9 }}><Label>Opkomst gastenlijst</Label><span style={{ fontFamily: P.disp, fontWeight: 700, color: P.acc }}>{Math.round(pct * 100)}%</span></div>
        <div style={{ height: 10, borderRadius: 6, background: P.elev2, overflow: "hidden" }}><div style={{ width: pct * 100 + "%", height: "100%", background: P.acc, borderRadius: 6 }} /></div>
        <div style={{ fontSize: 12.5, color: P.faint, marginTop: 9 }}>{total} koppen op de lijst · incl. meegenomen gasten</div>
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <Btn kind="primary" full icon="user" onClick={() => nav.setTab("deur")}>Check-in</Btn>
        <Btn kind="dark" full icon="users" onClick={() => nav.push("lijst", { id: ev.id })}>Gastenlijst</Btn>
      </div>
      <Label style={{ marginBottom: 10 }}>Aandacht nodig</Label>
      <div style={{ display: "flex", flexDirection: "column", gap: 9, marginBottom: 18 }}>
        <Alert icon="crown" title="VIP onderweg" body="Anouk Smit +2 — host wordt gewaarschuwd aan de deur" />
        <Alert icon="money" title="3 gasten moeten betalen" body="Betaalde gastenlijst — afrekenen bij binnenkomst" />
      </div>
      <Label style={{ marginBottom: 10 }}>Laatst binnen</Label>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {recent.map((g) => <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid " + P.line2 }}>
          <Avatar name={g.name} size={38} /><div style={{ flex: 1 }}><div style={{ fontSize: 14.5, fontWeight: 600, color: P.text }}>{g.name}{g.plus > 0 && <span style={{ color: P.faint }}> +{g.plus}</span>}</div></div><span style={{ fontSize: 13, color: P.acc, fontWeight: 700, fontFamily: P.disp }}>{g.at}</span>
        </div>)}
      </div>
    </Scroll>
  </div>;
}
const Stat = ({ v, l, acc, big }) => <div style={{ background: P.elev, border: "1px solid " + P.line, borderRadius: 18, padding: "16px 16px" }}><div style={{ fontFamily: P.disp, fontWeight: 800, fontSize: big ? 38 : 28, color: acc ? P.acc : P.text, lineHeight: 1 }}>{v}</div><div style={{ fontSize: 13, color: P.dim, marginTop: 4 }}>{l}</div></div>;
const Alert = ({ icon, title, body }) => <div style={{ display: "flex", gap: 12, padding: 13, borderRadius: 14, background: P.elev, border: "1px solid " + P.line }}><span style={{ color: P.accSoft, marginTop: 1 }}><I d={icon} size={19} /></span><div><div style={{ fontSize: 14, fontWeight: 700, color: P.text, fontFamily: P.body }}>{title}</div><div style={{ fontSize: 12.5, color: P.faint, marginTop: 2, lineHeight: 1.4 }}>{body}</div></div></div>;

// ============ LIJST (pushed) ============
function Lijst({ nav, ev, inside }) {
  const [q, setQ] = React.useState("");
  const [f, setF] = React.useState("all");
  let gs = window.PO.guests;
  gs = gs.filter((g) => (f === "all" || (f === "in" && inside.has(g.id)) || (f === "wait" && !inside.has(g.id)) || (f === "vip" && g.role === "VIP")));
  if (q) gs = gs.filter((g) => g.name.toLowerCase().includes(q.toLowerCase()));
  return <div style={col}>
    <Top onBack={nav.back} title="Gastenlijst" sub={ev.name + " · " + window.PO.guests.length + " getoond van 148"} right={<IconBtn d="plus" />} />
    <div style={{ flex: "none", padding: "0 16px 10px" }}><Field icon="search" placeholder="Zoek gast…" value={q} onChange={setQ} /></div>
    <div style={{ flex: "none", display: "flex", gap: 7, padding: "0 16px 12px", overflowX: "auto" }}>
      {[["all", "Alle"], ["wait", "Onderweg"], ["in", "Binnen"], ["vip", "VIP"]].map(([k, l]) => <button key={k} className="pbtn" onClick={() => setF(k)} style={{ flexShrink: 0, padding: "7px 14px", borderRadius: 999, border: "1px solid " + (f === k ? "transparent" : P.line), background: f === k ? P.text : "transparent", color: f === k ? P.bg : P.dim, fontWeight: 700, fontSize: 13, fontFamily: P.disp, cursor: "pointer" }}>{l}</button>)}
    </div>
    <div style={{ flex: "none", display: "flex", gap: 8, padding: "0 16px 12px" }}>
      <Btn sm kind="quiet" icon="paste" onClick={() => { }}>Plak namen</Btn>
      <Btn sm kind="quiet" icon="contact" onClick={() => nav.push("contacten")}>Adresboek</Btn>
    </div>
    <Scroll pad={16} bottom={24}>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {gs.map((g) => <button key={g.id} className="pcard" onClick={() => nav.push("guest", { id: g.id })} style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, borderRadius: 16, border: "1px solid " + P.line, background: P.elev, cursor: "pointer", textAlign: "left" }}>
          <Avatar name={g.name} size={42} accent={g.role === "VIP"} />
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontFamily: P.disp, fontWeight: 700, fontSize: 15.5, color: P.text }}>{g.name}{g.plus > 0 && <span style={{ color: P.faint, fontWeight: 600 }}> +{g.plus}</span>}</div><div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5, flexWrap: "wrap" }}><RoleChip role={g.role} />{g.pay === "pay" && <PayChip pay="pay" />}{g.note && <span style={{ color: P.accSoft }}><I d="note" size={13} /></span>}</div></div>
          <StatusDot status={inside.has(g.id) ? "in" : "wait"} label={false} />
        </button>)}
      </div>
    </Scroll>
  </div>;
}

// ============ GUEST detail / check-in (pushed) ============
function Guest({ nav, g, inside, checkIn, uncheck, log, taskDone, ackTask }) {
  const isIn = inside.has(g.id);
  const [plus, setPlus] = React.useState(g.plus);
  const hasTask = !!g.note;
  const done = taskDone(g.id);
  // "Let op!" alert opens automatically for an unhandled high-priority note
  const [alertOpen, setAlertOpen] = React.useState(g.flag === "high" && !done);
  const entry = log[g.id];

  return <div style={col}>
    <Top onBack={nav.back} title="Gast" right={<><IconBtn d="share" /><IconBtn d="dots" /></>} />
    <Scroll bottom={20}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "6px 0 18px" }}>
        <Avatar name={g.name} size={84} accent={g.role === "VIP"} />
        <h2 style={{ margin: "16px 0 0", fontFamily: P.disp, fontWeight: 800, fontSize: 28, letterSpacing: "-0.02em", color: P.text, whiteSpace: "nowrap" }}>{g.name}</h2>
        <div style={{ display: "flex", gap: 7, marginTop: 12 }}><RoleChip role={g.role} />{g.pay === "pay" ? <PayChip pay="pay" /> : <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 7, color: g.pay === "paid" ? P.acc : P.faint, border: "1px solid " + (g.pay === "paid" ? "transparent" : P.line2), background: g.pay === "paid" ? P.accDim : "transparent" }}>{g.pay === "paid" ? "BETAALD" : "GRATIS"}</span>}</div>
      </div>

      {/* task / note with priority + acknowledge state */}
      {hasTask && <div style={{ padding: 14, borderRadius: 14, background: g.flag === "high" && !done ? P.accDim : P.elev, border: "1px solid " + (g.flag === "high" && !done ? "transparent" : P.line), marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><I d="flag" size={15} c={g.flag === "high" ? P.acc : P.faint} fill={g.flag === "high" ? P.acc : "none"} /><Label style={{ color: g.flag === "high" ? P.accSoft : P.faint }}>{g.flag === "high" ? "Belangrijke opdracht" : "Opdracht"}</Label></span>
          {done
            ? <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 700, color: P.acc, fontFamily: P.body }}><I d="check2" size={13} c={P.acc} sw={2.4} />Opgepakt</span>
            : <span style={{ fontSize: 11, fontWeight: 700, color: P.faint, fontFamily: P.body }}>OPEN</span>}
        </div>
        <div style={{ fontSize: 15, color: P.text, lineHeight: 1.45, marginBottom: 12 }}>{g.note}</div>
        <Btn sm full kind={done ? "ghost" : "primary"} icon={done ? "history" : "check2"} onClick={() => ackTask(g.id, !done)}>{done ? "Heropenen" : "Markeer als opgepakt"}</Btn>
      </div>}

      {g.pay === "pay" && <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "11px 14px", borderRadius: 13, background: P.elev, border: "1px dashed " + P.line, marginBottom: 10 }}><I d="money" size={17} c={P.text} /><span style={{ fontSize: 13.5, color: P.text, fontWeight: 600 }}>Betaalde gastenlijst — laat afrekenen aan de deur</span></div>}

      {/* LOGBOEK */}
      <Label style={{ margin: "6px 2px 10px" }}>Logboek</Label>
      <div style={{ padding: "4px 14px", borderRadius: 14, background: P.elev, border: "1px solid " + P.line, marginBottom: 16 }}>
        <LogRow icon="user" label="Toegevoegd" who={g.by} when={g.addedAt} />
        {g.plus > 0 && <LogRow icon="users" label="Meegenomen gasten" who={"+" + g.plus + " tickets"} when="" />}
        {isIn
          ? <LogRow icon="check2" label="Ingecheckt" who={(entry && entry.by) || g.inBy || "—"} when={(entry && entry.at) || g.at} accent last />
          : <LogRow icon="clock" label="Nog niet ingecheckt" who="onderweg" when="" last />}
      </div>

      {!isIn && <><Label style={{ marginBottom: 9 }}>Hoeveel komen er binnen?</Label>
      <div style={{ marginBottom: 16 }}><Stepper value={plus + 1} onChange={(v) => setPlus(Math.max(0, v - 1))} /></div></>}
    </Scroll>
    <div style={{ flex: "none", padding: "12px 16px calc(12px + env(safe-area-inset-bottom))", borderTop: "1px solid " + P.line2, background: P.bg }}>
      {isIn
        ? <Btn kind="ghost" full icon="back" onClick={() => uncheck(g.id)}>Uitchecken</Btn>
        : <Btn kind="primary" full icon="check" onClick={() => { checkIn(g.id, 1 + plus); nav.back(); }}>Check in · {1 + plus} {1 + plus === 1 ? "persoon" : "personen"}</Btn>}
    </div>

    {/* LET OP! popup for important notes */}
    {alertOpen && <div className="po-modal-bg" onClick={() => setAlertOpen(false)}>
      <div className="po-modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ width: 52, height: 52, borderRadius: 16, background: P.acc, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}><I d="warn" size={28} c={P.onAcc} sw={2.2} /></div>
        <div style={{ fontFamily: P.disp, fontWeight: 800, fontSize: 22, color: P.text, letterSpacing: "-0.01em" }}>Let op!</div>
        <div style={{ fontSize: 13, color: P.faint, marginTop: 2, marginBottom: 14 }}>Opdracht voor {g.name}</div>
        <div style={{ width: "100%", padding: 14, borderRadius: 14, background: P.elev, border: "1px solid " + P.line, fontSize: 15.5, color: P.text, lineHeight: 1.45, marginBottom: 18, textAlign: "left" }}>{g.note}</div>
        <Btn full kind="primary" icon="check2" onClick={() => { ackTask(g.id, true); setAlertOpen(false); }}>Gezien & opgepakt</Btn>
        <button className="pbtn" onClick={() => setAlertOpen(false)} style={{ marginTop: 10, background: "none", border: "none", color: P.faint, fontSize: 13.5, fontWeight: 600, fontFamily: P.body, cursor: "pointer" }}>Later</button>
      </div>
    </div>}
  </div>;
}
function LogRow({ icon, label, who, when, accent, last }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: last ? "none" : "1px solid " + P.line2 }}>
    <span style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, background: accent ? P.accDim : P.elev2, display: "flex", alignItems: "center", justifyContent: "center", color: accent ? P.acc : P.dim }}><I d={icon} size={15} sw={2} /></span>
    <span style={{ flex: 1, fontSize: 13.5, color: P.faint }}>{label}</span>
    <span style={{ textAlign: "right" }}><span style={{ fontSize: 13.5, fontWeight: 600, color: accent ? P.acc : P.text }}>{who}</span>{when && <span style={{ fontSize: 12, color: P.faint, marginLeft: 7, fontFamily: P.disp }}>{when}</span>}</span>
  </div>;
}

// ============ DEUR (tab) — door check-in ============
function Deur({ nav, inside }) {
  const [q, setQ] = React.useState("");
  const [f, setF] = React.useState("both"); // both | wait | in
  const gs = window.PO.guests;
  const inn = gs.filter((g) => inside.has(g.id)).length;

  let base = q ? gs.filter((g) => g.name.toLowerCase().includes(q.toLowerCase())) : gs;
  const waiting = base.filter((g) => !inside.has(g.id));
  const checked = base.filter((g) => inside.has(g.id));
  let list;
  if (f === "wait") list = waiting;
  else if (f === "in") list = checked;
  else list = [...waiting, ...checked]; // onderweg eerst, ingecheckt onderaan
  const showDivider = f === "both" && waiting.length > 0 && checked.length > 0;

  const guestRow = (g) => {
    const isIn = inside.has(g.id);
    return <button key={g.id} className="pcard" onClick={() => nav.push("guest", { id: g.id })} style={{ display: "flex", alignItems: "center", gap: 13, padding: 13, borderRadius: 16, border: "1px solid " + (isIn ? P.line2 : P.line), background: isIn ? "transparent" : P.elev, cursor: "pointer", textAlign: "left", opacity: isIn ? 0.55 : 1 }}>
      <Avatar name={g.name} size={46} accent={!isIn && g.role === "VIP"} />
      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontFamily: P.disp, fontWeight: 700, fontSize: 17, color: isIn ? P.dim : P.text }}>{g.name}{g.plus > 0 && <span style={{ color: P.faint, fontWeight: 600 }}> +{g.plus}</span>}</div><div style={{ display: "flex", gap: 6, marginTop: 5 }}><RoleChip role={g.role} />{g.pay === "pay" && !isIn && <PayChip pay="pay" />}</div></div>
      {isIn ? <StatusDot status="in" /> : <span style={{ color: P.acc }}><I d="chev" size={24} /></span>}
    </button>;
  };

  return <div style={col}>
    <Top big title="Check-in" sub="FRENZY · De Marktkantine" />
    <div style={{ flex: "none", display: "flex", gap: 10, padding: "0 20px 14px" }}>
      <div style={{ flex: 1, background: P.elev, border: "1px solid " + P.line, borderRadius: 14, padding: "12px 14px" }}><div style={{ fontFamily: P.disp, fontWeight: 800, fontSize: 26, color: P.text }}>{gs.length - inn}</div><div style={{ fontSize: 12, color: P.faint }}>onderweg</div></div>
      <div style={{ flex: 1, background: P.accDim, borderRadius: 14, padding: "12px 14px" }}><div style={{ fontFamily: P.disp, fontWeight: 800, fontSize: 26, color: P.acc }}>{inn}</div><div style={{ fontSize: 12, color: P.dim }}>binnen</div></div>
    </div>
    <div style={{ flex: "none", padding: "0 20px 12px" }}><Field icon="search" placeholder="Typ de naam van de gast…" value={q} onChange={setQ} autoFocus /></div>
    <div style={{ flex: "none", display: "flex", gap: 6, padding: "0 20px 14px", background: P.bg }}>
      {[["both", "Beide"], ["wait", "Onderweg"], ["in", "Ingecheckt"]].map(([k, l]) => <button key={k} className="pbtn" onClick={() => setF(k)} style={{ flex: 1, padding: "9px 0", borderRadius: 999, border: "1px solid " + (f === k ? "transparent" : P.line), background: f === k ? P.text : "transparent", color: f === k ? P.bg : P.dim, fontWeight: 700, fontSize: 13, fontFamily: P.disp, cursor: "pointer" }}>{l}</button>)}
    </div>
    <Scroll pad={20} bottom={100}>
      <Label style={{ marginBottom: 10 }}>{q ? list.length + " gevonden" : f === "in" ? inn + " ingecheckt" : f === "wait" ? (gs.length - inn) + " nog aan de deur" : "Volgende aan de deur"}</Label>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {(f === "both" ? waiting : list).map(guestRow)}
        {showDivider && <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "8px 2px 2px" }}><div style={{ flex: 1, height: 1, background: P.line2 }} /><span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: P.ghost, fontFamily: P.body }}>AL BINNEN · {checked.length}</span><div style={{ flex: 1, height: 1, background: P.line2 }} /></div>}
        {f === "both" && checked.map(guestRow)}
        {list.length === 0 && <div style={{ textAlign: "center", padding: "30px 0", color: P.faint, fontSize: 14 }}>{f === "in" ? "Nog niemand ingecheckt." : "Iedereen is binnen 🎉"}</div>}
      </div>
    </Scroll>
  </div>;
}

// ============ MEER (tab) — settings ============
function Meer({ nav }) {
  const a = window.PO.account;
  return <div style={col}>
    <Top big title="Instellingen" />
    <Scroll bottom={100}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: 16, borderRadius: 18, border: "1px solid " + P.line, background: P.elev, marginBottom: 20 }}>
        <Avatar name={a.ws} size={48} accent />
        <div style={{ flex: 1 }}><div style={{ fontFamily: P.disp, fontWeight: 700, fontSize: 18, color: P.text }}>{a.ws}</div><div style={{ fontSize: 12.5, color: P.faint }}>Werkruimte · {a.user}</div></div>
        <span style={{ fontSize: 11, fontWeight: 700, padding: "5px 11px", borderRadius: 999, background: P.acc, color: P.onAcc, fontFamily: P.disp }}>{a.plan}</span>
      </div>
      <Label style={{ marginBottom: 4 }}>Jouw bedrijf</Label>
      <Row icon="user" title="Persoonlijke gegevens" sub="Profiel & inloggen" onClick={() => { }} />
      <Row icon="building" title="Venues" sub="Locaties beheren" onClick={() => { }} />
      <Row icon="users" title="Gebruikers & toelages" sub="Rollen en gasten-per-event" onClick={() => nav.push("rollen")} accent />
      <Row icon="star" title="Permanente gasten" sub="12 gasten staan altijd op de lijst" onClick={() => nav.push("vaste")} accent />
      <Row icon="contact" title="Adresboek" sub="1.284 opgeslagen contacten" onClick={() => nav.push("contacten")} accent />
      <Row icon="upload" title="Importeren" sub="Plak, CSV of telefooncontacten" onClick={() => nav.push("import")} />
      <Label style={{ margin: "22px 0 4px" }}>Abonnement</Label>
      <Row icon="spark" title="Premium" sub="€49 / maand · onbeperkt events" right={<I d="chev" size={18} c={P.ghost} />} onClick={() => { }} />
    </Scroll>
  </div>;
}

// ============ CONTACTEN (pushed) ============
function Contacten({ nav, vast, toggleVast }) {
  const [q, setQ] = React.useState("");
  let cs = window.PO.contacts;
  if (q) cs = cs.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));
  return <div style={col}>
    <Top onBack={nav.back} title="Adresboek" sub="1.284 contacten · herbruik in één tik" right={<IconBtn d="upload" />} />
    <div style={{ flex: "none", padding: "0 16px 12px" }}><Field icon="search" placeholder="Zoek op naam of tag…" value={q} onChange={setQ} /></div>
    <Scroll pad={16} bottom={24}>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {cs.map((c) => <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, borderRadius: 16, border: "1px solid " + P.line, background: P.elev }}>
          <Avatar name={c.name} size={42} accent={vast.has(c.name)} />
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontFamily: P.disp, fontWeight: 700, fontSize: 15.5, color: P.text }}>{c.name}</div><div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}><RoleChip role={c.role} /><span style={{ fontSize: 11.5, color: P.faint }}>{c.events}× op een lijst</span></div></div>
          <button className="pbtn" onClick={() => toggleVast(c.name)} title="Altijd toevoegen" style={{ width: 38, height: 38, borderRadius: 11, border: "1px solid " + (vast.has(c.name) ? "transparent" : P.line), background: vast.has(c.name) ? P.accDim : "transparent", color: vast.has(c.name) ? P.acc : P.ghost, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><I d="star" size={17} fill={vast.has(c.name) ? P.acc : "none"} c={vast.has(c.name) ? P.acc : P.ghost} /></button>
          <button className="pbtn" style={{ width: 38, height: 38, borderRadius: 11, border: "none", background: P.text, color: P.bg, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><I d="plus" size={18} sw={2.4} /></button>
        </div>)}
      </div>
    </Scroll>
  </div>;
}

// ============ VASTE GASTEN (pushed) ============
function Vaste({ nav, vast, toggleVast }) {
  const list = window.PO.contacts.filter((c) => vast.has(c.name));
  return <div style={col}>
    <Top onBack={nav.back} title="Permanente gasten" right={<IconBtn d="plus" />} />
    <Scroll bottom={24}>
      <div style={{ display: "flex", gap: 12, padding: 15, borderRadius: 16, background: P.accDim, marginBottom: 16 }}><I d="star" size={20} c={P.acc} fill={P.acc} /><div style={{ fontSize: 13.5, color: P.text, lineHeight: 1.45 }}>Deze gasten komen <b>automatisch</b> op élke nieuwe gastenlijst. Eén keer instellen — daarna niets meer doen.</div></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {list.map((c) => <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, borderRadius: 16, border: "1px solid " + P.line, background: P.elev }}>
          <Avatar name={c.name} size={42} accent />
          <div style={{ flex: 1 }}><div style={{ fontFamily: P.disp, fontWeight: 700, fontSize: 15.5, color: P.text }}>{c.name}</div><div style={{ fontSize: 12, color: P.faint, marginTop: 3 }}>auto · {c.role}</div></div>
          <button className="pbtn" onClick={() => toggleVast(c.name)} style={{ width: 38, height: 38, borderRadius: 11, border: "1px solid " + P.line, background: "transparent", color: P.faint, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><I d="close" size={16} /></button>
        </div>)}
      </div>
    </Scroll>
  </div>;
}

// ============ ROLLEN & TOELAGES (pushed) ============
function Rollen({ nav }) {
  return <div style={col}>
    <Top onBack={nav.back} title="Gebruikers & toelages" />
    <Scroll bottom={24}>
      <div style={{ fontSize: 13.5, color: P.faint, lineHeight: 1.5, marginBottom: 16 }}>Elk teamlid mag standaard een aantal gasten per event toevoegen. Per event op te hogen.</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 11, marginBottom: 22 }}>
        {window.PO.team.map((t) => <div key={t.name} style={{ padding: 14, borderRadius: 16, border: "1px solid " + P.line, background: P.elev }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}><Avatar name={t.name} size={40} /><div style={{ flex: 1 }}><div style={{ fontFamily: P.disp, fontWeight: 700, fontSize: 15.5, color: P.text }}>{t.name}</div><div style={{ fontSize: 12, color: P.faint }}>{t.role}</div></div></div>
          <div style={{ display: "flex", gap: 6, marginBottom: t.max ? 11 : 0 }}>{["Unlimited", "10", "5"].map((o) => <span key={o} style={{ flex: 1, textAlign: "center", padding: "8px 0", borderRadius: 10, fontSize: 13, fontWeight: 700, fontFamily: P.disp, color: t.allow === o ? P.onAcc : P.dim, background: t.allow === o ? P.acc : P.elev2, border: "1px solid " + (t.allow === o ? "transparent" : P.line) }}>{o}</span>)}</div>
          {t.max && <div><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}><span style={{ fontSize: 11.5, color: P.faint }}>gebruikt dit event</span><span style={{ fontSize: 12, color: t.used >= t.max ? P.acc : P.dim, fontWeight: 700 }}>{t.used}/{t.max}</span></div><div style={{ height: 6, borderRadius: 4, background: P.elev2, overflow: "hidden" }}><div style={{ width: t.used / t.max * 100 + "%", height: "100%", background: P.acc, borderRadius: 4 }} /></div></div>}
        </div>)}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}><Label>Extra plekken per event</Label><Btn sm kind="quiet" icon="plus">Override</Btn></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {[["FRENZY", "Joris", "+15"], ["Hunée", "Eva", "+5"], ["MINDSCAPE", "Sanne", "∞"]].map(([e, w, x]) => <div key={e + w} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 13, background: P.elev, border: "1px solid " + P.line }}><span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: P.text }}>{e}</span><span style={{ fontSize: 12.5, color: P.faint }}>{w}</span><span style={{ fontSize: 12.5, fontWeight: 700, color: P.acc, fontFamily: P.disp }}>{x} extra</span></div>)}
      </div>
    </Scroll>
  </div>;
}

// ============ IMPORT (pushed) ============
function Import({ nav }) {
  const rows = [["Anouk Smit", "dup", "21×"], ["Pim Scholten", "new"], ["Femke Bakker", "dup", "17×"], ["Teun Postma", "new"], ["Wout Dekker", "new"], ["Lieke Hofman", "dup", "14×"]];
  return <div style={col}>
    <Top onBack={nav.back} title="Importeren" />
    <Scroll bottom={100}>
      <div style={{ fontSize: 13.5, color: P.faint, lineHeight: 1.5, marginBottom: 14 }}>Iedereen die ooit op een lijst stond in één keer in je adresboek.</div>
      <div style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 16 }}>{[["paste", "Plak lijst", true], ["upload", "CSV", false], ["contact", "Contacten", false], ["ticket", "Vorig event", false]].map(([ic, l, on]) => <span key={l} style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 14px", borderRadius: 999, fontSize: 13, fontWeight: 700, fontFamily: P.disp, color: on ? P.onAcc : P.dim, background: on ? P.acc : "transparent", border: "1px solid " + (on ? "transparent" : P.line) }}><I d={ic} size={15} sw={2.1} c={on ? P.onAcc : P.dim} />{l}</span>)}</div>
      <Label style={{ marginBottom: 9 }}>Herkend · dubbele worden gekoppeld</Label>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map(([n, s, m]) => <div key={n} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 13, background: P.elev, border: "1px solid " + P.line }}>
          <Avatar name={n} size={34} accent={s === "dup"} />
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 14, fontWeight: 600, color: P.text }}>{n}</div>{m && <div style={{ fontSize: 11.5, color: P.faint }}>match · {m} op lijst</div>}</div>
          <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 7, color: s === "dup" ? P.acc : P.text, background: s === "dup" ? P.accDim : "transparent", border: s === "dup" ? "none" : "1px solid " + P.line }}>{s === "dup" ? "BESTAAT AL" : "NIEUW"}</span>
        </div>)}
      </div>
    </Scroll>
    <div style={{ flex: "none", padding: "12px 16px 16px", borderTop: "1px solid " + P.line2 }}><Btn kind="primary" full icon="check">Importeer 142 gasten</Btn></div>
  </div>;
}

// ============ TAKEN (tab) — floor manager open tasks ============
function Taken({ nav, inside, taskDone, ackTask }) {
  const [f, setF] = React.useState("open");
  const all = window.PO.guests.filter((g) => g.note).map((g) => ({ g, prio: g.flag || "low", done: taskDone(g.id) }));
  const openCount = all.filter((t) => !t.done).length;
  const highOpen = all.filter((t) => !t.done && t.prio === "high").length;
  let list = all.filter((t) => (f === "open" ? !t.done : f === "done" ? t.done : true));
  list.sort((a, b) => (a.done - b.done) || ((b.prio === "high") - (a.prio === "high")) || (a.g.id - b.g.id));

  return <div style={col}>
    <Top big title="Taken" sub="FRENZY · openstaande opdrachten aan de deur" />
    <div style={{ flex: "none", display: "flex", gap: 10, padding: "0 20px 14px" }}>
      <div style={{ flex: 1, background: P.accDim, borderRadius: 14, padding: "12px 14px" }}><div style={{ fontFamily: P.disp, fontWeight: 800, fontSize: 26, color: P.acc }}>{openCount}</div><div style={{ fontSize: 12, color: P.dim }}>open</div></div>
      <div style={{ flex: 1, background: P.elev, border: "1px solid " + P.line, borderRadius: 14, padding: "12px 14px" }}><div style={{ display: "flex", alignItems: "center", gap: 6 }}><I d="flag" size={18} c={P.acc} fill={P.acc} /><div style={{ fontFamily: P.disp, fontWeight: 800, fontSize: 26, color: P.text }}>{highOpen}</div></div><div style={{ fontSize: 12, color: P.faint }}>belangrijk</div></div>
      <div style={{ flex: 1, background: P.elev, border: "1px solid " + P.line, borderRadius: 14, padding: "12px 14px" }}><div style={{ fontFamily: P.disp, fontWeight: 800, fontSize: 26, color: P.text }}>{all.length - openCount}</div><div style={{ fontSize: 12, color: P.faint }}>klaar</div></div>
    </div>
    <div style={{ flex: "none", display: "flex", gap: 6, padding: "0 20px 14px" }}>
      {[["open", "Open"], ["done", "Klaar"], ["all", "Alle"]].map(([k, l]) => <button key={k} className="pbtn" onClick={() => setF(k)} style={{ flex: 1, padding: "9px 0", borderRadius: 999, border: "1px solid " + (f === k ? "transparent" : P.line), background: f === k ? P.text : "transparent", color: f === k ? P.bg : P.dim, fontWeight: 700, fontSize: 13, fontFamily: P.disp, cursor: "pointer" }}>{l}</button>)}
    </div>
    <Scroll pad={20} bottom={100}>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {list.map(({ g, prio, done }) => { const isIn = inside.has(g.id); return <div key={g.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: 14, borderRadius: 16, border: "1px solid " + (prio === "high" && !done ? "rgba(181,166,255,0.4)" : P.line), background: P.elev, opacity: done ? 0.55 : 1 }}>
          <button className="pbtn" onClick={() => ackTask(g.id, !done)} style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 8, marginTop: 1, cursor: "pointer", border: "2px solid " + (done ? P.acc : P.ghost), background: done ? P.acc : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>{done && <I d="check" size={15} c={P.onAcc} sw={3} />}</button>
          <button className="pbtn" onClick={() => nav.push("guest", { id: g.id })} style={{ flex: 1, minWidth: 0, background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
              {prio === "high" && <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 800, letterSpacing: "0.04em", color: P.acc, fontFamily: P.body, padding: "2px 7px", borderRadius: 6, background: P.accDim }}><I d="flag" size={10} c={P.acc} fill={P.acc} sw={2} />BELANGRIJK</span>}
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 700, color: isIn ? P.acc : P.faint, fontFamily: P.body }}>{isIn ? <><I d="check2" size={12} c={P.acc} sw={2.4} />binnen</> : "onderweg"}</span>
            </div>
            <div style={{ fontSize: 15, color: P.text, fontWeight: 600, lineHeight: 1.4, textDecoration: done ? "line-through" : "none", textDecorationColor: P.ghost }}>{g.note}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7 }}><Avatar name={g.name} size={22} /><span style={{ fontSize: 12.5, color: P.faint }}>{g.name}{g.plus > 0 && " · +" + g.plus}</span></div>
          </button>
        </div>; })}
        {list.length === 0 && <div style={{ textAlign: "center", padding: "36px 0", color: P.faint, fontSize: 14.5 }}>{f === "open" ? "Alles opgepakt 🎉" : "Niets hier."}</div>}
      </div>
    </Scroll>
  </div>;
}

const col = { height: "100%", display: "flex", flexDirection: "column" };
Object.assign(window, { Top, IconBtn, Scroll, Welcome, Events, EventView, Lijst, Guest, LogRow, Deur, Taken, Meer, Contacten, Vaste, Rollen, Import, col });
