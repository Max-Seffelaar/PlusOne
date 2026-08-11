import type { JSX } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/context';
import { requireConsent } from '@/lib/auth/consent';
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

  // First-login consent gate (#20/#40): a deep link straight to this route
  // must not let a not-yet-consented user enroll a factor before ever seeing
  // /consent (this route sits outside the /app layout, so it needs its own
  // gate — mirrors the consent-before-MFA order in src/app/app/layout.tsx).
  await requireConsent(ctx.user.id, nextPath);

  // Already has a factor: enrollment is pointless — verify (or proceed).
  if (ctx.hasVerifiedTotp) {
    redirect(ctx.isAal2 ? nextPath : '/mfa/verify');
  }

  return <MfaEnrollCard nextPath={nextPath} />;
}
