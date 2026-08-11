import type { JSX } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getSessionUser } from '@/lib/auth/context';

export const metadata: Metadata = {
  title: 'Page not found — PLUSONE',
};

// Global 404 boundary (S3.4). Next renders this for unmatched routes AND whenever
// a page calls notFound() — e.g. a deleted or forbidden event in /door/[eventId].
//
// We deliberately show a friendly page with a prominent CTA instead of a
// server-side redirect(): redirect() from not-found.tsx is brittle across Next
// versions and risks a loop if the target itself fails. Middleware already
// bounces unauthenticated users on protected routes to /login, so a signed-in
// visitor who lands here just needs a one-tap way back to their venue overview.
//
// Security (no existence leak, CLAUDE.md §RLS): a guest who hits a real-but-
// forbidden event id gets the EXACT same page as a typo or a deleted event —
// nothing here reveals whether the resource ever existed. The auth check only
// decides where the button points (/app vs /login), never what is shown.
export default async function NotFound(): Promise<JSX.Element> {
  // Never let the boundary itself throw — if auth can't resolve, treat as guest.
  const user = await getSessionUser().catch(() => null);
  const href = user ? '/app' : '/login';
  const cta = user ? 'Back to your dashboard' : 'Go to login';

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <div className="po-screen-anim flex w-full max-w-[400px] flex-col items-center">
        <span className="font-display text-[13px] font-bold uppercase tracking-[0.22em] text-acc">
          PLUSONE
        </span>
        <h1 className="mt-6 font-display text-[76px] font-extrabold leading-none tracking-[-0.03em] text-text">
          404
        </h1>
        <p className="mt-4 text-[15px] leading-[1.6] text-dim">
          This page took the night off. Maybe the event was cleared, or the link is off.
        </p>
        <Link
          href={href}
          className="mt-8 inline-flex h-[52px] w-full items-center justify-center rounded-btn bg-acc font-display text-[15px] font-bold text-on-acc transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.98]"
        >
          {cta}
        </Link>
      </div>
    </main>
  );
}
