/* Mainstage HQ — Portfolio + Overzicht views (Overzicht has 3 layout variants). */

const F = () => window.MHQ.fmt;

// ============================================================
// PORTFOLIO — overview of all events, click to drill in
// ============================================================
function PortfolioView({ portfolio, pal, onOpen }) {
  const fmt = F();
  const totals = portfolio.reduce((a, p) => ({ sold: a.sold + p.sold, rev: a.rev + p.revenue, cap: a.cap + p.capacity }), { sold: 0, rev: 0, cap: 0 });
  const liveCount = portfolio.filter((p) => p.status === "selling" || p.status === "live").length;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 14 }}>
        <Kpi label="Tickets verkocht" value={fmt.num(totals.sold)} sub={"over " + portfolio.length + " events"} accent="a1" pal={pal} icon="ticket" big />
        <Kpi label="Totale omzet" value={fmt.eurC(totals.rev)} sub={"gem. " + fmt.eur(totals.rev / totals.sold) + " p/ticket"} accent="a2" pal={pal} icon="bolt" big />
        <Kpi label="Actief in verkoop" value={liveCount} unit="events" sub="realtime gevolgd" accent="a3" pal={pal} icon="pulse" big />
        <Kpi label="Gem. bezetting" value={Math.round((totals.sold / totals.cap) * 100)} unit="%" sub="van capaciteit" accent="a4" pal={pal} icon="grid" big />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(330px,1fr))", gap: 16 }}>
        {portfolio.map((p) => {
          const pct = p.sold / p.capacity;
          const col = pal[p.accent || "a1"];
          const spark = window.MHQ.daily.slice(-22).map((d) => d.sold * (p.sold / window.MHQ.flagship.sold));
          return (
            <button key={p.id} onClick={() => onOpen(p.id)} className="evcard" style={{ textAlign: "left", border: "1px solid var(--line)", background: "var(--surface)", borderRadius: 18, padding: 0, cursor: "pointer", overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <div style={{ height: 4, background: col }} />
              <div style={{ padding: "16px 18px 18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 14 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 17, color: "#fff", letterSpacing: "-0.01em", marginBottom: 4 }}>{p.name}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "rgba(255,255,255,0.45)" }}><Icon name="pin" size={12} />{p.venue}</div>
                  </div>
                  <StatusPill status={p.status} statusLabel={p.statusLabel} pal={pal} live={p.status === "live"} />
                </div>

                <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                  <div>
                    <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 24, color: "#fff", lineHeight: 1 }}>{fmt.num(p.sold)}</div>
                    <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.42)", marginTop: 3 }}>van {fmt.num(p.capacity)} · {fmt.eurC(p.revenue)}</div>
                  </div>
                  <Sparkline data={spark} color={col} width={84} height={32} />
                </div>

                <div style={{ position: "relative", height: 7, borderRadius: 6, background: "rgba(255,255,255,0.06)", overflow: "hidden", marginTop: 6 }}>
                  <div style={{ position: "absolute", inset: 0, width: pct * 100 + "%", background: col, borderRadius: 6, boxShadow: "0 0 10px " + col + "66" }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11.5, fontFamily: "'JetBrains Mono', monospace" }}>
                  <span style={{ color: col, fontWeight: 700 }}>{Math.round(pct * 100)}% bezet</span>
                  <span style={{ color: "rgba(255,255,255,0.4)" }}>{p.dateLabel}</span>
                  {p.pacePct != null && p.status !== "done" && <span style={{ color: p.pacePct >= 0 ? pal.a2 : pal.a1, fontWeight: 700 }}>{p.pacePct >= 0 ? "+" : ""}{p.pacePct}% vs '25</span>}
                  {p.status === "done" && <span style={{ color: "rgba(255,255,255,0.5)" }}>opkomst {Math.round(p.opkomst * 100)}%</span>}
                  {p.status === "live" && p.scannedIn != null && <span style={{ color: pal.a1, fontWeight: 700 }}>{fmt.num(p.scannedIn)} binnen</span>}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// Overzicht building blocks (reused across layout variants)
// ============================================================
function KpiRow({ event, pal, columns }) {
  const fmt = F();
  const e = event;
  const spark14 = e.daily.slice(-14).map((d) => d.sold);
  const items = [
    <Kpi key="1" label="Tickets verkocht" value={fmt.num(e.sold)} sub={"van " + fmt.num(e.capacity)} trend={e.pacePct} accent="a1" pal={pal} icon="ticket" spark={spark14} />,
    <Kpi key="2" label="Omzet" value={fmt.eurC(e.revenue)} sub={"gem. " + fmt.eur(e.avgPrice) + " p/t"} accent="a2" pal={pal} icon="bolt" />,
    <Kpi key="3" label="Vandaag" value={"+" + fmt.num(e.soldToday)} sub={fmt.eur(e.revenueToday) + " omzet"} accent="a3" pal={pal} icon="arrowUp" />,
    <Kpi key="4" label="Capaciteit" value={Math.round(e.pctSold * 100)} unit="%" sub={fmt.num(e.capacity - e.sold) + " te gaan"} accent="a4" pal={pal} icon="grid" />,
    <Kpi key="5" label="Prognose eindstand" value={fmt.num(e.forecastFinal)} sub={Math.round(e.forecastPct * 100) + "% — bijna uitverkocht"} accent="a5" pal={pal} icon="forecast" />,
    <Kpi key="6" label="Opkomst vorige editie" value={Math.round(e.lastEdition.opkomst * 100)} unit="%" sub={"no-show " + Math.round((1 - e.lastEdition.opkomst) * 100) + "%"} accent="a1" pal={pal} icon="users" />,
  ];
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(" + (columns || "auto-fit,minmax(180px,1fr)") + ")", gap: 13 }}>{items}</div>;
}

function DailyBlock({ event, pal }) {
  return <Card title="Verkoop per dag" sub="Dagelijkse ticketverkoop sinds on-sale" accent="a1" pal={pal} style={{ height: "100%" }}
    action={<Badge bg={pal.a1 + "1f"} color={pal.a1}>{event.daysToGo} DAGEN TE GAAN</Badge>}>
    <DailyArea data={event.daily} pal={pal} accent="a1" height={250} />
  </Card>;
}

function CompareBlock({ event, pal }) {
  const fmt = F();
  const diff = event.daily[event.daily.length - 1].cum - event.dailyLastYear[event.dailyLastYear.length - 1].cum;
  return <Card title="Vergelijking met vorig jaar" sub="Cumulatieve verkoop dit jaar vs. editie 2025" accent="a3" pal={pal} style={{ height: "100%" }}
    action={<Badge bg={pal.a2 + "1f"} color={pal.a2}>{diff >= 0 ? "+" : ""}{fmt.num(diff)} VOOR</Badge>}>
    <CompareLines data={event.daily} last={event.dailyLastYear} pal={pal} height={222} />
    <div style={{ display: "flex", gap: 18, marginTop: 6, paddingLeft: 4 }}>
      <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "rgba(255,255,255,0.6)" }}><span style={{ width: 16, height: 3, borderRadius: 2, background: pal.a3 }} />Dit jaar</span>
      <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "rgba(255,255,255,0.6)" }}><span style={{ width: 16, height: 0, borderTop: "2px dashed rgba(255,255,255,0.5)" }} />Editie 2025</span>
    </div>
  </Card>;
}

function CitiesBlock({ event, pal }) {
  const fmt = F();
  return <Card title="Verkoop per stad" sub="Top regio's · balk = dit jaar, schaduw = 2025" accent="a4" pal={pal} style={{ height: "100%" }}>
    <BarList items={event.cities} pal={pal} accent="a4" valueKey="sold" compareKey="last" fmt={fmt.num} maxBars={9} />
  </Card>;
}

function TicketsBlock({ event, pal }) {
  const fmt = F();
  return <Card title="Verdeling per ticketsoort" accent="a2" pal={pal} style={{ height: "100%" }}>
    <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
      <Donut items={event.ticketTypes} pal={pal} size={156} centerLabel={fmt.num(event.sold)} centerSub="TICKETS" />
      <div style={{ flex: 1, minWidth: 150, display: "flex", flexDirection: "column", gap: 9 }}>
        {event.ticketTypes.map((t) => (
          <div key={t.name} style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: pal[t.accent], flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 12.5, color: "rgba(255,255,255,0.82)", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}{t.status === "soldout" && <span style={{ color: pal.a1, fontSize: 10, marginLeft: 6, fontWeight: 700 }}>UITVERKOCHT</span>}</span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "#fff", fontFamily: "'JetBrains Mono', monospace" }}>{fmt.num(t.sold)}</span>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: "'JetBrains Mono', monospace", width: 52, textAlign: "right" }}>{fmt.eurC(t.sold * t.price)}</span>
          </div>
        ))}
      </div>
    </div>
  </Card>;
}

