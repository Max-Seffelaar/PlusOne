import { getServerSupabaseClient } from '@/lib/supabase/server-client';
import { redirect } from 'next/navigation';

export async function GET() {
  const supabase = await getServerSupabaseClient();
  await supabase.auth.signOut();
  redirect('/auth/login');
}
