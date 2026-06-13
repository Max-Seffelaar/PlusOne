'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { acceptInvitesAction } from '../invite-actions';

export function AcceptInvitesButton(): JSX.Element {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <button
      type="button"
      className="btn-primary text-sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await acceptInvitesAction();
          router.refresh();
        })
      }
    >
      {pending ? 'Bezig…' : 'Uitnodiging accepteren'}
    </button>
  );
}
