import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/context';
import { requireConsent } from '@/lib/auth/consent';
import { safeNextPath } from '@/features/auth/next-path';
import { MfaChallengeForm } from '@/features/auth/components/MfaChallengeForm';

export const metadata: Metadata = { title: 'Verify · PlusOne' };

export default async function MfaVerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}): Promise<JSX.Element> {
  const { next } = await searchParams;
  const nextPath = safeNextPath(next);
  const ctx = await getAuthContext();
  if (!ctx) redirect('/login');

  // First-login consent gate (#20/#40): same deep-link gap as /mfa/enroll —
  // this route sits outside the /app layout, so it needs its own gate.
  await requireConsent(ctx.user.id, nextPath);

  // Nothing to challenge → enroll first; already AAL2 → carry on.
  if (!ctx.hasVerifiedTotp) redirect('/mfa/enroll');
  if (ctx.isAal2) redirect(nextPath);

  return <MfaChallengeForm nextPath={nextPath} />;
}
