import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/guards';
import { hasAcceptedCurrentTerms } from '@/lib/auth/consent';
import { ConsentScreen } from '@/features/auth/components/ConsentScreen';

export const metadata: Metadata = {
  title: 'PLUSONE — Voorwaarden & privacy',
};

// Only same-origin relative paths may be returned to (no open redirect).
function safeNext(next: string | undefined): string {
  if (next && next.startsWith('/') && !next.startsWith('//')) return next;
  return '/app';
}

// First-login consent gate (#20/#40). Reachable by any signed-in user (it sits in
// front of the app); a user who already accepted the current version is sent on.
export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}): Promise<JSX.Element> {
  const user = await requireUser('/consent');
  const next = safeNext((await searchParams).next);
  if (await hasAcceptedCurrentTerms(user.id)) redirect(next);
  return <ConsentScreen next={next} email={user.email ?? ''} />;
}
