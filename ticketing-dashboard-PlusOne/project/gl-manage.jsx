/* Gastenlijst wireframe — desktop management screens + DesignCanvas composition + mount. */

const G2 = window.GLDATA.GUESTS;
const mail = (n) => n.toLowerCase().replace("'", "").replace(/ /g, ".").replace("..", ".") + "@mail.nl";

// ===========================================================
// GASTENLIJST PER EVENT (desktop)
// ===========================================================
function GuestlistEvent() {
  return <Win title="mainstage.app/events/pulse-open-air/gastenlijst">
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "20px 24px", gap: 16, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div><div style={{ fontFamily: GL.disp, fontWeight: 700, fontSize: 22, color: GL.text }}>Gastenlijst · PULSE Open Air</div><div style={{ fontSize: 13, color: GL.dim, marginTop: 3 }}>148 op de lijst · 212 koppen incl. meegenomen gasten</div></div>
        <div style={{ minWidth: 190, padding: "11px 14px", borderRadius: 12, background: GL.panel, border: "1px solid " + GL.line }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}><Lbl>Jouw toelage · Joris</Lbl><span style={{ fontFamily: GL.mono, fontSize: 12, color: GL.amber, fontWeight: 700 }}>7 / 10</span></div>
          <div style={{ height: 7, borderRadius: 4, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}><div style={{ width: "70%", height: "100%", background: GL.amber, borderRadius: 4 }} /></div>
        </div>
      </div>

      {/* quick add */}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <Lbl style={{ marginRight: 2 }}>Snel toevoegen</Lbl>
        <Btn sm kind="dash" icon="paste">Plak namen</Btn>
        <Btn sm kind="dash" icon="share">Deel contact</Btn>
        <Btn sm kind="dash" icon="contact">Uit adresboek</Btn>
        <Btn sm kind="primary" icon="plus">Handmatig</Btn>
        <div style={{ flex: 1 }} />
        <Field icon="search" placeholder="Zoek gast…" value="" style={{ width: 200 }} />
        <Btn sm kind="ghost" icon="filter">Filter</Btn>
      </div>

      {/* table */}
      <div style={{ flex: 1, minHeight: 0, border: "1px solid " + GL.line, borderRadius: 14, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "grid", gridTemplateColumns: "2.4fr 1.1fr 0.7fr 1.2fr 1.5fr 1fr 0.9fr", gap: 10, padding: "11px 16px", borderBottom: "1px solid " + GL.line, background: GL.device }}>
          {["Gast", "Rol", "+Gasten", "Betaling", "Notitie", "Door", "Status"].map((h) => <Lbl key={h}>{h}</Lbl>)}
        </div>
        <div style={{ flex: 1, overflow: "hidden" }}>
          {G2.map((g, i) => <div key={g.name} style={{ display: "grid", gridTemplateColumns: "2.4fr 1.1fr 0.7fr 1.2fr 1.5fr 1fr 0.9fr", gap: 10, padding: "10px 16px", alignItems: "center", borderBottom: "1px solid " + GL.line2 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}><Avatar name={g.name} accent={roleAccent(g.role)} size={34} /><div style={{ minWidth: 0 }}><div style={{ fontSize: 13.5, fontWeight: 600, color: GL.text }}>{g.name}</div><div style={{ fontSize: 11, color: GL.faint, fontFamily: GL.mono, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{mail(g.name)}</div></div></div>
            <div><RoleTag role={g.role} /></div>
            <div style={{ fontFamily: GL.mono, fontSize: 13, color: g.plus ? GL.text : GL.faint }}>{g.plus ? "+" + g.plus : "—"}</div>
            <div><PayTag status={g.pay} /></div>
            <div style={{ fontSize: 12, color: g.note ? GL.dim : GL.faint, minWidth: 0, display: "flex", alignItems: "center", gap: 6 }}>{g.note ? <><GIcon name="note" size={13} color={GL.violet} /><span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.note}</span></> : "—"}</div>
            <div style={{ fontSize: 12, color: GL.dim, fontFamily: GL.mono }}>{g.by}</div>
            <div>{g.status === "in" ? <StatusTag status="in" /> : <StatusTag status="onderweg" />}</div>
          </div>)}
        </div>
      </div>
    </div>
  </Win>;
}

// ===========================================================
// CONTACTEN / ADRESBOEK + VASTE GASTEN
// ===========================================================
const CONTACTS = [
  { name: "Anouk Smit", events: 21, tags: ["VIP"], vast: true },
  { name: "Femke Bakker", events: 17, tags: ["VIP"], vast: true },
  { name: "Lieke Hofman", events: 14, tags: ["VIP"], vast: true },
  { name: "Julia Kok", events: 11, tags: ["All Access"], vast: false },
  { name: "Daan Verhoeven", events: 9, tags: ["Artist"], vast: false },
  { name: "Noor van Dijk", events: 8, tags: ["All Access"], vast: false },
  { name: "Sven Mulder", events: 6, tags: ["Pers"], vast: false },
  { name: "Bram Jansen", events: 3, tags: ["Gast"], vast: false },
];
function AddressBook() {
  const [vast, setVast] = React.useState(() => new Set(CONTACTS.filter((c) => c.vast).map((c) => c.name)));
  const toggle = (n) => setVast((s) => { const x = new Set(s); x.has(n) ? x.delete(n) : x.add(n); return x; });
  return <Win title="mainstage.app/contacten">
    <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "1.5fr 1fr" }}>
      <div style={{ borderRight: "1px solid " + GL.line2, padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}><div><div style={{ fontFamily: GL.disp, fontWeight: 700, fontSize: 20, color: GL.text }}>Adresboek</div><div style={{ fontSize: 12.5, color: GL.dim, marginTop: 2 }}>1.284 opgeslagen contacten — herbruik in één klik</div></div><Btn sm kind="ghost" icon="upload">Importeer</Btn></div>
        <Field icon="search" placeholder="Zoek op naam, e-mail of tag…" value="" />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, overflow: "hidden" }}>
          {CONTACTS.map((c) => <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 12, border: "1px solid " + GL.line, background: GL.panel }}>
            <Avatar name={c.name} accent={roleAccent(c.tags[0])} size={36} />
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 14, fontWeight: 600, color: GL.text }}>{c.name}</div><div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 3 }}><RoleTag role={c.tags[0]} /><span style={{ fontSize: 11, color: GL.faint, fontFamily: GL.mono }}>{c.events}× op een lijst</span></div></div>
            <button className="glbtn" onClick={() => toggle(c.name)} title="Altijd toevoegen" style={{ width: 34, height: 34, borderRadius: 9, border: "1px solid " + (vast.has(c.name) ? GL.amber : GL.line), background: vast.has(c.name) ? GL.amber + "1e" : "transparent", color: vast.has(c.name) ? GL.amber : GL.faint, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><GIcon name="star" size={16} fill={vast.has(c.name) ? GL.amber : "none"} color={vast.has(c.name) ? GL.amber : GL.faint} /></button>
            <Btn sm kind="primary" icon="plus">Event</Btn>
          </div>)}
        </div>
      </div>
      <div style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14, background: GL.device }}>
        <div><div style={{ display: "flex", alignItems: "center", gap: 8 }}><GIcon name="star" size={18} color={GL.amber} fill={GL.amber} /><div style={{ fontFamily: GL.disp, fontWeight: 700, fontSize: 18, color: GL.text }}>Vaste gasten</div></div><div style={{ fontSize: 12.5, color: GL.dim, marginTop: 3 }}>Staan automatisch op élke nieuwe gastenlijst. Eén keer instellen, daarna niets meer doen.</div></div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
          {[...vast].map((n) => { const c = CONTACTS.find((x) => x.name === n); return <div key={n} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 11, border: "1px solid " + GL.amber + "33", background: GL.amber + "0e" }}>
            <Avatar name={n} accent={GL.amber} size={32} />
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13.5, fontWeight: 600, color: GL.text }}>{n}</div><div style={{ fontSize: 11, color: GL.faint, fontFamily: GL.mono }}>auto · {c ? c.tags[0] : "Gast"}</div></div>
            <button className="glbtn" onClick={() => toggle(n)} style={{ background: "none", border: "none", color: GL.faint, cursor: "pointer" }}><GIcon name="x" size={16} /></button>
          </div>; })}
        </div>
        <div style={{ padding: 12, border: "1.5px dashed " + GL.line, borderRadius: 11, fontSize: 12, color: GL.faint, fontFamily: GL.mono, textAlign: "center" }}>+ sleep een contact hierheen om vast te zetten</div>
      </div>
    </div>
  </Win>;
}

