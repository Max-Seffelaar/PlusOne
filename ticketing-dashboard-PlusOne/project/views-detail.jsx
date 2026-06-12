/* Mainstage HQ — Gastenlijst, Prognose, Bronnen views. */

// ---------- small segmented control ----------
function Seg({ options, value, onChange, pal }) {
  return (
    <div style={{ display: "inline-flex", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 11, padding: 3, gap: 2 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} onClick={() => onChange(o.value)} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "none", cursor: "pointer", padding: "6px 12px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, fontFamily: "'Hanken Grotesk', sans-serif", background: on ? "rgba(255,255,255,0.1)" : "transparent", color: on ? "#fff" : "rgba(255,255,255,0.5)", transition: "all .12s" }}>
            {o.dot && <span style={{ width: 7, height: 7, borderRadius: 99, background: o.dot }} />}{o.label}
            {o.count != null && <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: "'JetBrains Mono', monospace" }}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================
// GASTENLIJST — kassa + online + lok + scan merged, filterbaar
// ============================================================
function GuestlistView({ pal, event }) {
  const fmt = window.MHQ.fmt;
  const guests = window.MHQ.guests;
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState("all");
  const [chan, setChan] = React.useState("all");

  const inCount = guests.filter((g) => g.scanned).length;
  const total = event ? event.sold : guests.length;
  const inRatio = inCount / guests.length;
  const kassaRatio = guests.filter((g) => g.channelKey === "kassa").length / guests.length;
  const scaledIn = Math.round(total * inRatio);
  const chanLabels = { online: "Eventix online", kassa: "Kassa / POS", lok: "Voorverkoop / lok" };
  const chanColor = { online: "a3", kassa: "a2", lok: "a4" };

  const filtered = guests.filter((g) => {
    if (status === "in" && !g.scanned) return false;
    if (status === "out" && g.scanned) return false;
    if (chan !== "all" && g.channelKey !== chan) return false;
    if (q && !(g.name.toLowerCase().includes(q.toLowerCase()) || g.email.toLowerCase().includes(q.toLowerCase()) || g.order.toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 13 }}>
        <Kpi label="Gasten op lijst" value={fmt.num(total)} sub="kassa + online + lok" accent="a4" pal={pal} icon="users" />
        <Kpi label="Ingecheckt" value={fmt.num(scaledIn)} sub={"opkomst " + Math.round(inRatio * 100) + "%"} accent="a1" pal={pal} icon="check" />
        <Kpi label="Nog niet binnen" value={fmt.num(total - scaledIn)} sub="verwacht aan de deur" accent="a3" pal={pal} icon="dot" />
        <Kpi label="Via kassa / POS" value={fmt.num(Math.round(total * kassaRatio))} sub="POS-koppeling" accent="a2" pal={pal} icon="ticket" />
      </div>

      <Card pal={pal} noPad style={{ overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, flex: 1, minWidth: 220, background: "var(--rail)", border: "1px solid var(--line)", borderRadius: 10, padding: "8px 12px" }}>
            <span style={{ color: "rgba(255,255,255,0.4)" }}><Icon name="search" size={16} /></span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek op naam, e-mail of ordernummer…" style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#fff", fontSize: 13.5, fontFamily: "'Hanken Grotesk', sans-serif" }} />
          </div>
          <Seg pal={pal} value={status} onChange={setStatus} options={[{ value: "all", label: "Alle" }, { value: "in", label: "Binnen", dot: pal.a1, count: inCount }, { value: "out", label: "Niet binnen", dot: "rgba(255,255,255,0.4)", count: guests.length - inCount }]} />
          <Seg pal={pal} value={chan} onChange={setChan} options={[{ value: "all", label: "Alle bronnen" }, { value: "online", label: "Online", dot: pal.a3 }, { value: "kassa", label: "Kassa", dot: pal.a2 }, { value: "lok", label: "Lok", dot: pal.a4 }]} />
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                {["Gast", "Ticketsoort", "Bron", "Order / barcode", "Status", "Scan in / uit"].map((h) => (
                  <th key={h} style={{ padding: "11px 16px", fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((g) => (
                <tr key={g.id} className="grow" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "11px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                      <span style={{ width: 32, height: 32, borderRadius: 99, flexShrink: 0, background: pal[chanColor[g.channelKey]] + "26", color: pal[chanColor[g.channelKey]], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>{g.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, color: "#fff", fontWeight: 600 }}>{g.name}</div>
                        <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.4)" }}>{g.email}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: "11px 16px", fontSize: 13, color: "rgba(255,255,255,0.8)" }}>{g.ticket}</td>
                  <td style={{ padding: "11px 16px" }}><span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "rgba(255,255,255,0.7)" }}><span style={{ width: 7, height: 7, borderRadius: 99, background: pal[chanColor[g.channelKey]] }} />{chanLabels[g.channelKey]}</span></td>
                  <td style={{ padding: "11px 16px" }}><div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.8)", fontFamily: "'JetBrains Mono', monospace" }}>{g.order}</div><div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", fontFamily: "'JetBrains Mono', monospace" }}>{g.barcode}</div></td>
                  <td style={{ padding: "11px 16px" }}>
                    {g.scanned
                      ? <Badge bg={pal.a1 + "22"} color={pal.a1} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="check" size={11} stroke={2.6} />BINNEN</Badge>
                      : <Badge bg="rgba(255,255,255,0.06)" color="rgba(255,255,255,0.5)">NIET BINNEN</Badge>}
                  </td>
                  <td style={{ padding: "11px 16px", fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5 }}>
                    {g.scanned ? <span style={{ color: "#fff" }}>{g.scanIn}{g.scanOut && <span style={{ color: "rgba(255,255,255,0.4)" }}> → {g.scanOut}</span>}</span> : <span style={{ color: "rgba(255,255,255,0.3)" }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div style={{ padding: "40px", textAlign: "center", color: "rgba(255,255,255,0.4)", fontSize: 13.5 }}>Geen gasten gevonden voor deze filter.</div>}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "11px 16px", borderTop: "1px solid var(--line)" }}>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", fontFamily: "'JetBrains Mono', monospace" }}>{filtered.length} getoond · live scan-feed sample van {fmt.num(total)} gasten</span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", fontFamily: "'JetBrains Mono', monospace" }}>auto-ververst elke 10s</span>
        </div>
      </Card>
    </div>
  );
}

