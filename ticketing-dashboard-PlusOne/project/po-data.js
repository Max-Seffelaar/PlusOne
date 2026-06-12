/* PLUSONE — guest list app data. Shapes map onto Eventix/POS later. */
(function () {
  const events = [
    { id: "frenzy", name: "FRENZY", venue: "De Marktkantine", time: "23:00", date: "14", mon: "DEC", month: "December 2024", guests: 148, inside: 0, accent: true, when: "upcoming" },
    { id: "hunee", name: "Hunée — All Night Long", venue: "Paradiso", time: "22:00", date: "20", mon: "DEC", month: "December 2024", guests: 96, inside: 0, when: "upcoming" },
    { id: "zezout", name: "ZEZOUT × LOFI", venue: "Garage Noord", time: "23:30", date: "21", mon: "DEC", month: "December 2024", guests: 61, inside: 0, when: "upcoming" },
    { id: "mindscape", name: "MINDSCAPE", venue: "Shelter", time: "23:00", date: "27", mon: "DEC", month: "December 2024", guests: 110, inside: 0, when: "upcoming" },
    { id: "frenzy-j", name: "FRENZY", venue: "De Marktkantine", time: "23:00", date: "10", mon: "JAN", month: "Januari 2025", guests: 38, inside: 0, when: "upcoming" },
    { id: "nyd", name: "New Year's Day", venue: "Radion", time: "08:00", date: "01", mon: "JAN", month: "Januari 2025", guests: 73, inside: 0, when: "upcoming" },
    { id: "lofi-nov", name: "LOFI Nightcap", venue: "Lofi", time: "23:00", date: "23", mon: "NOV", month: "November 2024", guests: 132, inside: 121, when: "past" },
    { id: "warehouse", name: "Warehouse 09", venue: "NDSM-loods", time: "22:00", date: "09", mon: "NOV", month: "November 2024", guests: 210, inside: 188, when: "past" },
  ];

  const guests = [
    { id: 1, name: "Lieke Hofman", role: "VIP", pay: "paid", plus: 2, note: "Tafel 4 reserveren — staat op naam", flag: "high", by: "Max", addedAt: "28 nov", status: "in", at: "23:42", inBy: "Joris" },
    { id: 2, name: "Daan Verhoeven", role: "Artist", pay: "free", plus: 3, note: "Backstage — crew haalt op bij de deur", flag: "high", by: "Sanne", addedAt: "26 nov", status: "wait" },
    { id: 3, name: "Noor van Dijk", role: "All Access", pay: "free", plus: 1, note: "Partner komt later — +1 apart inchecken", flag: "low", by: "Max", addedAt: "1 dec", status: "wait" },
    { id: 4, name: "Bram Jansen", role: "Gast", pay: "pay", plus: 0, note: "Rekent €25 p.p. af aan de deur", flag: "low", by: "Joris", addedAt: "2 dec", status: "wait" },
    { id: 5, name: "Femke Bakker", role: "VIP", pay: "paid", plus: 0, note: "", flag: null, by: "Max", addedAt: "27 nov", status: "in", at: "23:10", inBy: "Joris" },
    { id: 6, name: "Sven Mulder", role: "Pers", pay: "free", plus: 1, note: "Fotograaf — geen flits bij main stage", flag: "low", by: "Sanne", addedAt: "29 nov", status: "wait" },
    { id: 7, name: "Iris Peters", role: "Gast", pay: "pay", plus: 0, note: "", flag: null, by: "Joris", addedAt: "3 dec", status: "in", at: "00:01", inBy: "Eva" },
    { id: 8, name: "Anouk Smit", role: "VIP", pay: "paid", plus: 2, note: "Verjaardag — fles champagne bij tafel 7", flag: "high", by: "Max", addedAt: "24 nov", status: "wait" },
    { id: 9, name: "Ruben Maas", role: "Gast", pay: "free", plus: 0, note: "", flag: null, by: "Joris", addedAt: "2 dec", status: "wait" },
    { id: 10, name: "Julia Kok", role: "All Access", pay: "free", plus: 0, note: "", flag: null, by: "Sanne", addedAt: "30 nov", status: "in", at: "23:55", inBy: "Joris" },
    { id: 11, name: "Stijn Bos", role: "Gast", pay: "pay", plus: 1, note: "", flag: null, by: "Joris", addedAt: "4 dec", status: "wait" },
    { id: 12, name: "Tim de Groot", role: "Crew", pay: "free", plus: 0, note: "Op-/afbouw — hele avond in/uit", flag: "low", by: "Systeem", addedAt: "20 nov", status: "in", at: "21:30", inBy: "Systeem" },
  ];

  const contacts = [
    { name: "Anouk Smit", events: 21, role: "VIP", vast: true },
    { name: "Femke Bakker", events: 17, role: "VIP", vast: true },
    { name: "Lieke Hofman", events: 14, role: "VIP", vast: true },
    { name: "Julia Kok", events: 11, role: "All Access", vast: false },
    { name: "Daan Verhoeven", events: 9, role: "Artist", vast: false },
    { name: "Noor van Dijk", events: 8, role: "All Access", vast: false },
    { name: "Sven Mulder", events: 6, role: "Pers", vast: false },
    { name: "Bram Jansen", events: 3, role: "Gast", vast: false },
    { name: "Ruben Maas", events: 2, role: "Gast", vast: false },
  ];

  const team = [
    { name: "Max Seffelaar", role: "Eigenaar", allow: "Unlimited", used: 42, max: null },
    { name: "Sanne de Vries", role: "Manager", allow: "10", used: 7, max: 10 },
    { name: "Joris Willems", role: "Host", allow: "5", used: 5, max: 5 },
    { name: "Eva Timmermans", role: "Promotor", allow: "10", used: 3, max: 10 },
  ];

  window.PO = { events, guests, contacts, team, account: { ws: "LOFI", plan: "Premium", user: "Max Seffelaar" } };
})();