// ===========================================================
// BULK IMPORT
// ===========================================================
function BulkImport() {
  const rows = [
    { n: "Anouk Smit", s: "dup", m: "Anouk Smit · 21×" }, { n: "Pim Scholten", s: "new" },
    { n: "Femke Bakker", s: "dup", m: "Femke Bakker · 17×" }, { n: "Teun Postma", s: "new" },
    { n: "Wout Dekker", s: "new" }, { n: "Lieke Hofman", s: "dup", m: "Lieke Hofman · 14×" },
    { n: "Esmee Brouwer", s: "new" },
  ];
  return <Win title="Importeer gasten">
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "22px 24px", gap: 16, overflow: "hidden" }}>
      <div><div style={{ fontFamily: GL.disp, fontWeight: 700, fontSize: 21, color: GL.text }}>Importeer gasten</div><div style={{ fontSize: 13, color: GL.dim, marginTop: 3 }}>Iedereen die ooit op een lijst stond in één keer in het adresboek.</div></div>
      <div style={{ display: "flex", gap: 8 }}>{[["paste", "Plak lijst", true], ["upload", "CSV / Excel", false], ["phone", "Telefooncontacten", false], ["ticket", "Vorig event", false]].map(([ic, l, on]) => <div key={l} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600, fontFamily: GL.disp, cursor: "pointer", color: on ? GL.ink : GL.dim, background: on ? GL.cyan : "rgba(255,255,255,0.04)", border: "1px solid " + (on ? GL.cyan : GL.line) }}><GIcon name={ic} size={15} color={on ? GL.ink : GL.dim} />{l}</div>)}</div>
      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div style={{ border: "1.5px dashed " + GL.line, borderRadius: 13, padding: 16, display: "flex", flexDirection: "column", background: GL.device }}>
          <Lbl style={{ marginBottom: 10 }}>Plak namen (één per regel)</Lbl>
          <div style={{ flex: 1, fontFamily: GL.mono, fontSize: 13, color: GL.dim, lineHeight: 1.9 }}>{rows.map((r) => <div key={r.n}>{r.n}</div>)}<span style={{ color: GL.primary }}>▌</span></div>
        </div>
        <div style={{ border: "1px solid " + GL.line, borderRadius: 13, padding: 16, display: "flex", flexDirection: "column", gap: 8, overflow: "hidden", background: GL.panel }}>
          <Lbl style={{ marginBottom: 2 }}>Herkend · dubbele worden gekoppeld</Lbl>
          {rows.map((r) => <div key={r.n} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderRadius: 9, background: GL.device }}>
            <Avatar name={r.n} accent={r.s === "dup" ? GL.green : GL.cyan} size={28} />
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, color: GL.text, fontWeight: 600 }}>{r.n}</div>{r.m && <div style={{ fontSize: 10.5, color: GL.faint, fontFamily: GL.mono }}>match: {r.m}</div>}</div>
            <Tag label={r.s === "dup" ? "BESTAAT AL" : "NIEUW"} color={r.s === "dup" ? GL.green : GL.cyan} />
          </div>)}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 4 }}>
        <div style={{ display: "flex", gap: 18, fontFamily: GL.mono, fontSize: 12.5 }}><span style={{ color: GL.text }}><b>142</b> herkend</span><span style={{ color: GL.cyan }}><b>18</b> nieuw</span><span style={{ color: GL.green }}><b>124</b> gekoppeld</span></div>
        <Btn kind="primary" icon="check">Importeer 142 gasten</Btn>
      </div>
    </div>
  </Win>;
}