// ============================================================
// PROGNOSE — voorspelling o.b.v. vergelijkbare events
// ============================================================
function PrognoseView({ pal }) {
  const fmt = window.MHQ.fmt;
  const fc = window.MHQ.forecast;
  const t = fc.target;
  const [scenario, setScenario] = React.useState("expected");
  const scenVal = scenario === "low" ? t.low : scenario === "high" ? t.high : t.predicted;
  const scenPct = scenVal / t.capacity;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* hero */}
      <Card pal={pal} noPad style={{ overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,360px) minmax(0,1fr)", gap: 0 }}>
          <div style={{ padding: "22px 24px", borderRight: "1px solid var(--line)", background: "linear-gradient(160deg," + pal.a4 + "14, transparent)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ color: pal.a4 }}><Icon name="forecast" size={18} /></span>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: pal.a4, fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.06em" }}>VOORSPELDE EINDVERKOOP</span>
            </div>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 16, color: "#fff", marginBottom: 2 }}>{t.name}</div>
            <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.45)", marginBottom: 18 }}>{t.venue} · {t.dateLabel} · nog {t.daysToGo} dagen</div>

            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 52, color: "#fff", lineHeight: 1, letterSpacing: "-0.02em" }}>{fmt.num(scenVal)}</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: pal.a4, fontFamily: "'JetBrains Mono', monospace" }}>{Math.round(scenPct * 100)}%</span>
            </div>
            <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.5)", marginTop: 6, fontFamily: "'JetBrains Mono', monospace" }}>bandbreedte {fmt.num(t.low)} – {fmt.num(t.high)}</div>

            <div style={{ marginTop: 18, marginBottom: 8, fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.06em" }}>SCENARIO</div>
            <Seg pal={pal} value={scenario} onChange={setScenario} options={[{ value: "low", label: "Conservatief" }, { value: "expected", label: "Verwacht" }, { value: "high", label: "Optimistisch" }]} />

            <div style={{ marginTop: 20, display: "flex", gap: 18 }}>
              <div><div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: "'JetBrains Mono', monospace" }}>NU VERKOCHT</div><div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 20, color: "#fff" }}>{fmt.num(t.soldNow)}</div></div>
              <div><div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: "'JetBrains Mono', monospace" }}>BETROUWBAARHEID</div><div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 20, color: pal.a2 }}>{Math.round(t.confidence * 100)}%</div></div>
            </div>
          </div>
          <div style={{ padding: "18px 20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 600, color: "#fff" }}>Verkoopprojectie tot eventdag</h3>
              <div style={{ display: "flex", gap: 16 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "rgba(255,255,255,0.6)" }}><span style={{ width: 14, height: 3, background: pal.a3, borderRadius: 2 }} />Werkelijk</span>
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "rgba(255,255,255,0.6)" }}><span style={{ width: 14, height: 0, borderTop: "2px dotted " + pal.a4 }} />Voorspeld</span>
              </div>
            </div>
            <ForecastChart curve={fc.curve} pal={pal} capacity={t.capacity} height={262} />
          </div>
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)", gap: 16 }}>
        <Card title="Vergelijkbare events" sub="Historische events die het model gebruikt · gesorteerd op gelijkenis" accent="a3" pal={pal}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 1.4fr", gap: 10, padding: "0 4px 8px", fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.06em", fontFamily: "'JetBrains Mono', monospace", borderBottom: "1px solid var(--line)" }}>
              <span>EVENT</span><span style={{ textAlign: "right" }}>VERKOCHT</span><span style={{ textAlign: "right" }}>OPKOMST</span><span style={{ textAlign: "right" }}>GELIJKENIS</span>
            </div>
            {fc.comparable.map((c) => (
              <div key={c.name} style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 1.4fr", gap: 10, padding: "11px 4px", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <div style={{ minWidth: 0 }}><div style={{ fontSize: 13, color: "#fff", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div><div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{c.venue} · cap {fmt.num(c.capacity)}</div></div>
                <div style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: "#fff", fontWeight: 700 }}>{fmt.num(c.finalSold)}</div>
                <div style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: "rgba(255,255,255,0.7)" }}>{Math.round(c.opkomst * 100)}%</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                  <div style={{ width: 56, height: 6, borderRadius: 4, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}><div style={{ width: c.similarity * 100 + "%", height: "100%", background: pal.a3, borderRadius: 4 }} /></div>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, color: pal.a3, fontWeight: 700, width: 34, textAlign: "right" }}>{Math.round(c.similarity * 100)}%</span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Wat stuurt de voorspelling" sub="Belangrijkste factoren in het model" accent="a5" pal={pal}>
          <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
            {fc.drivers.map((d) => {
              const c = d.dir === "up" ? pal.a2 : d.dir === "down" ? pal.a1 : "rgba(255,255,255,0.5)";
              const arrow = d.dir === "up" ? "▲" : d.dir === "down" ? "▼" : "●";
              return (
                <div key={d.label} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 11, background: "var(--rail)", border: "1px solid var(--line)" }}>
                  <span style={{ color: c, fontSize: 13, fontFamily: "'JetBrains Mono', monospace", width: 14 }}>{arrow}</span>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, color: "#fff", fontWeight: 500 }}>{d.label}</div><div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: "'JetBrains Mono', monospace" }}>impact: {d.weight}</div></div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: c, fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap" }}>{d.value}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ============================================================
