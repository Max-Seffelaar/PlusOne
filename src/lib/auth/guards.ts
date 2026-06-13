import 'server-only';

import { redirect } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { getAuthContext, getSessionUser, type AuthContext } from './context';

function loginRedirect(nextPath?: string): string {
  return nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : '/login';
}

/** Page guard: require a verified session, else bounce to login. */
export async function requireUser(currentPath?: string): Promise<User> {
  const user = await getSessionUser();
  if (!user) redirect(loginRedirect(currentPath));
  return user;
}

/**
 * Page guard for the authenticated app shell. Beyond requiring a user it
 * enforces the MFA policy (CLAUDE.md §Auth):
 *   - admin/finance without a verified factor → must enroll;
 *   - anyone with a factor on an AAL1 session → must step up.
 * Returns the full context for the layout to render with.
 */
export async function requireAppAccess(currentPath?: string): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) redirect(loginRedirect(currentPath));

  if (ctx.requiresMfa && !ctx.hasVerifiedTotp) {
    redirect('/mfa/enroll');
  }
  if (ctx.hasVerifiedTotp && ctx.currentLevel !== 'aal2' && ctx.nextLevel === 'aal2') {
    redirect('/mfa/verify');
  }
  return ctx;
}

export class AuthorizationError extends Error {
  constructor(public readonly reason: 'unauthenticated' | 'aal2_required') {
    super(reason);
    this.name = 'AuthorizationError';
  }
}

/**
 * Action-level AAL2 assertion — defense in depth next to RLS (which already
 * rejects the write). Throws AuthorizationError so the action maps it to
 * generic Dutch copy.
 */
export async function assertAal2(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) throw new AuthorizationError('unauthenticated');
  if (!ctx.isAal2) throw new AuthorizationError('aal2_required');
  return ctx;
}
