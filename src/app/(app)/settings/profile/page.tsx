import type { Metadata } from 'next';
import { requireAppAccess } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { listOwnSessions } from '@/lib/auth/sessions';
import { ProfileForm } from '@/features/auth/components/ProfileForm';
import { SessionList } from '@/features/auth/components/SessionList';

export const metadata: Metadata = { title: 'Profiel — PLUSONE' };

export default async function ProfilePage(): Promise<JSX.Element> {
  const ctx = await requireAppAccess('/settings/profile');

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('full_name, email')
    .eq('id', ctx.user.id)
    .maybeSingle();

  const sessions = await listOwnSessions();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <header>
        <h1 className="font-display text-2xl font-bold">Profiel</h1>
        <p className="text-dim mt-1 text-sm">Beheer je naam, e-mailadres en actieve sessies.</p>
      </header>

      <ProfileForm
        currentName={profile?.full_name ?? ''}
        currentEmail={profile?.email ?? ctx.user.email ?? ''}
      />

      <section className="flex flex-col gap-3">
        <h2 className="label">Actieve sessies</h2>
        <p className="text-faint text-sm">
          Apparaten waarop je bent ingelogd. Beëindig een sessie als je een toestel niet herkent.
        </p>
        <SessionList sessions={sessions} />
      </section>
    </div>
  );
}
