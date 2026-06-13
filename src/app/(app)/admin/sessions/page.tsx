import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAppAccess } from '@/lib/auth/guards';
import { getMyMemberships, getVenueMembers } from '@/lib/auth/memberships';
import { adminListSessions } from '@/lib/auth/sessions';
import { SessionList } from '@/features/auth/components/SessionList';

export const metadata: Metadata = { title: 'Sessies — PLUSONE' };

export default async function AdminSessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ venue?: string; user?: string }>;
}): Promise<JSX.Element> {
  const ctx = await requireAppAccess('/admin/sessions');
  const { venue: venueParam, user: userParam } = await searchParams;

  const memberships = await getMyMemberships();
  const adminVenues = memberships.filter((m) => m.roles.includes('admin'));

  if (adminVenues.length === 0) {
    return (
      <div className="card mx-auto max-w-3xl">
        <h1 className="font-display text-2xl font-bold">Sessies</h1>
        <p className="text-dim mt-2">Alleen beheerders kunnen sessies van gebruikers beheren.</p>
      </div>
    );
  }

  // Listing/revoking sessions is AAL2-only (enforced in the RPC) — guide first.
  if (!ctx.isAal2) {
    return (
      <div className="border-acc-dim bg-acc-dim mx-auto max-w-3xl rounded-card border p-4 text-sm">
        <h1 className="font-display text-lg font-bold">MFA vereist</h1>
        <p className="text-dim mt-1">
          Sessiebeheer en remote logout vereisen een MFA-geverifieerde sessie.{' '}
          <Link
            href={ctx.hasVerifiedTotp ? '/mfa/verify?next=/admin/sessions' : '/mfa/enroll?next=/admin/sessions'}
            className="text-acc-soft underline"
          >
            {ctx.hasVerifiedTotp ? 'Verifieer met je authenticator' : 'Stel MFA in'}
          </Link>
          .
        </p>
      </div>
    );
  }

  const activeVenue = adminVenues.find((m) => m.venueId === venueParam) ?? adminVenues[0];
  const members = await getVenueMembers(activeVenue.venueId);
  const selectedUser = members.find((m) => m.userId === userParam);
  const sessions = selectedUser ? await adminListSessions(selectedUser.userId) : [];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl font-bold">Sessies & remote logout</h1>
        <p className="text-dim mt-1 text-sm">
          Bekijk actieve apparaten van een teamlid en log ze op afstand uit —{' '}
          <span className="text-text">{activeVenue.venueName}</span>.
        </p>
      </header>

      {adminVenues.length > 1 && (
        <nav className="flex flex-wrap gap-2" aria-label="Venue kiezen">
          {adminVenues.map((m) => (
            <Link
              key={m.venueId}
              href={`/admin/sessions?venue=${m.venueId}`}
              className={`rounded-btn border px-3 py-1.5 text-sm transition-colors ${
                m.venueId === activeVenue.venueId
                  ? 'border-acc bg-acc-dim text-text'
                  : 'border-line text-dim hover:border-acc'
              }`}
            >
              {m.venueName}
            </Link>
          ))}
        </nav>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="label">Teamlid kiezen</h2>
        <ul className="flex flex-col gap-2">
          {members.map((member) => (
            <li key={member.userId}>
              <Link
                href={`/admin/sessions?venue=${activeVenue.venueId}&user=${member.userId}`}
                className={`card flex items-center justify-between transition-colors ${
                  member.userId === selectedUser?.userId ? 'border-acc' : ''
                }`}
              >
                <div>
                  <p className="font-semibold">{member.fullName}</p>
                  <p className="text-faint text-sm">{member.email}</p>
                </div>
                <span className="text-faint text-xs">Bekijk sessies →</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {selectedUser && (
        <section className="flex flex-col gap-3">
          <h2 className="label">Sessies van {selectedUser.fullName}</h2>
          <SessionList sessions={sessions} admin />
        </section>
      )}
    </div>
  );
}
