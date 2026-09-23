import type { JSX } from 'react';
import type { Metadata } from 'next';
import { OtpLoginForm } from '@/features/auth/components/OtpLoginForm';
import { safeNextPath } from '@/features/auth/next-path';

export const metadata: Metadata = {
  title: 'Log in · PlusOne',
};

// Public route (whitelisted in middleware). Authenticated users are redirected
// to /app by the middleware before reaching this page.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}): Promise<JSX.Element> {
  const { next, error } = await searchParams;
  const nextPath = safeNextPath(next);
  // /auth/confirm bounces a dead e-mail link here with ?error=link. Tell the
  // user what happened and put the "send me a code" step right in front of
  // them, instead of a generic dead end (P-01).
  const linkFailed = error === 'link';

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4">
      <OtpLoginForm nextPath={nextPath} linkFailed={linkFailed} />
    </main>
  );
}
