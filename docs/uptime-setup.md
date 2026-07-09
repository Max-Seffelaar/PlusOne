# Uptime monitoring — setup-runbook (Prod-ready 9/7 — 09)

Alles wat NIET in code leeft: het BetterStack-dashboard. De code levert alleen
het ping-target: `GET /api/health` ([src/app/api/health/route.ts](../src/app/api/health/route.ts)),
public (middleware exempt), rondt een echte DB-query af (`venues`, head-only)
zodat een gehangen Postgres-verbinding het ook triggert — niet alleen "Next.js
proces leeft nog". 200 = ok, 503 = db-probleem.

Reden voor deze taak: het product draait 's nachts aan een club-deur. "Down op
vrijdagnacht" mag niet door een doorhost ontdekt worden — Max moet het eerder
weten dan de klant.

## 1. Dashboard-checklist (Max, eenmalig)

1. **Account**: gratis BetterStack-account (betterstack.com/uptime), geen
   creditcard nodig op het free-tier.
2. **Monitor aanmaken**: type HTTP(S), URL = `https://<prod-domein>/api/health`,
   interval **1 minuut**, verwacht statuscode **200**, timeout ~10s.
3. **Escalatie/on-call**: alert-policy zo instellen dat een failure **direct**
   naar Max' telefoon gaat (push via de BetterStack-app is het snelst; SMS/call
   als fallback) — niet alleen e-mail, dat wordt 's nachts gemist. 2–3
   opeenvolgende failures voordat een incident opent voorkomt een enkele
   trage response als false positive.
4. **Status page**: optioneel, niet nodig voor intern gebruik — overslaan
   tenzij klanten er baat bij hebben.

## 2. Env-vars

Geen. De monitor praat alleen tegen het publieke `/api/health`-endpoint; er is
niets terug te configureren in de app.

## 3. Lokaal verifiëren

```bash
pnpm dev
curl -i http://localhost:7000/api/health   # poort per worktree, zie CLAUDE.md
# → 200 {"status":"ok"} met een lokale Supabase-stack draaiend
```

## 4. Na livegang

Loop de monitor één keer handmatig na (BetterStack "Send test alert" of de
monitor tijdelijk op een fout endpoint zetten) om te bevestigen dat de push
daadwerkelijk aankomt — een monitor die nooit een alert heeft gevuurd, bewijst
niets.
