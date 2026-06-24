import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/context';
import { safeNextPath } from '@/features/auth/next-path';
import { MfaEnrollCard } from '@/features/auth/components/MfaEnrollCard';

export const metadata: Metadata = { title: 'Set up MFA · PlusOne' };

export default async function MfaEnrollPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}): Promise<JSX.Element> {
  const { next } = await searchParams;
  const nextPath = safeNextPath(next);
  const ctx = await getAuthContext();
  if (!ctx) redirect('/login');

  // Already has a factor: enrollment is pointless — verify (or proceed).
  if (ctx.hasVerifiedTotp) {
    redirect(ctx.isAal2 ? nextPath : '/mfa/verify');
  }

  return <MfaEnrollCard nextPath={nextPath} />;
}
