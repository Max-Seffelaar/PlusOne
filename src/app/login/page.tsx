import type { JSX } from 'react';
import type { Metadata } from 'next';
import {
  LOGIN_ERROR_MESSAGES,
  OtpLoginForm,
  type LoginErrorKind,
} from '@/features/auth/components/OtpLoginForm';
import { safeNextPath } from '@/features/auth/next-path';
import { reviewLoginEnabled } from '@/features/auth/review-window';
import { t } from '@/lib/i18n';

export const metadata: Metadata = {
  title: 'Log in · PlusOne',
};

// Rendered per request, never prerendered: whether the "App review sign-in"
// link shows depends on the review window (env + the current time), so a build
// taken while a window is open must not bake the link into static HTML that
// outlives it. Reading searchParams already makes the page dynamic; this states
// it so a refactor that drops that read cannot silently change it.
export const dynamic = 'force-dynamic';

/** Where the link goes: the store-review login route (86ey6bfug). A fixed path, never built from input. */
const REVIEW_LOGIN_PATH = '/auth/review-login';

// Public route (whitelisted in middleware). Authenticated users are redirected
// to /app by the middleware before reaching this page.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}): Promise<JSX.Element> {
  const { next, error } = await searchParams;
  const nextPath = safeNextPath(next);
  // The auth routes bounce failures here with ?error=… (`link` from
  // /auth/confirm, `devlogin` from the local dev shortcut). Tell the user what
  // happened and put the "send me a code" step right in front of them, instead
  // of a generic dead end (P-01). An unknown value is ignored.
  const errorKind =
    error && error in LOGIN_ERROR_MESSAGES ? (error as LoginErrorKind) : undefined;
  // Store reviewers in the native shell have no address bar and the demo
  // address has no mailbox, so this link is their only way to the review route.
  // Decided here on the server with the route's own predicate; only this
  // boolean exists on the page — never the code, the expiry or a reason, and
  // nothing from the request can turn it on.
  const showReviewLink = reviewLoginEnabled();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4">
      <OtpLoginForm nextPath={nextPath} errorKind={errorKind} />
      {showReviewLink ? (
        // A plain same-origin <a>, not next/link (the target is a route
        // handler, not a page) and not openExternal/target=_blank: in the
        // remote-URL native shell it must stay inside the webview.
        <a
          href={REVIEW_LOGIN_PATH}
          className="text-dim mt-6 inline-flex min-h-[44px] items-center px-3 text-sm underline underline-offset-4 hover:brightness-125"
        >
          {t.auth.reviewLoginLink}
        </a>
      ) : null}
    </main>
  );
}
