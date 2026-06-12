/* Mainstage HQ — mock data. Shapes mirror what a real Eventix / POS / scan API would return,
   so fields can later be mapped 1:1. Deterministic generators (seeded) keep charts stable. */
(function () {
  "use strict";

  // ---- tiny seeded RNG so data is identical on every load ----
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rng = mulberry32(42);
  const rand = (a, b) => a + (b - a) * rng();
  const randint = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];

  // ---------------------------------------------------------------
  // Daily sales build-up for the flagship event (PULSE Open Air 2026)
  // 84 days of presale leading up to the show. Models a realistic curve:
  // launch spike -> quiet -> lineup-announcement spike -> final-weeks ramp.
  // ---------------------------------------------------------------
  const SALES_DAYS = 84;
  const milestones = {
    4: 1.0,   // on-sale launch
    5: 0.7,
    22: 0.85, // phase-2 lineup reveal
    23: 0.55,
    48: 0.6,  // headliner announcement
    66: 0.7,  // 'almost sold out' push
    78: 1.1,  // final week
    81: 1.4,
    82: 1.55,
  };
  function buildDailySales(totalTarget) {
    const raw = [];
    for (let d = 0; d < SALES_DAYS; d++) {
      // baseline grows toward the event date
      const t = d / SALES_DAYS;
      let base = 40 + 260 * Math.pow(t, 2.2);
      let spike = 0;
      for (const k in milestones) {
        const dist = Math.abs(d - k);
        if (dist <= 3) spike += milestones[k] * 520 * Math.exp(-dist * dist / 2.2);
      }
      const weekday = d % 7;
      const weekendBoost = weekday === 5 || weekday === 6 ? 1.25 : 1.0;
      const noise = rand(0.82, 1.18);
      raw.push(Math.max(8, (base + spike) * weekendBoost * noise));
    }
    // normalise to hit the desired cumulative total
    const sum = raw.reduce((a, b) => a + b, 0);
    const factor = totalTarget / sum;
    let cum = 0;
    const start = new Date(2026, 3, 25); // 25 Apr 2026 on-sale
    return raw.map((v, i) => {
      const n = Math.round(v * factor);
      cum += n;
      const date = new Date(start.getTime() + i * 86400000);
      return { i, date, label: date.toLocaleDateString("nl-NL", { day: "numeric", month: "short" }), sold: n, cum };
    });
  }

  const SOLD = 15240;
  const CAP = 18000;
  const daily = buildDailySales(SOLD);

  // last-year cumulative curve (final 16,800) tracking ~9% behind current pace
  function buildLastYear(curve) {
    // smooth: last year tracks just behind, gap widens as this year pulls ahead (~9%)
    return curve.map((p) => {
      const t = p.i / (curve.length - 1);
      const ratio = 0.985 - 0.09 * t;
      return { i: p.i, label: p.label, cum: Math.round(p.cum * ratio) };
    });
  }
  const dailyLastYear = buildLastYear(daily);

  // ---------------------------------------------------------------
  // Per-city sales (verkoop per stad/regio) — NL focus + intl bucket
  // ---------------------------------------------------------------
  const cityRaw = [
    ["Amsterdam", 3120, 2780], ["Rotterdam", 1890, 1740], ["Utrecht", 1540, 1410],
    ["Den Haag", 1310, 1255], ["Eindhoven", 980, 905], ["Groningen", 760, 690],
    ["Tilburg", 545, 560], ["Nijmegen", 510, 470], ["Arnhem", 435, 420],
    ["Breda", 410, 365], ["Haarlem", 360, 330], ["'s-Hertogenbosch", 320, 300],
    ["Internationaal (DE/BE)", 1060, 1575],
  ];
  const cities = cityRaw.map(([name, ty, ly]) => ({ name, sold: ty, last: ly }));

  // ---------------------------------------------------------------
  // Ticket types (verdeling) — sold, price, status
  // ---------------------------------------------------------------
  const ticketTypes = [
    { name: "Weekend Combi", sold: 6820, price: 189, accent: "a1", status: "live" },
    { name: "Zaterdag", sold: 4210, price: 79, accent: "a2", status: "live" },
    { name: "Vrijdag", sold: 2540, price: 69, accent: "a3", status: "live" },
    { name: "VIP Deck", sold: 980, price: 249, accent: "a4", status: "live" },
    { name: "Early Bird", sold: 690, price: 59, accent: "a5", status: "soldout" },
  ];

  // ---------------------------------------------------------------
  // Sales channels (verkoopkanaal)
  // ---------------------------------------------------------------
  const channels = [
    { name: "Eventix online", sold: 11450, accent: "a3", source: "Eventix API" },
    { name: "Kassa / POS", sold: 1980, accent: "a2", source: "POS-koppeling" },
    { name: "Voorverkoop / resellers", sold: 1420, accent: "a4", source: "Reseller feed" },
    { name: "Gastenlijst / comp", sold: 390, accent: "a1", source: "Handmatig" },
  ];

  // ---------------------------------------------------------------
  // Live opkomst / scan progress (vorige editie als benchmark) — per uur
  // doors 16:00 -> 02:00, builds to 94% opkomst
  // ---------------------------------------------------------------
  const scanFinal = Math.round(16800 * 0.94);
  const scanHours = (() => {
    const hours = ["16:00","17:00","18:00","19:00","20:00","21:00","22:00","23:00","00:00","01:00","02:00"];
    // cumulative fraction of arrivals by hour
    const frac = [0.04, 0.12, 0.26, 0.45, 0.66, 0.82, 0.91, 0.96, 0.985, 0.997, 1.0];
    return hours.map((h, i) => ({ hour: h, in: Math.round(scanFinal * frac[i]) }));
  })();
  // "now" pointer for the live feel — event is mid-evening on prev-edition benchmark
  const scanNowIndex = 5; // 21:00

  // ---------------------------------------------------------------
  // KPI headline numbers for the selected event
  // ---------------------------------------------------------------
  const revenue = ticketTypes.reduce((a, t) => a + t.sold * t.price, 0);
  const avgPrice = Math.round(revenue / SOLD);
  const forecastFinal = 17650;

  const flagship = {
    id: "pulse26",
    name: "PULSE Open Air 2026",
    venue: "Stadspark, Amsterdam",
    dateLabel: "18–19 jul 2026",
    daysToGo: 26,
    status: "live", // sales running
    statusLabel: "Verkoop loopt",
    capacity: CAP,
    sold: SOLD,
    revenue,
    avgPrice,
    soldToday: 386,
    revenueToday: 71400,
    pctSold: SOLD / CAP,
    forecastFinal,
    forecastPct: forecastFinal / CAP,
    lastEdition: { sold: 16800, opkomst: 0.94, revenue: 2010000 },
    daily, dailyLastYear, cities, ticketTypes, channels,
    scanHours, scanNowIndex, scanFinalSold: 16800, scanFinalIn: scanFinal,
  };

  // ---------------------------------------------------------------
  // Portfolio — meerdere events, verschillende fases
  // ---------------------------------------------------------------
  const portfolio = [
    { id: "pulse26", name: "PULSE Open Air 2026", venue: "Stadspark, Amsterdam", dateLabel: "18 jul", status: "selling", statusLabel: "Verkoop loopt", capacity: 18000, sold: 15240, revenue: revenue, soldToday: 386, pacePct: 9, accent: "a1" },
    { id: "neon", name: "Neon Nights", venue: "Maassilo, Rotterdam", dateLabel: "Vandaag", status: "live", statusLabel: "LIVE — nu bezig", capacity: 3200, sold: 3200, revenue: 268800, soldToday: 0, scannedIn: 2410, accent: "a3" },
    { id: "lowtide", name: "Lowtide Weekender", venue: "Brouwersdam, Zeeland", dateLabel: "8 aug", status: "selling", statusLabel: "Verkoop loopt", capacity: 9000, sold: 3710, revenue: 412000, soldToday: 142, pacePct: -4, accent: "a4" },
    { id: "winterglas", name: "Winterglas Indoor", venue: "Ahoy, Rotterdam", dateLabel: "12 dec", status: "selling", statusLabel: "Verkoop loopt", capacity: 6500, sold: 4095, revenue: 389000, soldToday: 98, pacePct: 6, accent: "a2" },
    { id: "hemel", name: "Hemelvaart Klank", venue: "Griftpark, Utrecht", dateLabel: "14 mei", status: "announce", statusLabel: "Net aangekondigd", capacity: 5000, sold: 600, revenue: 41400, soldToday: 220, pacePct: 0, accent: "a5" },
    { id: "pulse25", name: "PULSE Open Air 2025", venue: "Stadspark, Amsterdam", dateLabel: "Afgerond", status: "done", statusLabel: "Afgerond", capacity: 17000, sold: 16800, revenue: 2010000, soldToday: 0, opkomst: 0.94, accent: "a1" },
  ];

  // ---------------------------------------------------------------
  // Guest list (gastenlijst) — kassa + online + lok + scan-data merged
  // ---------------------------------------------------------------
  const firstNames = ["Sanne","Daan","Lotte","Bram","Femke","Jesse","Noor","Sven","Eva","Tim","Iris","Lars","Anne","Ruben","Julia","Milan","Sophie","Thijs","Lieke","Finn","Roos","Joris","Maud","Stijn","Nina","Koen","Tess","Bas","Loes","Gijs","Yara","Wout","Isa","Mees","Fleur","Niels","Esmee","Teun","Anouk","Pim"];
  const lastNames = ["de Vries","Jansen","Bakker","Visser","Smit","Meijer","de Boer","Mulder","Bos","Vos","Peters","Hendriks","van Dijk","van den Berg","de Groot","Kok","Willems","Maas","Verhoeven","Koster","de Jong","van Leeuwen","Dekker","Brouwer","Hofman","Timmermans","Scholten","van der Meer","Postma","Kuipers"];
  const domains = ["gmail.com","hotmail.com","outlook.com","ziggo.nl","kpnmail.nl","icloud.com"];
  const ttNames = ["Weekend Combi","Zaterdag","Vrijdag","VIP Deck","Early Bird"];
  const chanNames = [["Eventix online","online"],["Kassa / POS","kassa"],["Voorverkoop / lok","lok"]];

  function timeStr(h, m) { return String(h).padStart(2,"0") + ":" + String(m).padStart(2,"0"); }

  const guests = [];
  for (let i = 0; i < 64; i++) {
    const fn = pick(firstNames), ln = pick(lastNames);
    const email = (fn.toLowerCase().replace(/[^a-z]/g,"") + "." + ln.toLowerCase().replace(/[^a-z]/g,"") + "@" + pick(domains));
    const tt = pick(ttNames);
    const ch = pick(chanNames);
    // 64% scanned in at the door
    const scanned = rng() < 0.64;
    const inH = randint(16, 23), inM = randint(0, 59);
    const hasOut = scanned && rng() < 0.22;
    const outH = Math.min(2 + inH % 3 + 22, 26);
    const order = "EVX-" + randint(100000, 999999);
    guests.push({
      id: i,
      name: fn + " " + ln,
      email,
      ticket: tt,
      channel: ch[0], channelKey: ch[1],
      order,
      barcode: String(randint(10,99)) + " " + String(randint(1000,9999)) + " " + String(randint(1000,9999)),
      scanned,
      scanIn: scanned ? timeStr(inH, inM) : null,
      scanOut: hasOut ? timeStr(inH + 3 > 23 ? (inH + 3 - 24) : inH + 3, randint(0,59)) : null,
    });
  }

  // ---------------------------------------------------------------
  // Forecast tab — voorspelling voor een aankomend event op basis
  // van vergelijkbare historische events
  // ---------------------------------------------------------------
  const forecastTarget = {
    name: "Lowtide Weekender",
    venue: "Brouwersdam, Zeeland",
    dateLabel: "8 aug 2026",
    capacity: 9000,
    soldNow: 3710,
    daysToGo: 57,
    predicted: 7850,
    low: 6900,
    high: 8600,
    confidence: 0.86,
  };
  // build cumulative projection curve: actuals so far + predicted continuation w/ band
  const fcCurve = (() => {
    const pts = [];
    const days = 110; // total on-sale window
    const elapsed = days - forecastTarget.daysToGo;
    for (let d = 0; d <= days; d++) {
      const t = d / days;
      const shape = forecastTarget.predicted * (Math.pow(t, 1.9) * 0.55 + t * 0.45);
      const isActual = d <= elapsed;
      const actual = isActual ? Math.round(forecastTarget.soldNow * Math.pow(d / Math.max(1,elapsed), 1.6)) : null;
      const band = forecastTarget.predicted * 0.11 * t;
      pts.push({
        d,
        actual: isActual ? actual : null,
        predicted: Math.round(shape),
        low: d >= elapsed ? Math.round(shape - band) : null,
        high: d >= elapsed ? Math.round(shape + band) : null,
      });
    }
    return pts;
  })();

  const comparableEvents = [
    { name: "Lowtide Weekender 2025", venue: "Zeeland", capacity: 8000, finalSold: 7240, opkomst: 0.91, similarity: 0.94 },
    { name: "Brouwersdam Beats 2025", venue: "Zeeland", capacity: 9500, finalSold: 8120, opkomst: 0.88, similarity: 0.81 },
    { name: "Coast Open Air 2024", venue: "Noord-Holland", capacity: 9000, finalSold: 7680, opkomst: 0.9, similarity: 0.76 },
    { name: "Lowtide Weekender 2024", venue: "Zeeland", capacity: 7000, finalSold: 6510, opkomst: 0.93, similarity: 0.72 },
  ];

  const forecastDrivers = [
    { label: "Verkooptempo vs. vorig jaar", value: "+12%", dir: "up", weight: "Sterk" },
    { label: "Line-up sterkte (boekingsscore)", value: "8.4 / 10", dir: "up", weight: "Sterk" },
    { label: "Weersvoorspelling augustus", value: "Gunstig", dir: "up", weight: "Gemiddeld" },
    { label: "Concurrerende events zelfde weekend", value: "2 events", dir: "down", weight: "Gemiddeld" },
    { label: "Macro / besteedbaar inkomen", value: "Stabiel", dir: "flat", weight: "Zwak" },
  ];

  // ---------------------------------------------------------------
  // Data sources / integrations status (Bronnen tab)
  // ---------------------------------------------------------------
  const sources = [
    { name: "Eventix", type: "Ticketing API", status: "connected", lastSync: "2 min geleden", records: "15.240 orders", accent: "a3", note: "Realtime verkoop, ticketsoorten & barcodes" },
    { name: "Kassa / POS", type: "Point of sale", status: "connected", lastSync: "5 min geleden", records: "1.980 transacties", accent: "a2", note: "Pin- & contante verkoop aan de deur" },
    { name: "Scan-data (entree)", type: "Toegangscontrole", status: "connected", lastSync: "Live", records: "Live scanfeed", accent: "a1", note: "In/uit-scans per poort, realtime opkomst" },
    { name: "Lok / voorverkoop", type: "Reseller feed", status: "syncing", lastSync: "Bezig…", records: "1.420 tickets", accent: "a4", note: "Fysieke voorverkooppunten & resellers" },
    { name: "Mailchimp", type: "Marketing", status: "available", lastSync: "Niet gekoppeld", records: "—", accent: "a5", note: "Koppel om campagne-attributie te zien" },
    { name: "Google Analytics 4", type: "Web analytics", status: "available", lastSync: "Niet gekoppeld", records: "—", accent: "a3", note: "Funnel van bezoek naar aankoop" },
  ];

  window.MHQ = {
    flagship, portfolio, guests, cities, ticketTypes, channels,
    daily, dailyLastYear, scanHours, scanNowIndex,
    forecast: { target: forecastTarget, curve: fcCurve, comparable: comparableEvents, drivers: forecastDrivers },
    sources,
    fmt: {
      eur: (n) => "€" + Math.round(n).toLocaleString("nl-NL"),
      eurC: (n) => n >= 1e6 ? "€" + (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? "€" + (n / 1e3).toFixed(0) + "k" : "€" + n,
      num: (n) => Math.round(n).toLocaleString("nl-NL"),
      pct: (n) => Math.round(n * 100) + "%",
    },
  };
})();
