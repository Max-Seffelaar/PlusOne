import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/guards';
import { hasAcceptedCurrentTerms } from '@/lib/auth/consent';
import { safeNextPath } from '@/features/auth/next-path';
import { ConsentScreen } from '@/features/auth/components/ConsentScreen';

export const metadata: Metadata = {
  title: 'Terms & privacy · PlusOne',
};

// First-login consent gate (#20/#40). Reachable by any signed-in user (it sits in
// front of the app); a user who already accepted the current version is sent on.
// A first-time user without a name gets the account-setup variant (T1 #3):
// name required + phone optional on the same screen — one flow, no extra stop.
export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}): Promise<JSX.Element> {
  const user = await requireUser('/consent');
  // Shared guard (not a weaker local copy): blocks protocol-relative, scheme,
  // and backslash-smuggled off-site targets — the `next` here reaches both a
  // server redirect and the client's window.location.replace.
  const next = safeNextPath((await searchParams).next);
  if (await hasAcceptedCurrentTerms(user.id)) redirect(next);

  // Row may not exist yet for a brand-new invitee (created on submit) — that is
  // exactly the "needs details" case.
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('first_name, last_name')
    .eq('id', user.id)
    .maybeSingle();
  const needsDetails = !profile?.first_name || !profile?.last_name;

  return <ConsentScreen next={next} email={user.email ?? ''} needsDetails={needsDetails} />;
}
