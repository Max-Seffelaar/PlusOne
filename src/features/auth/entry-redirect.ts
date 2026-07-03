import 'server-only';

import { hasAcceptedCurrentTerms } from '@/lib/auth/consent';
import { getOnboardingState } from '@/lib/auth/onboarding';

/**
 * Resolve the FINAL destination for a just-verified session in one place, so the
 * e-mail-click entry routes (/auth/confirm, /auth/callback) issue a single
 * redirect instead of a chain. Before this, a fresh invitee bounced
 * /app → /onboarding → /consent — three extra document round-trips, each a
 * separate serverless invocation on prod (the "why does this load so long"
 * from the 3/7 prod test). The page gates stay authoritative; this only
 * predicts where they would land the user anyway, so a wrong prediction is
 * merely one extra (harmless) redirect.
 */
export async function resolveEntryDestination(userId: string, next: string): Promise<string> {
  let dest = next;
  // A user without access anywhere is heading for the onboarding wizard, not
  // /app. Only the /app default is rerouted — an explicit next (e.g. the
  // e-mail-change confirmation to /settings/profile) is respected.
  if (dest === '/app') {
    const state = await getOnboardingState();
    if (state.step !== 'done') dest = '/onboarding';
  }
  // First login: consent (+ the account-setup step) comes first, then onward.
  if (!(await hasAcceptedCurrentTerms(userId))) {
    dest = `/consent?next=${encodeURIComponent(dest)}`;
  }
  return dest;
}
