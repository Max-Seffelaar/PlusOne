# PLUSONE — Manual Setup Steps

Project scaffold is complete. Follow these manual steps to finalize the setup and start feature development.

## Phase 1: Local Development Environment (This Session)

### 1. Install Dependencies

```bash
cd C:\Users\Maxse\.claude\projects\plusone
pnpm install
```

This installs all packages listed in `package.json`. The initial build will take ~2–3 minutes.

### 2. Supabase Project Creation

Create a new Supabase project at https://supabase.com/dashboard:

1. **Sign in** to Supabase (or create account)
2. **New Project** → Name it "plusone-dev" (or similar)
3. **Region:** `eu-central-1` (Frankfurt) — **critical for compliance**
4. **Database password:** Save securely (needed for RLS tests later)
5. Once created, go to **Project Settings** → **API** and copy:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public key` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role secret key` → `SUPABASE_SERVICE_ROLE_KEY`
   - Project ID (from URL or settings) → `SUPABASE_PROJECT_ID`

### 3. Environment Variables

Create `.env.local` in the project root with your Supabase credentials:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
SUPABASE_PROJECT_ID=your-project-id
NODE_ENV=development
```

**Security:** Never commit `.env.local` (it's in `.gitignore`). Use `.env.example` as the template.

### 4. Disable Password Auth in Supabase

In Supabase Dashboard → **Authentication** → **Providers** → **Email**:

- Uncheck "Enable Email Provider" (we use OTP only)
- Scroll down and disable "Email / Password" if present
- Save

This enforces passwordless-first as per CLAUDE.md decision #20.

### 5. Local Supabase CLI Setup (Optional, for Local DB Testing)

If you want to test migrations and RLS locally without hitting the cloud:

```bash
# Install Supabase CLI (if not already)
npm install -g @supabase/cli

# Link to your project (one-time)
supabase link --project-id <your-project-id>

# Start local Postgres (Docker required)
supabase start

# Apply migrations to local DB
supabase db reset

# Run pgTAP tests
supabase test db
```

For quick testing, you can skip this and just push migrations to Supabase Dashboard.

### 6. Start Development Server

```bash
pnpm dev
```

Visit http://localhost:3000. You should see the PLUSONE landing page.

### 7. Verify Setup

Run the following checks:

```bash
# Type check
pnpm type-check

# Lint (should pass, no errors)
pnpm lint

# Unit tests (only setup files, no actual tests yet)
pnpm test
```

All should pass with zero errors.

---

## Phase 2: GitHub & Vercel (Next Session or Before First Deployment)

### 1. GitHub Repository

Create a GitHub repo for this project:

```bash
# Option A: Create via GitHub Web UI, then:
git remote add origin https://github.com/yourusername/plusone.git
git branch -M main
git push -u origin main

# Option B: GitHub CLI
gh repo create plusone --source=. --remote=origin --push
```

### 2. Vercel Deployment (Optional for Now)

When ready to deploy:

```bash
# Link to Vercel
vercel link

# Add environment variables
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add SUPABASE_PROJECT_ID

# Deploy
vercel deploy --prod
```

**Note:** `vercel.json` enforces `fra1` region. Verify in Vercel Dashboard that your project is set to Frankfurt.

### 3. GitHub Actions

CI/CD workflows in `.github/workflows/ci.yml` run automatically on push and PR. They:

- Lint and type-check code
- Run unit tests (Vitest)
- Run database tests (pgTAP) on a test Postgres container
- Build the Next.js app

No manual setup needed; workflows run on every commit.

---

## Phase 3: Database Initialization (Before First Feature)

When ready to build features, initialize the database schema:

### 1. Create Initial Schema Migration

The first migration file is a placeholder at `supabase/migrations/00000000000000_init.sql`. Replace it with the actual schema once you start building feature #1.

Example migration structure (create a new file per feature task):

```bash
# For each ClickUp task, create a new migration:
supabase/migrations/20260613_001_create_users_table.sql
supabase/migrations/20260613_002_create_venues_table.sql
... and so on
```

### 2. Apply Migrations

```bash
# If using local Supabase CLI
supabase db reset

# OR push to cloud via Supabase Dashboard (SQL Editor)
```

### 3. Generate TypeScript Types

After any schema change, regenerate types:

```bash
NEXT_PUBLIC_SUPABASE_PROJECT_ID=your-project-id pnpm db:types
```

This creates `src/lib/supabase/database.types.ts` from your schema.

### 4. Write RLS Tests

For every table with mutations, add pgTAP tests in `supabase/tests/database/rls.test.sql`:

```sql
-- Example structure for each table:
-- Test that:
--   - Admin can CRUD
--   - Finance can read but not write
--   - Staff can only read/write their own rows
--   - Soft delete works (status = 'removed', not hard DELETE)
--   - Quota constraints enforced at the database level
```

Run tests:

```bash
supabase test db
```

---

## Phase 4: Feature Development Workflow

For each feature task from the spec:

1. **Create a migration** in `supabase/migrations/` (one per task)
2. **Write RLS tests** in `supabase/tests/`
3. **Build the React component/page** in `src/app` or `src/features/<domain>/`
4. **Write unit tests** in `src/**/*.test.ts`
5. **Run the full test suite** before committing:
   ```bash
   pnpm lint
   pnpm type-check
   pnpm test
   pnpm e2e (if you have e2e tests)
   ```
6. **Commit** with a conventional message:
   ```bash
   git add -A
   git commit -m "feat(guests): add guest list CRUD with quota enforcement"
   ```

See `CLAUDE.md` → "Definition of Done" for the complete checklist.

---

## FAQ & Troubleshooting

### Q: I get `error: cannot find module '@tanstack/react-query'`

**A:** Run `pnpm install` to install all dependencies.

### Q: Supabase client errors (401, "Invalid API key")

**A:** 
- Check that `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are correct in `.env.local`
- Verify the project exists in Supabase Dashboard
- Refresh the page (sometimes auth tokens get stale)

### Q: `pnpm lint` fails with eslint errors

**A:** Run `pnpm format` to auto-fix formatting issues, then commit.

### Q: How do I test the PWA locally?

**A:** PWA works in production build or via Android/iOS:
```bash
pnpm build
pnpm start  # Runs on http://localhost:3000
```
Then add to home screen (Chrome: menu → "Install" / Safari: share → "Add to Home Screen").

### Q: Can I use the Supabase Dashboard's SQL Editor?

**A:** Yes, but **always**:
1. Write migrations in `supabase/migrations/` first
2. Test locally with `supabase db reset`
3. Push to Supabase via the Dashboard or CLI
4. Never edit applied migrations — write a new one instead

### Q: How do I create a new Supabase Edge Function?

**A:** 
```bash
supabase functions new <function-name>
# Then edit supabase/functions/<function-name>/index.ts
```
Edge Functions are useful for Stripe webhooks, password resets, etc. Keep them minimal and delegate to stored procedures when possible.

---

## Next Steps

1. ✅ Run `pnpm install`
2. ✅ Set up Supabase project and environment variables
3. ✅ Run `pnpm dev` to verify the dev server starts
4. ✅ Create a GitHub repo and push the scaffold
5. ⏭️ **Start the first feature task** (e.g., User authentication)

Refer to `CLAUDE.md`, `docs/spec.md`, and `docs/design-system.md` while building.

---

**Questions?** Check `CLAUDE.md` for architecture decisions or `README.md` for command reference.