// ===========================================================
// TOTAAL DASHBOARD (alle events)
// ===========================================================
function TotaalDashboard() {
  const evs = [{ n: "PULSE Open Air", l: 148, b: 96, c: GL.primary }, { n: "Neon Nights", l: 64, b: 64, c: GL.cyan }, { n: "Winterglas Indoor", l: 51, b: 0, c: GL.green }, { n: "Lowtide Weekender", l: 92, b: 0, c: GL.amber }];
  const maxL = 150;
  return <Win title="mainstage.app/gastenlijsten/overzicht">
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "20px 24px", gap: 16, overflow: "hidden" }}>
      <div style={{ fontFamily: GL.disp, fontWeight: 700, fontSize: 22, color: GL.text }}>Gastenlijst — totaal overzicht</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
        {[["Unieke contacten", "1.284", GL.cyan, "contact"], ["Op lijst dit seizoen", "355", GL.primary, "users"], ["Gem. opkomst lijst", "82%", GL.green, "checkc"], ["Vaste gasten", "12", GL.amber, "star"]].map(([l, v, c, ic]) => <div key={l} style={{ padding: "15px 16px", borderRadius: 14, background: GL.panel, border: "1px solid " + GL.line }}><div style={{ display: "flex", justifyContent: "space-between" }}><Lbl color={c}>{l}</Lbl><GIcon name={ic} size={15} color={c} /></div><div style={{ fontFamily: GL.disp, fontWeight: 700, fontSize: 30, color: GL.text, marginTop: 8 }}>{v}</div></div>)}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 14 }}>
        <div style={{ padding: 16, borderRadius: 14, background: GL.panel, border: "1px solid " + GL.line, display: "flex", flexDirection: "column", gap: 13 }}>
          <Lbl>Per event · op de lijst vs. binnen</Lbl>
          {evs.map((e) => <div key={e.n}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}><span style={{ fontSize: 13, color: GL.text, fontWeight: 600 }}>{e.n}</span><span style={{ fontFamily: GL.mono, fontSize: 12, color: GL.dim }}>{e.b}/{e.l}{e.b > 0 ? " · " + Math.round(e.b / e.l * 100) + "%" : " · komt nog"}</span></div>
            <div style={{ position: "relative", height: 10, borderRadius: 6, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}><div style={{ position: "absolute", inset: 0, width: e.l / maxL * 100 + "%", background: e.c + "33", borderRadius: 6 }} /><div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: e.b / maxL * 100 + "%", background: e.c, borderRadius: 6 }} /></div></div>)}
        </div>
        <div style={{ padding: 16, borderRadius: 14, background: GL.panel, border: "1px solid " + GL.line, display: "flex", flexDirection: "column", gap: 9, overflow: "hidden" }}>
          <Lbl>Meest uitgenodigd</Lbl>
          {CONTACTS.slice(0, 5).map((c, i) => <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 10 }}><span style={{ fontFamily: GL.mono, fontSize: 12, color: GL.faint, width: 16 }}>{i + 1}</span><Avatar name={c.name} accent={roleAccent(c.tags[0])} size={28} /><div style={{ flex: 1, fontSize: 13, color: GL.text, fontWeight: 600 }}>{c.name}</div><span style={{ fontFamily: GL.mono, fontSize: 12.5, color: GL.cyan, fontWeight: 700 }}>{c.events}×</span></div>)}
        </div>
      </div>
    </div>
  </Win>;
}

