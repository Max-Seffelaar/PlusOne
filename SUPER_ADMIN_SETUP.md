# Super Admin Setup voor Testing

Deze gids helpt je om super admin toegang in te stellen voor `max.seffelaar@gmail.com` zodat je alle venues kan testen.

## Stap 1: Migration Runnen

```bash
# In je project directory:
supabase db reset
```

Dit zal:
- ✅ Alle migrations toepassen (inclusief `20260612000003_add_super_admin_role.sql`)
- ✅ Super admin enum waarde toevoegen aan `venue_role`
- ✅ User record aanmaken voor max.seffelaar@gmail.com
- ✅ Super admin membership op alle venues aanmaken

## Stap 2: Password Auth Enablen (Testing Only)

Dit is nodig omdat we normaal passwordless-only hebben, maar voor testen wil je snel kunnen inloggen.

### Via Supabase Dashboard:

1. Ga naar **Authentication > Providers**
2. Scroll naar **Email** provider
3. Klik op **Settings** (tandwiel icoon)
4. Enable: **Confirm email** uitschakelen (sneller testen)
5. **Save**

### Via `supabase/config.toml`:

```toml
[auth]
# Maak sure Email provider actief is:
enable_signup = true
email_autoconfirm = true  # Sla email verification over
```

## Stap 3: User Password Zetten in Supabase Auth

Je hebt twee opties:

### Option A: Via Supabase CLI (Aanbevolen)

```bash
supabase auth admin create-user \
  --email max.seffelaar@gmail.com \
  --password 000000 \
  --skip-confirmation
```

Als user al bestaat, update het wachtwoord:

```bash
supabase auth admin update-user-email \
  --new-email max.seffelaar@gmail.com
```

### Option B: Via Supabase Dashboard

1. Ga naar **Authentication > Users**
2. Klik **+ Create new user**
3. Email: `max.seffelaar@gmail.com`
4. Password: `000000`
5. Uncheck **Send invite email**
6. Click **Create user**

## Stap 4: Verifieer de Setup

```bash
# Start je dev server
pnpm dev
```

Ga naar http://localhost:3000 en:

1. Klik **Sign in** (of zie de login page)
2. Voer in:
   - Email: `max.seffelaar@gmail.com`
   - Password: `000000`
3. Je zou moeten inloggen als Super Admin
4. Je zou alle venues moeten kunnen zien in de venue switcher
5. Je zou admin permissions op elke venue moeten hebben

## Stap 5: Testen

Eenmaal ingelogd:

- [ ] Venue switcher toont alle venues
- [ ] Je kan settings van elke venue bewerken
- [ ] Je kan teamleden toevoegen aan elke venue
- [ ] Sidebar toont "Super Admin" in plaats van "Admin"
- [ ] Finance & User Manager schermen werken read-only

## Cleanup: Terug naar Passwordless (Production)

Als je klaar bent met testen:

1. Ga naar **Authentication > Providers > Email > Settings**
2. Disable Email Password auth
3. Zet `email_autoconfirm = false` in `config.toml` terug
4. Verwijder de test user uit Supabase Auth (optioneel)

## Troubleshooting

### "User not found" bij login
- Check dat de user in Supabase Auth is aangemaakt (niet alleen in database)
- Zorg dat password is ingesteld

### "Invalid credentials"
- Zorg dat Email provider geactiveerd is
- Probeer het wachtwoord reset via magic link

### Super admin kan venues niet zien
- Run `supabase db reset` opnieuw
- Check dat venue_memberships records zijn aangemaakt voor super admin

### Enum error "super_admin value not found"
- Make sure de migration `20260612000003_add_super_admin_role.sql` is gerund
- Probeer `supabase db reset` opnieuw

## Files die zijn Gewijzigd

- `supabase/migrations/20260612000003_add_super_admin_role.sql` - Migration
- `src/lib/auth.ts` - Super admin check in `checkVenueMembership()`
- `src/app/admin/venues/[venue-id]/page.tsx` - Super admin role display

## Notities

- Super admin wordt automatisch toegewezen op **alle bestaande venues**
- Nieuwe venues die later worden aangemaakt, zullen super admin NOT automatisch hebben (dit moet via admin panel)
- Dit is alleen voor testen - in production gebruik AAL2 + normale rol hierarchy
