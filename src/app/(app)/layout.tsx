import Link from 'next/link';
import { requireAppAccess } from '@/lib/auth/guards';
import { getMyMemberships } from '@/lib/auth/memberships';
import { isManager } from '@/features/auth/roles';
import { PendingInvitesBanner } from '@/features/auth/components/PendingInvitesBanner';
import { SignOutButton } from '@/features/auth/components/SignOutButton';

// Authenticated app shell. requireAppAccess enforces the MFA policy before any
// child renders; the nav adapts to the user's roles.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<JSX.Element> {
  const ctx = await requireAppAccess();
  const memberships = await getMyMemberships();
  const canManageTeam = memberships.some((m) => isManager(m.roles));
  const isAdminSomewhere = memberships.some((m) => m.roles.includes('admin'));
  const displayName =
    (ctx.user.user_metadata?.full_name as string | undefined) ?? ctx.user.email ?? 'Account';

  return (
    <div className="min-h-screen">
      <header className="border-line bg-bg/80 sticky top-0 z-10 border-b backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/dashboard" className="font-display text-lg font-extrabold tracking-tight">
              PLUSONE
            </Link>
            <Link href="/dashboard" className="text-dim hover:text-text transition-colors">
              Dashboard
            </Link>
            <Link href="/events" className="text-dim hover:text-text transition-colors">
              Events
            </Link>
            {canManageTeam && (
              <Link href="/admin/team" className="text-dim hover:text-text transition-colors">
                Team
              </Link>
            )}
            {isAdminSomewhere && (
              <Link href="/admin/sessions" className="text-dim hover:text-text transition-colors">
                Sessies
              </Link>
            )}
            <Link href="/settings/profile" className="text-dim hover:text-text transition-colors">
              Profiel
            </Link>
          </nav>
          <div className="flex items-center gap-3">
            <span className="text-faint hidden text-sm sm:inline">{displayName}</span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        <PendingInvitesBanner />
        {children}
      </main>
    </div>
  );
}
