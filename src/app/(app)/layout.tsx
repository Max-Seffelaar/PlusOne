import { redirect } from 'next/navigation';
import { requireAppAccess } from '@/lib/auth/guards';
import { getOnboardingState } from '@/lib/auth/onboarding';

// Minimal authenticated wrapper for the one remaining (app) route — the desktop
// Event-dag cockpit (/eventday). The old desktop dashboard shell (sidebar, venue
// switcher, admin pages) was retired: there is a single responsive surface now
// (po `/app`), and every other (app) route redirects there (next.config.js).
// requireAppAccess enforces the MFA policy before the cockpit renders; a
// venue-less user belongs in onboarding first (#40a).
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<JSX.Element> {
  await requireAppAccess();

  const onboarding = await getOnboardingState();
  if (onboarding.step !== 'done') redirect('/onboarding');

  return <>{children}</>;
}
