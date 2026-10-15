import type { JSX } from 'react';
import { requireUser } from '@/lib/auth/guards';
import { safeAreaPadding } from '@/lib/po/safe-area';

// MFA routes sit OUTSIDE the (app) group so the app layout's MFA
// recommendation redirect can never loop them. They require only a signed-in user.
export default async function MfaLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<JSX.Element> {
  await requireUser();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center" style={safeAreaPadding(16)}>
      {children}
    </main>
  );
}
