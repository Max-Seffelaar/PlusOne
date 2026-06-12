/* PLUSONE — app shell: phone frame, status bar, tab bar, navigation + check-in state. */

function StatusBar() {
  return <div style={{ flex: "none", height: 46, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 26px", fontFamily: P.disp }}>
    <span style={{ fontWeight: 700, fontSize: 15, color: P.text }}>9:41</span>
    <div style={{ display: "flex", alignItems: "center", gap: 6, color: P.text }}>
      <svg width="18" height="12" viewBox="0 0 18 12">{[3, 6, 9, 12].map((h, i) => <rect key={i} x={i * 4.5} y={12 - h} width="3" height={h} rx="1" fill={P.text} />)}</svg>
      <svg width="16" height="12" viewBox="0 0 16 12" fill="none"><path d="M1 4.5C4.5 1.5 11.5 1.5 15 4.5M3.5 7C6 5 10 5 12.5 7M6 9.3a2.5 2.5 0 0 1 4 0" stroke={P.text} strokeWidth="1.4" strokeLinecap="round" /></svg>
      <svg width="26" height="13" viewBox="0 0 26 13"><rect x="0.5" y="1" width="21" height="11" rx="3" stroke={P.text} strokeWidth="1" fill="none" opacity="0.5" /><rect x="2" y="2.5" width="17" height="8" rx="1.6" fill={P.text} /><rect x="23" y="4" width="2" height="5" rx="1" fill={P.text} opacity="0.5" /></svg>
    </div>
  </div>;
}

function TabBar({ tab, setTab, badges }) {
  const items = [["events", "Events", "cal"], ["deur", "Check-in", "user"], ["taken", "Taken", "flag"], ["meer", "Meer", "cog"]];
  return <div style={{ flex: "none", display: "flex", padding: "8px 14px calc(14px + env(safe-area-inset-bottom))", borderTop: "1px solid " + P.line2, background: "rgba(11,11,13,0.9)", backdropFilter: "blur(12px)" }}>
    {items.map(([k, l, ic]) => { const on = tab === k; const badge = badges && badges[k]; return <button key={k} className="pbtn" onClick={() => setTab(k)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, background: "transparent", border: "none", cursor: "pointer", color: on ? P.acc : P.faint, padding: "4px 0" }}>
      <span style={{ position: "relative" }}><I d={ic} size={22} sw={on ? 2.2 : 1.9} />{badge ? <span style={{ position: "absolute", top: -5, right: -9, minWidth: 16, height: 16, padding: "0 4px", borderRadius: 99, background: P.acc, color: P.onAcc, fontSize: 10, fontWeight: 800, fontFamily: P.disp, display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid #0B0B0D" }}>{badge}</span> : null}</span>
      <span style={{ fontSize: 11, fontWeight: 700, fontFamily: P.body }}>{l}</span>
    </button>; })}
  </div>;
}

function App() {
  const [started, setStarted] = React.useState(false);
  const [tab, setTabState] = React.useState("events");
  const [stack, setStack] = React.useState([]);
  const [inside, setInside] = React.useState(() => new Set(window.PO.guests.filter((g) => g.status === "in").map((g) => g.id)));
  const [log, setLog] = React.useState(() => { const o = {}; window.PO.guests.filter((g) => g.status === "in").forEach((g) => { o[g.id] = { at: g.at, by: g.inBy || "Joris" }; }); return o; });
  const [tasksDone, setTasksDone] = React.useState(() => new Set());
  const [vast, setVast] = React.useState(() => new Set(window.PO.contacts.filter((c) => c.vast).map((c) => c.name)));
  const doorUser = "Joris";
  const [toast, setToast] = React.useState(null);
  const [scale, setScale] = React.useState(1);
  const [key, setKey] = React.useState(0);

  React.useEffect(() => {
    const fit = () => setScale(Math.min(1.15, Math.max(0.6, (window.innerHeight - 48) / 844)));
    fit(); window.addEventListener("resize", fit); return () => window.removeEventListener("resize", fit);
  }, []);

  const bump = () => setKey((k) => k + 1);
  const nav = {
    push: (name, props) => { setStack((s) => [...s, { name, props: props || {} }]); bump(); },
    back: () => { setStack((s) => s.slice(0, -1)); bump(); },
    setTab: (t) => { setTabState(t); setStack([]); bump(); },
    start: () => { setStarted(true); bump(); },
  };
  const setTab = nav.setTab;
  const nowTime = () => new Date().toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
  const checkIn = (id, total) => {
    const g = window.PO.guests.find((x) => x.id === id);
    setInside((s) => new Set(s).add(id));
    setLog((l) => ({ ...l, [id]: { at: nowTime(), by: doorUser } }));
    setToast((g ? g.name : "Gast") + (total > 1 ? " +" + (total - 1) : "") + " · binnen ✓");
    setTimeout(() => setToast(null), 2400);
  };
  const uncheck = (id) => { setInside((s) => { const x = new Set(s); x.delete(id); return x; }); setLog((l) => { const o = { ...l }; delete o[id]; return o; }); nav.back(); };
  const taskDone = (id) => tasksDone.has(id);
  const ackTask = (id, val) => setTasksDone((s) => { const x = new Set(s); val ? x.add(id) : x.delete(id); return x; });
  const toggleVast = (n) => setVast((s) => { const x = new Set(s); x.has(n) ? x.delete(n) : x.add(n); return x; });

  const ev = (id) => window.PO.events.find((e) => e.id === id) || window.PO.events[0];
  const guest = (id) => window.PO.guests.find((g) => g.id === id);

  const top = stack[stack.length - 1];
  const tabRoot = started && stack.length === 0;

  let screen;
  if (!started) screen = <Welcome nav={nav} />;
  else if (top) {
    const p = top.props;
    if (top.name === "event") screen = <EventView nav={nav} ev={ev(p.id)} inside={inside} />;
    else if (top.name === "lijst") screen = <Lijst nav={nav} ev={ev(p.id)} inside={inside} />;
    else if (top.name === "guest") screen = <Guest nav={nav} g={guest(p.id)} inside={inside} checkIn={checkIn} uncheck={uncheck} log={log} taskDone={taskDone} ackTask={ackTask} />;
    else if (top.name === "contacten") screen = <Contacten nav={nav} vast={vast} toggleVast={toggleVast} />;
    else if (top.name === "vaste") screen = <Vaste nav={nav} vast={vast} toggleVast={toggleVast} />;
    else if (top.name === "rollen") screen = <Rollen nav={nav} />;
    else if (top.name === "import") screen = <Import nav={nav} />;
  } else if (tab === "events") screen = <Events nav={nav} />;
  else if (tab === "deur") screen = <Deur nav={nav} inside={inside} />;
  else if (tab === "taken") screen = <Taken nav={nav} inside={inside} taskDone={taskDone} ackTask={ackTask} />;
  else screen = <Meer nav={nav} />;

  return <div className="stage">
    <div className="stage-head">
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <div style={{ width: 34, height: 34, borderRadius: 11, background: P.acc, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: P.disp, fontWeight: 800, fontSize: 16, color: P.onAcc, letterSpacing: "-0.03em" }}>+1</div>
        <div><div style={{ fontFamily: P.disp, fontWeight: 800, fontSize: 17, color: "#1a1a1a", letterSpacing: "-0.01em" }}>plusone</div><div style={{ fontSize: 11, color: "#9a948a", fontFamily: "var(--body)" }}>gastenlijst · klikbaar prototype</div></div>
      </div>
      <div className="stage-hint">Klik je door de flow — typ een naam bij Check-in</div>
    </div>
    <div className="phone-wrap">
      <div className="phone" style={{ transform: `scale(${scale})` }}>
        <div className="screen">
          {started && <StatusBar />}
          <div key={key} className="screen-anim" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>{screen}</div>
          {tabRoot && <TabBar tab={tab} setTab={setTab} badges={{ taken: window.PO.guests.filter((g) => g.note && !tasksDone.has(g.id)).length }} />}
          {toast && <div className="po-toast">{toast}</div>}
        </div>
      </div>
    </div>
  </div>;
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