// BRONNEN — integraties / databronnen koppelen
// ============================================================
function BronnenView({ pal }) {
  const [sources, setSources] = React.useState(window.MHQ.sources);
  const connected = sources.filter((s) => s.status === "connected").length;

  const toggle = (name) => setSources((prev) => prev.map((s) => {
    if (s.name !== name) return s;
    if (s.status === "available") return { ...s, status: "connected", lastSync: "Net gekoppeld", records: "Synchroniseert…" };
    if (s.status === "connected") return { ...s, status: "available", lastSync: "Niet gekoppeld", records: "—" };
    return s;
  }));

  const statusMeta = {
    connected: { label: "GEKOPPELD", c: pal.a2 },
    syncing: { label: "SYNCHRONISEERT", c: pal.a3 },
    available: { label: "BESCHIKBAAR", c: "rgba(255,255,255,0.45)" },
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card pal={pal} style={{ padding: 0 }} noPad>
        <div style={{ display: "flex", alignItems: "center", gap: 20, padding: "18px 22px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
            <span style={{ width: 44, height: 44, borderRadius: 12, background: pal.a3 + "1f", color: pal.a3, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="plug" size={22} /></span>
            <div>
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 18, color: "#fff" }}>{connected} bronnen gekoppeld</div>
              <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.45)" }}>Eén dashboard, alle ticketdata realtime samengevoegd</div>
            </div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 22 }}>
            {[["Orders gesync.", "15.240"], ["Transacties POS", "1.980"], ["Scans vandaag", "live"]].map(([l, v]) => (
              <div key={l}><div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: "'JetBrains Mono', monospace" }}>{l.toUpperCase()}</div><div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 19, color: "#fff" }}>{v}</div></div>
            ))}
          </div>
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(330px,1fr))", gap: 16 }}>
        {sources.map((s) => {
          const m = statusMeta[s.status];
          const isConn = s.status === "connected" || s.status === "syncing";
          return (
            <div key={s.name} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: "18px 18px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ width: 42, height: 42, borderRadius: 11, background: pal[s.accent] + "1f", color: pal[s.accent], display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 16 }}>{s.name[0]}</span>
                  <div><div style={{ fontSize: 15, fontWeight: 700, color: "#fff", fontFamily: "'Space Grotesk', sans-serif" }}>{s.name}</div><div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.42)" }}>{s.type}</div></div>
                </div>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 700, color: m.c, fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap" }}>
                  {s.status === "syncing" ? <span className="ping" style={{ width: 7, height: 7, borderRadius: 99, background: m.c, position: "relative" }} /> : <span style={{ width: 7, height: 7, borderRadius: 99, background: m.c }} />}{m.label}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: 12.5, color: "rgba(255,255,255,0.55)", lineHeight: 1.5 }}>{s.note}</p>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 12, borderTop: "1px solid var(--line)" }}>
                <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.4)", fontFamily: "'JetBrains Mono', monospace" }}>{isConn ? "Sync: " + s.lastSync : s.lastSync}<div style={{ color: "rgba(255,255,255,0.6)", marginTop: 1 }}>{s.records}</div></div>
                <button onClick={() => toggle(s.name)} style={{ border: isConn ? "1px solid var(--line)" : "none", background: isConn ? "transparent" : pal[s.accent], color: isConn ? "rgba(255,255,255,0.6)" : "#15151d", fontWeight: 700, fontSize: 12.5, padding: "8px 14px", borderRadius: 9, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif" }}>
                  {isConn ? "Beheer" : "Koppel"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

Object.assign(window, { GuestlistView, PrognoseView, BronnenView, Seg });
