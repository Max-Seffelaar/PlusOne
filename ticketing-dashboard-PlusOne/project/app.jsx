/* Mainstage HQ — root app: state, event model, theming, shell. */

const THEMES = {
  festival: ["#FF5D73", "#BFE94A", "#38D1E0", "#A98BFF", "#FFB14E"],
  neon: ["#FF49C0", "#5BE08A", "#36D6E0", "#9B6BFF", "#5B8CFF"],
  sunset: ["#FF6B5D", "#B8D15A", "#FF4FA3", "#C58BFF", "#FF9F45"],
};
const DAYS_TO_GO = { pulse26: 26, neon: 0, lowtide: 57, winterglas: 183, hemel: 336, pulse25: 0 };

function buildEventModel(id) {
  const M = window.MHQ;
  const p = M.portfolio.find((e) => e.id === id) || M.portfolio[0];
  const f = M.flagship;
  if (id === f.id) return { ...f, ...p, daysToGo: f.daysToGo, pacePct: p.pacePct };
  const factor = p.sold / f.sold;
  const sc = (n) => Math.max(1, Math.round(n * factor));
  const forecastFinal = p.status === "done" ? p.sold : p.status === "announce" ? Math.min(p.capacity, Math.round(p.sold * 6.2)) : Math.min(p.capacity, Math.round(p.sold * 1.15));
  return {
    ...p,
    avgPrice: Math.round(p.revenue / p.sold),
    pctSold: p.sold / p.capacity,
    soldToday: p.soldToday || 0,
    revenueToday: Math.round((p.soldToday || 0) * (p.revenue / p.sold)),
    forecastFinal,
    forecastPct: forecastFinal / p.capacity,
    daysToGo: DAYS_TO_GO[id] != null ? DAYS_TO_GO[id] : 30,
    lastEdition: { opkomst: p.opkomst || 0.9 },
    daily: f.daily.map((d) => ({ ...d, sold: sc(d.sold), cum: sc(d.cum) })),
    dailyLastYear: f.dailyLastYear.map((d) => ({ ...d, cum: sc(d.cum) })),
    cities: f.cities.map((c) => ({ ...c, sold: sc(c.sold), last: sc(c.last) })),
    ticketTypes: f.ticketTypes.map((t) => ({ ...t, sold: sc(t.sold) })),
    channels: f.channels.map((c) => ({ ...c, sold: sc(c.sold) })),
    scanHours: f.scanHours.map((h) => ({ ...h, in: sc(h.in) })),
    scanNowIndex: f.scanNowIndex,
    scanFinalIn: sc(f.scanFinalIn),
  };
}

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "layout": "command",
  "palette": ["#FF5D73", "#BFE94A", "#38D1E0", "#A98BFF", "#FFB14E"],
  "glow": true
}/*EDITMODE-END*/;

function useClock() {
  const [t, setT] = React.useState("");
  React.useEffect(() => {
    const tick = () => setT(new Date().toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" }));
    tick();
    const iv = setInterval(tick, 20000);
    return () => clearInterval(iv);
  }, []);
  return t;
}

const TAB_META = {
  portfolio: { title: "Portfolio", desc: "Al je events in één overzicht — klik door voor de details" },
  overzicht: { title: "Overzicht", desc: "Realtime verkoop, omzet en opkomst van dit event" },
  gastenlijst: { title: "Gastenlijst", desc: "Kassa-, online- en scan-data samengevoegd per gast" },
  prognose: { title: "Prognose", desc: "Voorspelde eindverkoop op basis van vergelijkbare events" },
  bronnen: { title: "Bronnen & integraties", desc: "Koppel ticketing, kassa en scan-data tot één bron" },
};

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [tab, setTab] = React.useState("portfolio");
  const [eventId, setEventId] = React.useState("pulse26");
  const clock = useClock();

  const P = (t.palette && t.palette.length >= 5) ? t.palette : THEMES.festival;
  const pal = { a1: P[0], a2: P[1], a3: P[2], a4: P[3], a5: P[4] };
  const event = React.useMemo(() => buildEventModel(eventId), [eventId]);

  const cssVars = {
    "--a1": pal.a1, "--a2": pal.a2, "--a3": pal.a3, "--a4": pal.a4, "--a5": pal.a5,
  };

  const openEvent = (id) => { setEventId(id); setTab("overzicht"); window.scrollTo(0, 0); };

  let view;
  if (tab === "portfolio") view = <PortfolioView portfolio={window.MHQ.portfolio} pal={pal} onOpen={openEvent} />;
  else if (tab === "overzicht") view = <OverzichtView event={event} pal={pal} layout={t.layout} />;
  else if (tab === "gastenlijst") view = <GuestlistView pal={pal} event={event} />;
  else if (tab === "prognose") view = <PrognoseView pal={pal} />;
  else view = <BronnenView pal={pal} />;

  const meta = TAB_META[tab];

  return (
    <div className={"app" + (t.glow ? " glow" : "")} style={cssVars}>
      <Sidebar active={tab} onNav={setTab} pal={pal} event={event} />
      <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <Topbar event={event} portfolio={window.MHQ.portfolio} onSelectEvent={setEventId} pal={pal} clock={clock} tab={tab} />
        <div className="content">
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, marginBottom: 18, flexWrap: "wrap" }}>
            <div>
              <h2 style={{ margin: 0, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 22, color: "#fff", letterSpacing: "-0.01em" }}>{meta.title}</h2>
              <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "rgba(255,255,255,0.45)" }}>{meta.desc}</p>
            </div>
            {tab === "overzicht" && (
              <Seg pal={pal} value={t.layout} onChange={(v) => setTweak("layout", v)} options={[{ value: "command", label: "Command" }, { value: "analytisch", label: "Analytisch" }, { value: "rapport", label: "Rapport" }]} />
            )}
          </div>
          {view}
          <div style={{ marginTop: 30, paddingTop: 16, borderTop: "1px solid var(--line)", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, fontSize: 11.5, color: "rgba(255,255,255,0.3)", fontFamily: "'JetBrains Mono', monospace" }}>
            <span>MAINSTAGE HQ · prototype met mockdata in Eventix-vorm</span>
            <span>Laatste sync 2 min geleden · {clock}</span>
          </div>
        </div>
      </main>

      <TweaksPanel>
        <TweakSection label="Layout" />
        <TweakRadio label="Overzicht-indeling" value={t.layout} options={["command", "analytisch", "rapport"]} onChange={(v) => setTweak("layout", v)} />
        <TweakSection label="Accentpalet" />
        <TweakColor label="Event-vibe" value={t.palette}
          options={[THEMES.festival, THEMES.neon, THEMES.sunset]}
          onChange={(v) => setTweak("palette", v)} />
        <TweakToggle label="Neon glow" value={t.glow} onChange={(v) => setTweak("glow", v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
