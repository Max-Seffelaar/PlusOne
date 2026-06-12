/* Gastenlijst wireframe — door check-in variants (A interactive, B/C representative) + Home overview. */

const GUESTS = [
  { name: "Lieke Hofman", role: "VIP", pay: "paid", plus: 2, note: "Tafel 4 reserveren", by: "Max", status: "in", inAt: "20:42" },
  { name: "Daan Verhoeven", role: "Artist", pay: "free", plus: 3, note: "Backstage — crew haalt op", by: "Sanne", status: "onderweg" },
  { name: "Noor van Dijk", role: "All Access", pay: "free", plus: 1, note: "", by: "Max", status: "onderweg" },
  { name: "Bram Jansen", role: "Gast", pay: "pay", plus: 0, note: "Rekent €25 p.p. af", by: "Joris", status: "onderweg" },
  { name: "Femke Bakker", role: "VIP", pay: "paid", plus: 0, note: "", by: "Max", status: "in", inAt: "20:10" },
  { name: "Sven Mulder", role: "Pers", pay: "free", plus: 1, note: "Fotograaf — geen flits", by: "Sanne", status: "onderweg" },
  { name: "Iris Peters", role: "Gast", pay: "pay", plus: 0, note: "", by: "Joris", status: "in", inAt: "21:01" },
  { name: "Anouk Smit", role: "VIP", pay: "paid", plus: 2, note: "Verjaardag — fles bij tafel", by: "Max", status: "onderweg" },
  { name: "Ruben Maas", role: "Gast", pay: "free", plus: 0, note: "", by: "Joris", status: "onderweg" },
  { name: "Julia Kok", role: "All Access", pay: "free", plus: 0, note: "", by: "Sanne", status: "in", inAt: "19:55" },
  { name: "Stijn Bos", role: "Gast", pay: "pay", plus: 1, note: "", by: "Joris", status: "onderweg" },
  { name: "Tim de Groot", role: "Crew", pay: "free", plus: 0, note: "", by: "Systeem", status: "in", inAt: "18:30" },
];
const roleAccent = (r) => (window.ROLE && window.ROLE[r] ? window.ROLE[r].c : GL.cyan);
window.GLDATA = { GUESTS };

