import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAppAccess } from '@/lib/auth/guards';
import { getMyMemberships } from '@/lib/auth/memberships';
import { RoleBadges } from '@/features/auth/components/RoleBadges';

export const metadata: Metadata = { title: 'Dashboard — PLUSONE' };

export default async function DashboardPage(): Promise<JSX.Element> {
  const ctx = await requireAppAccess('/dashboard');
  const memberships = await getMyMemberships();
  const displayName =
    (ctx.user.user_metadata?.full_name as string | undefined) ?? ctx.user.email ?? '';

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">
          Hoi {displayName.split(' ')[0] || 'daar'}
        </h1>
        <p className="text-dim mt-1 text-sm">
          {memberships.length > 0
            ? 'Je toegang per venue staat hieronder.'
            : 'Je hebt nog geen toegang tot een venue. Vraag een beheerder om een uitnodiging.'}
        </p>
      </header>

      {memberships.length > 0 && (
        <section className="grid gap-3 sm:grid-cols-2">
          {memberships.map((m) => (
            <div key={m.venueId} className="card flex flex-col gap-3">
              <h2 className="font-display text-lg font-semibold">{m.venueName}</h2>
              <RoleBadges roles={m.roles} />
            </div>
          ))}
        </section>
      )}

      <section className="flex flex-wrap gap-3">
        <Link href="/settings/profile" className="btn-dark text-sm">
          Profiel & sessies
        </Link>
        {memberships.some((m) => m.roles.includes('admin') || m.roles.includes('user_manager')) && (
          <Link href="/admin/team" className="btn-dark text-sm">
            Team beheren
          </Link>
        )}
        {memberships.some((m) => m.roles.includes('admin')) && (
          <Link href="/admin/sessions" className="btn-dark text-sm">
            Sessies & remote logout
          </Link>
        )}
      </section>
    </div>
  );
}
