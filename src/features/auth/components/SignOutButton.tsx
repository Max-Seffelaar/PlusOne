'use client';

import { useTransition } from 'react';
import { createClient } from '@/lib/supabase/client';

export function SignOutButton(): JSX.Element {
  const supabase = createClient();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className="btn-ghost text-sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await supabase.auth.signOut();
          window.location.assign('/login');
        })
      }
    >
      {pending ? '…' : 'Uitloggen'}
    </button>
  );
}