// ===========================================================
// ROLLEN & TOELAGES
// ===========================================================
function RollenToelages() {
  const team = [{ n: "Max Seffelaar", r: "Eigenaar", a: "Unlimited", used: 42, max: null }, { n: "Sanne de Vries", r: "Manager", a: "10", used: 7, max: 10 }, { n: "Joris Willems", r: "Host", a: "5", used: 5, max: 5 }, { n: "Eva Timmermans", r: "Promotor", a: "10", used: 3, max: 10 }];
  return <Win title="mainstage.app/team/toelages">
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "20px 24px", gap: 16, overflow: "hidden" }}>
      <div><div style={{ fontFamily: GL.disp, fontWeight: 700, fontSize: 22, color: GL.text }}>Rollen & toelages</div><div style={{ fontSize: 13, color: GL.dim, marginTop: 3 }}>Standaard mag elk teamlid X gasten per event toevoegen — per event op te hogen.</div></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Lbl>Standaard toelage per teamlid</Lbl>
        {team.map((t) => <div key={t.n} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", borderRadius: 13, background: GL.panel, border: "1px solid " + GL.line }}>
          <Avatar name={t.n} accent={GL.cyan} size={38} />
          <div style={{ width: 190 }}><div style={{ fontSize: 14.5, fontWeight: 700, color: GL.text, fontFamily: GL.disp }}>{t.n}</div><div style={{ fontSize: 12, color: GL.faint, fontFamily: GL.mono }}>{t.r}</div></div>
          <div style={{ display: "inline-flex", background: GL.device, border: "1px solid " + GL.line, borderRadius: 10, padding: 3, gap: 2 }}>{["Unlimited", "10", "5"].map((o) => <span key={o} style={{ padding: "6px 14px", borderRadius: 7, fontSize: 12.5, fontWeight: 700, fontFamily: GL.disp, color: t.a === o ? GL.ink : GL.dim, background: t.a === o ? GL.cyan : "transparent" }}>{o}</span>)}</div>
          <div style={{ flex: 1, minWidth: 120 }}>{t.max ? <><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ fontSize: 11, color: GL.faint, fontFamily: GL.mono }}>gebruikt dit event</span><span style={{ fontSize: 11.5, fontFamily: GL.mono, color: t.used >= t.max ? GL.amber : GL.dim }}>{t.used}/{t.max}</span></div><div style={{ height: 6, borderRadius: 4, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}><div style={{ width: t.used / t.max * 100 + "%", height: "100%", background: t.used >= t.max ? GL.amber : GL.cyan, borderRadius: 4 }} /></div></> : <span style={{ fontFamily: GL.mono, fontSize: 12, color: GL.green }}>∞ onbeperkt · {t.used} toegevoegd</span>}</div>
        </div>)}
      </div>
      <div style={{ flex: 1, minHeight: 0, padding: 16, borderRadius: 13, background: GL.panel, border: "1px solid " + GL.line, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><Lbl>Extra plekken per event (override)</Lbl><Btn sm kind="dash" icon="plus">Override toevoegen</Btn></div>
        {[["PULSE Open Air", "Joris Willems", "+15 extra", GL.primary], ["Neon Nights", "Eva Timmermans", "+5 extra", GL.cyan], ["Winterglas Indoor", "Sanne de Vries", "unlimited", GL.green]].map(([ev, who, ex, c]) => <div key={ev + who} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10, background: GL.device }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: c }} />
          <span style={{ flex: 1, fontSize: 13, color: GL.text, fontWeight: 600 }}>{ev}</span>
          <span style={{ fontSize: 12.5, color: GL.dim }}>{who}</span>
          <Tag label={ex.toUpperCase()} color={c} />
        </div>)}
      </div>
    </div>
  </Win>;
}