// ===========================================================
// VARIANT A — Zoek-first (volledig interactief)
// ===========================================================
function CheckinA() {
  const seed = new Set(GUESTS.filter((g) => g.status === "in").map((g) => g.name));
  const [q, setQ] = React.useState("");
  const [sel, setSel] = React.useState(null);
  const [plus, setPlus] = React.useState(0);
  const [inSet, setInSet] = React.useState(seed);
  const [toast, setToast] = React.useState(null);

  const matches = GUESTS.filter((g) => g.name.toLowerCase().includes(q.toLowerCase())).slice(0, 6);
  const binnen = GUESTS.filter((g) => inSet.has(g.name)).length;
  const onderweg = GUESTS.length - binnen;

  const open = (g) => { setSel(g); setPlus(g.plus); };
  const doCheckin = () => {
    setInSet((s) => new Set(s).add(sel.name));
    setToast(sel.name + (plus ? " +" + plus : "") + " · binnen");
    setSel(null); setQ("");
    setTimeout(() => setToast(null), 2600);
  };

  return <Tablet title="ENTREE · PULSE Open Air — incheck">
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: 22, gap: 16, position: "relative" }}>
      {/* counters */}
      <div style={{ display: "flex", gap: 10 }}>
        <div style={cntPill(GL.cyan)}><span style={{ width: 8, height: 8, border: "2px solid " + GL.cyan, borderRadius: 99 }} /><b style={{ fontFamily: GL.disp, fontSize: 17 }}>{onderweg}</b> onderweg</div>
        <div style={cntPill(GL.green)}><GIcon name="check" size={13} color={GL.green} stroke={2.6} /><b style={{ fontFamily: GL.disp, fontSize: 17 }}>{binnen}</b> binnen</div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 7, color: GL.faint, fontFamily: GL.mono, fontSize: 11.5 }}><GIcon name="user" size={14} />Joris · deur</div>
      </div>

      <Field big icon="search" placeholder="Typ een naam…" value={q} onChange={setQ} />

      {/* live matches */}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", gap: 8 }}>
        <Lbl>{q ? matches.length + " gevonden" : "begin met typen — live zoeken in de lijst"}</Lbl>
        {(q ? matches : GUESTS.slice(0, 5)).map((g) => {
          const isIn = inSet.has(g.name);
          return <button key={g.name} className="glrow" onClick={() => !isIn && open(g)} style={{ display: "flex", alignItems: "center", gap: 13, padding: "11px 14px", borderRadius: 13, border: "1px solid " + GL.line, background: GL.panel, cursor: isIn ? "default" : "pointer", textAlign: "left", opacity: isIn ? 0.5 : 1 }}>
            <Avatar name={g.name} accent={roleAccent(g.role)} size={42} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: GL.disp, fontWeight: 700, fontSize: 16, color: GL.text }}>{g.name}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}><RoleTag role={g.role} />{g.plus > 0 && <Tag label={"+" + g.plus} color={GL.dim} icon="users" />}{g.pay === "pay" && <PayTag status="pay" />}</div>
            </div>
            {isIn ? <StatusTag status="in" /> : <span style={{ color: GL.primary }}><GIcon name="chevR" size={22} /></span>}
          </button>;
        })}
      </div>

      {/* check-in sheet */}
      {sel && <div style={{ position: "absolute", left: 14, right: 14, bottom: 14, background: GL.panel2, border: "1px solid " + GL.line, borderRadius: 18, padding: 18, boxShadow: "0 -20px 50px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 13, marginBottom: 14 }}>
          <Avatar name={sel.name} accent={roleAccent(sel.role)} size={50} ring />
          <div style={{ flex: 1 }}><div style={{ fontFamily: GL.disp, fontWeight: 700, fontSize: 19, color: GL.text }}>{sel.name}</div><div style={{ display: "flex", gap: 7, marginTop: 4 }}><RoleTag role={sel.role} /><PayTag status={sel.pay} /></div></div>
          <button className="glbtn" onClick={() => setSel(null)} style={{ ...stepBtn, width: 36, height: 36 }}><GIcon name="x" size={16} /></button>
        </div>
        {sel.note && <div style={{ display: "flex", gap: 8, padding: "9px 12px", borderRadius: 10, background: GL.device, marginBottom: 12, fontSize: 13, color: GL.dim }}><span style={{ color: GL.amber }}><GIcon name="note" size={15} /></span>{sel.note}</div>}
        {sel.pay === "pay" && <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 10, background: GL.amber + "1c", marginBottom: 12, fontSize: 13, color: GL.amber, fontWeight: 600 }}><GIcon name="money" size={16} />Betaalde gastenlijst — host laat afrekenen aan de deur</div>}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
          <div><Lbl style={{ marginBottom: 6 }}>Meegenomen gasten</Lbl><Stepper value={plus} onChange={setPlus} /></div>
          <Btn kind="green" onClick={doCheckin} style={{ fontSize: 16, padding: "15px 22px" }} icon="checkc">Check in · {1 + plus} {1 + plus === 1 ? "persoon" : "personen"}</Btn>
        </div>
      </div>}

      {toast && <div style={{ position: "absolute", left: "50%", bottom: 22, transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 9, padding: "12px 18px", borderRadius: 12, background: GL.green, color: GL.ink, fontWeight: 700, fontFamily: GL.disp, boxShadow: "0 12px 30px rgba(0,0,0,0.4)" }}><GIcon name="checkc" size={18} color={GL.ink} stroke={2.2} />{toast}</div>}
    </div>
  </Tablet>;
}
const cntPill = (c) => ({ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 11, background: c + "16", color: c, fontFamily: GL.body, fontWeight: 600, fontSize: 13 });

