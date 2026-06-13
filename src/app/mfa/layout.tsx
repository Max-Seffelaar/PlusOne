import { requireUser } from '@/lib/auth/guards';

// MFA routes sit OUTSIDE the (app) group so the AAL2-enforcing app layout can
// never redirect-loop them. They require only a signed-in user.
export default async function MfaLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<JSX.Element> {
  await requireUser();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4">{children}</main>
  );
}
