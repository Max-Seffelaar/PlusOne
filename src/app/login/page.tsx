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
  searchParams: Promise<{ next?: string }>;
}): Promise<JSX.Element> {
  const { next } = await searchParams;
  const nextPath = safeNextPath(next);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4">
      <OtpLoginForm nextPath={nextPath} />
    </main>
  );
}