// ===========================================================
// VARIANT B — Lijst-first (representatief)
// ===========================================================
function CheckinB() {
  return <Tablet title="ENTREE · variant B — lijst-first">
    <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "210px 1fr 200px" }}>
      <div style={{ borderRight: "1px solid " + GL.line2, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <Field icon="search" placeholder="Zoek naam…" value="" />
        <div><Lbl style={{ marginBottom: 8 }}>Filter op rol</Lbl><div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{["Alle", "VIP", "All Access", "Artist", "Gast"].map((r, i) => <div key={r} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 9, background: i === 0 ? "rgba(255,255,255,0.06)" : "transparent", color: i === 0 ? GL.text : GL.dim, fontSize: 13 }}><span style={{ width: 8, height: 8, borderRadius: 99, background: i === 0 ? GL.primary : GL.line }} />{r}</div>)}</div></div>
        <div style={{ marginTop: "auto", padding: 12, border: "1.5px dashed " + GL.line, borderRadius: 11 }}><Lbl style={{ marginBottom: 6 }}>Filter status</Lbl><div style={{ display: "flex", gap: 6 }}><Tag label="ONDERWEG" color={GL.cyan} /><Tag label="BINNEN" color={GL.green} /></div></div>
      </div>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8, overflow: "hidden" }}>
        <Lbl>Gastenlijst · tik om in te checken</Lbl>
        {GUESTS.slice(0, 7).map((g) => <div key={g.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 11, border: "1px solid " + GL.line, background: GL.panel }}>
          <Avatar name={g.name} accent={roleAccent(g.role)} size={36} />
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontFamily: GL.disp, fontSize: 14.5, color: GL.text }}>{g.name}</div><div style={{ display: "flex", gap: 6, marginTop: 2 }}><RoleTag role={g.role} />{g.plus > 0 && <Tag label={"+" + g.plus} color={GL.dim} />}</div></div>
          {g.status === "in" ? <StatusTag status="in" /> : <Btn sm kind="green" icon="check">Check in</Btn>}
        </div>)}
      </div>
      <div style={{ borderLeft: "1px solid " + GL.line2, padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        <div><Lbl style={{ marginBottom: 8 }}>Live teller</Lbl>
          <div style={{ padding: 14, borderRadius: 13, background: GL.green + "14", marginBottom: 8 }}><div style={{ fontFamily: GL.disp, fontSize: 30, fontWeight: 700, color: GL.green }}>4</div><div style={{ fontSize: 12, color: GL.dim }}>binnen</div></div>
          <div style={{ padding: 14, borderRadius: 13, background: GL.cyan + "14" }}><div style={{ fontFamily: GL.disp, fontSize: 30, fontWeight: 700, color: GL.cyan }}>8</div><div style={{ fontSize: 12, color: GL.dim }}>onderweg</div></div>
        </div>
        <div style={{ padding: 12, border: "1.5px dashed " + GL.amber + "66", borderRadius: 11, background: GL.amber + "0e" }}><Lbl color={GL.amber} style={{ marginBottom: 6 }}>Let op</Lbl><div style={{ fontSize: 12.5, color: GL.dim }}>3 gasten moeten nog betalen</div></div>
      </div>
    </div>
  </Tablet>;
}

// ===========================================================
// VARIANT C — Detail-kaart (representatief, rijkste single-guest flow)
// ===========================================================
function CheckinC() {
  const g = GUESTS.find((x) => x.name === "Anouk Smit");
  return <Tablet title="ENTREE · variant C — detail-kaart">
    <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "300px 1fr" }}>
      <div style={{ borderRight: "1px solid " + GL.line2, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <Field icon="search" placeholder="Naam zoeken…" value="ano" />
        <Lbl>2 resultaten</Lbl>
        {GUESTS.filter((x) => x.name.toLowerCase().includes("an")).slice(0, 2).map((x, i) => <div key={x.name} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 12px", borderRadius: 12, border: "1px solid " + (i === 0 ? GL.primary : GL.line), background: i === 0 ? GL.primary + "12" : GL.panel }}>
          <Avatar name={x.name} accent={roleAccent(x.role)} size={38} ring={i === 0} />
          <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontFamily: GL.disp, fontSize: 14.5, color: GL.text }}>{x.name}</div><div style={{ marginTop: 3 }}><RoleTag role={x.role} /></div></div>
        </div>)}
      </div>
      <div style={{ padding: 22, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
          <Avatar name={g.name} accent={roleAccent(g.role)} size={66} ring />
          <div style={{ flex: 1 }}><div style={{ fontFamily: GL.disp, fontWeight: 700, fontSize: 26, color: GL.text }}>{g.name}</div><div style={{ display: "flex", gap: 8, marginTop: 6 }}><RoleTag role={g.role} /><PayTag status={g.pay} /><Tag label="TOEGEVOEGD · MAX" color={GL.faint} /></div></div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, color: GL.violet, fontFamily: GL.mono, fontSize: 11.5, fontWeight: 700 }}><GIcon name="bell" size={15} color={GL.violet} />HOST GEWAARSCHUWD</div>
        </div>
        <div style={{ display: "flex", gap: 8, padding: "12px 14px", borderRadius: 12, background: GL.violet + "16", marginBottom: 12, fontSize: 14, color: GL.text }}><span style={{ color: GL.violet }}><GIcon name="note" size={18} /></span><div><b>Notitie</b> · {g.note}</div></div>
        <div style={{ flex: 1, border: "1.5px dashed " + GL.line, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", color: GL.faint, fontFamily: GL.mono, fontSize: 12, marginBottom: 14 }}>[ historie · 4 eerdere events · laatst binnen 12 apr ]</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: 16, borderRadius: 14, background: GL.panel }}>
          <div><Lbl style={{ marginBottom: 8 }}>Meegenomen gasten</Lbl><Stepper value={2} onChange={() => { }} /></div>
          <Btn kind="green" icon="checkc" style={{ fontSize: 18, padding: "18px 28px" }}>Check in · 3 personen</Btn>
        </div>
      </div>
    </div>
  </Tablet>;
}

// ===========================================================
// HOME — incheck-overzicht op de dag
// ===========================================================
function HomeOverview() {
  const binnen = GUESTS.filter((g) => g.status === "in");
  const heads = (arr) => arr.reduce((a, g) => a + 1 + g.plus, 0);
  const totalHeads = heads(GUESTS), inHeads = heads(binnen);
  const pct = inHeads / totalHeads;
  return <Tablet title="OVERZICHT · PULSE Open Air — vanavond">
    <div style={{ flex: 1, minHeight: 0, padding: 22, display: "flex", flexDirection: "column", gap: 16, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        {[["Onderweg", totalHeads - inHeads, GL.cyan, "clock"], ["Binnen", inHeads, GL.green, "checkc"], ["Op de lijst", totalHeads, GL.text, "users"]].map(([l, v, c, ic]) => <div key={l} style={{ padding: "16px 18px", borderRadius: 16, background: GL.panel, border: "1px solid " + GL.line }}>
          <div style={{ display: "flex", justifyContent: "space-between", color: c }}><Lbl color={c}>{l}</Lbl><GIcon name={ic} size={16} color={c} /></div>
          <div style={{ fontFamily: GL.disp, fontWeight: 700, fontSize: 40, color: c === GL.text ? GL.text : c, marginTop: 8, lineHeight: 1 }}>{v}</div>
          <div style={{ fontSize: 11.5, color: GL.faint, marginTop: 4, fontFamily: GL.mono }}>koppen incl. meegenomen</div>
        </div>)}
      </div>
      <div style={{ padding: "14px 18px", borderRadius: 14, background: GL.panel, border: "1px solid " + GL.line }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}><Lbl>Opkomst gastenlijst</Lbl><span style={{ fontFamily: GL.mono, fontSize: 12, color: GL.green, fontWeight: 700 }}>{Math.round(pct * 100)}%</span></div>
        <div style={{ height: 12, borderRadius: 7, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}><div style={{ width: pct * 100 + "%", height: "100%", background: GL.green, borderRadius: 7, boxShadow: "0 0 12px " + GL.green + "88" }} /></div>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 14 }}>
        <div style={{ padding: 16, borderRadius: 14, background: GL.panel, border: "1px solid " + GL.line, display: "flex", flexDirection: "column", gap: 9, overflow: "hidden" }}>
          <Lbl>Laatst binnengekomen</Lbl>
          {binnen.slice().reverse().map((g) => <div key={g.name} style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <Avatar name={g.name} accent={roleAccent(g.role)} size={32} />
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13.5, fontWeight: 600, color: GL.text }}>{g.name}{g.plus > 0 && <span style={{ color: GL.faint }}> +{g.plus}</span>}</div></div>
            <span style={{ fontFamily: GL.mono, fontSize: 12, color: GL.green }}>{g.inAt}</span>
          </div>)}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ padding: 14, borderRadius: 14, background: GL.violet + "12", border: "1px solid " + GL.violet + "44" }}><Lbl color={GL.violet} style={{ marginBottom: 8 }}>VIP onderweg</Lbl><div style={{ display: "flex", alignItems: "center", gap: 9 }}><Avatar name="Anouk Smit" accent={GL.amber} size={30} /><div style={{ fontSize: 13, color: GL.text, fontWeight: 600 }}>Anouk Smit <span style={{ color: GL.faint }}>+2</span></div></div></div>
          <div style={{ padding: 14, borderRadius: 14, background: GL.amber + "12", border: "1px solid " + GL.amber + "44" }}><Lbl color={GL.amber} style={{ marginBottom: 6 }}>Moet betalen</Lbl><div style={{ fontFamily: GL.disp, fontSize: 24, fontWeight: 700, color: GL.amber }}>3 gasten</div><div style={{ fontSize: 11.5, color: GL.dim }}>host krijgt melding aan de deur</div></div>
        </div>
      </div>
    </div>
  </Tablet>;
}

Object.assign(window, { CheckinA, CheckinB, CheckinC, HomeOverview, stepBtn, roleAccent });