function ChannelsBlock({ event, pal }) {
  const fmt = F();
  const data = event.channels.map((c) => ({ ...c, pct: Math.round((c.sold / event.sold) * 100) }));
  return <Card title="Verkoopkanaal" sub="Online · kassa · voorverkoop" accent="a3" pal={pal} style={{ height: "100%" }}>
    <BarList items={data} pal={pal} valueKey="sold" fmt={fmt.num} />
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 14, paddingTop: 13, borderTop: "1px solid var(--line)" }}>
      {data.map((c) => <span key={c.name} style={{ fontSize: 10.5, color: "rgba(255,255,255,0.45)", fontFamily: "'JetBrains Mono', monospace", display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: 99, background: pal[c.accent] }} />{c.source}</span>)}
    </div>
  </Card>;
}

function ScanBlock({ event, pal }) {
  const fmt = F();
  const opkomst = event.lastEdition.opkomst;
  return <Card title="Opkomst & scan-voortgang" sub="Benchmark vorige editie · live op de eventdag" accent="a1" pal={pal} style={{ height: "100%" }}
    action={<Badge bg="rgba(255,255,255,0.06)" color="rgba(255,255,255,0.55)">VORIGE EDITIE</Badge>}>
    <div style={{ display: "flex", gap: 18, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: 22 }}>
        <div><div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", fontFamily: "'JetBrains Mono', monospace" }}>OPKOMST</div><div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 24, color: pal.a1 }}>{Math.round(opkomst * 100)}%</div></div>
        <div><div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", fontFamily: "'JetBrains Mono', monospace" }}>BINNEN GESCAND</div><div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 24, color: "#fff" }}>{fmt.num(event.scanFinalIn)}</div></div>
        <div><div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", fontFamily: "'JetBrains Mono', monospace" }}>NO-SHOW</div><div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 24, color: "rgba(255,255,255,0.6)" }}>{Math.round((1 - opkomst) * 100)}%</div></div>
      </div>
    </div>
    <ScanProgress data={event.scanHours} nowIndex={event.scanNowIndex} pal={pal} accent="a1" height={184} />
  </Card>;
}