// ===========================================================
// CANVAS COMPOSITION
// ===========================================================
function GLApp() {
  return <DesignCanvas>
    <DCSection id="kernflow" title="Deur-incheck — de kernflow" subtitle="Tablet aan de entree · gast zegt naam → zoeken → inchecken (+ meegenomen gasten). 3 richtingen.">
      <DCArtboard id="a" label="A · Zoek-first — KLIKBAAR (typ een naam)" width={1024} height={720}><CheckinA /></DCArtboard>
      <DCArtboard id="b" label="B · Lijst-first met filters" width={1024} height={720}><CheckinB /></DCArtboard>
      <DCArtboard id="c" label="C · Detail-kaart (rol, notitie, betaal, melding)" width={1024} height={720}><CheckinC /></DCArtboard>
    </DCSection>

    <DCSection id="avond" title="Op de avond" subtitle="Snel zien wie onderweg is, wie binnen is, en welke gasten aandacht nodig hebben.">
      <DCArtboard id="home" label="Incheck-overzicht (home)" width={1024} height={720}><HomeOverview /></DCArtboard>
    </DCSection>

    <DCSection id="beheer" title="Gastenlijst beheren" subtitle="Per event: rollen, meegenomen gasten, betaal-status, notities, wie toevoegde — met snelle invoer.">
      <DCArtboard id="lijst" label="Gastenlijst per event" width={1240} height={760}><GuestlistEvent /></DCArtboard>
    </DCSection>

    <DCSection id="contacten" title="Contacten & hergebruik" subtitle="Adresboek van iedereen die ooit op een lijst stond, vaste gasten die automatisch meegaan, en bulk-import.">
      <DCArtboard id="adres" label="Adresboek + vaste gasten" width={1240} height={760}><AddressBook /></DCArtboard>
      <DCArtboard id="import" label="Bulk-import (plak / CSV / contacten)" width={980} height={720}><BulkImport /></DCArtboard>
    </DCSection>

    <DCSection id="overzicht" title="Overzicht & beheer" subtitle="Totaaloverzicht over alle events, en wie hoeveel gasten mag toevoegen.">
      <DCArtboard id="totaal" label="Totaal-dashboard (alle events)" width={1240} height={740}><TotaalDashboard /></DCArtboard>
      <DCArtboard id="rollen" label="Rollen & toelages (per-event override)" width={1140} height={740}><RollenToelages /></DCArtboard>
    </DCSection>
  </DesignCanvas>;
}

ReactDOM.createRoot(document.getElementById("root")).render(<GLApp />);
