'use client';

import { useTransition } from 'react';
import { createClient } from '@/lib/supabase/client';
import { idbClearAll } from '@/features/door/offline/idb';

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
          // Wipe the cached door snapshot + outbox so a shared device never
          // exposes this doorhost's guest data to the next login (spec §5).
          await idbClearAll();
          await supabase.auth.signOut();
          window.location.assign('/login');
        })
      }
    >
      {pending ? '…' : 'Uitloggen'}
    </button>
  );
}