function CapacityBlock({ event, pal }) {
  const fmt = F();
  const soldPct = event.pctSold, fcPct = event.forecastPct;
  return <Card title="Capaciteit & prognose" accent="a5" pal={pal} style={{ height: "100%" }}>
    <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
      <Ring pct={soldPct} pal={pal} accent="a4" size={104} label="VERKOCHT" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 4 }}>Verwachte eindstand</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 30, color: "#fff" }}>{fmt.num(event.forecastFinal)}</span>
          <span style={{ fontSize: 13, color: pal.a5, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{Math.round(fcPct * 100)}%</span>
        </div>
        <div style={{ position: "relative", height: 12, borderRadius: 7, background: "rgba(255,255,255,0.06)", marginTop: 12, overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, width: fcPct * 100 + "%", background: pal.a5 + "44", borderRadius: 7 }} />
          <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: soldPct * 100 + "%", background: pal.a4, borderRadius: 7 }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 7, fontSize: 10.5, fontFamily: "'JetBrains Mono', monospace" }}>
          <span style={{ color: pal.a4 }}>● nu {fmt.num(event.sold)}</span>
          <span style={{ color: "rgba(255,255,255,0.4)" }}>cap {fmt.num(event.capacity)}</span>
        </div>
      </div>
    </div>
  </Card>;
}

// ============================================================
// OVERZICHT — three layout variants
// ============================================================
function OverzichtView({ event, pal, layout }) {
  const blocks = {
    daily: <DailyBlock event={event} pal={pal} />,
    compare: <CompareBlock event={event} pal={pal} />,
    cities: <CitiesBlock event={event} pal={pal} />,
    tickets: <TicketsBlock event={event} pal={pal} />,
    channels: <ChannelsBlock event={event} pal={pal} />,
    scan: <ScanBlock event={event} pal={pal} />,
    capacity: <CapacityBlock event={event} pal={pal} />,
  };

  if (layout === "analytisch") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <KpiRow event={event} pal={pal} columns="auto-fit,minmax(150px,1fr)" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 16 }}>
          {blocks.daily}{blocks.compare}{blocks.cities}{blocks.tickets}{blocks.channels}{blocks.scan}{blocks.capacity}
        </div>
      </div>
    );
  }

  if (layout === "rapport") {
    return (
      <div style={{ maxWidth: 860, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
        <KpiRow event={event} pal={pal} columns="3,1fr" />
        {blocks.daily}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>{blocks.capacity}{blocks.tickets}</div>
        {blocks.compare}
        {blocks.cities}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>{blocks.channels}{blocks.scan}</div>
      </div>
    );
  }

  // default: 'command' — control-room hero layout
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <KpiRow event={event} pal={pal} columns="auto-fit,minmax(180px,1fr)" />
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.55fr) minmax(0,1fr)", gap: 16 }}>
        {blocks.daily}{blocks.capacity}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16 }}>
        {blocks.compare}{blocks.cities}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) minmax(0,1.1fr)", gap: 16 }}>
        {blocks.tickets}{blocks.channels}{blocks.scan}
      </div>
    </div>
  );
}

Object.assign(window, { PortfolioView, OverzichtView });
