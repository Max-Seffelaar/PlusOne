// Billing abstraction (CLAUDE.md §Billing): the app never calls Stripe directly.
// Every billing side effect goes through a BillingProvider, so swapping the stub
// for the real Stripe adapter (billing-fase #32) touches only this file. For MVP
// the stub just resolves the starting subscription status — no network call.

import type { PlanId } from './plans';

export type SubscriptionStartStatus = 'trialing' | 'comped';

export interface StartSubscriptionInput {
  venueId?: string;
  planId: PlanId;
  /** comped venues run without billing during pilots (#32/#40c). */
  comped?: boolean;
}

export interface StartSubscriptionResult {
  status: SubscriptionStartStatus;
  planId: PlanId;
}

export interface BillingProvider {
  startSubscription(input: StartSubscriptionInput): Promise<StartSubscriptionResult>;
}

// MVP stub: no Stripe, no checkout (the "Betaling" screen is deferred). A picked
// plan simply starts a trialing subscription, or comped when flagged.
export class StubBillingProvider implements BillingProvider {
  async startSubscription(input: StartSubscriptionInput): Promise<StartSubscriptionResult> {
    return {
      status: input.comped ? 'comped' : 'trialing',
      planId: input.planId,
    };
  }
}

// The single provider instance the app reads from. Replace the construction here
// when the Stripe adapter ships; callers never change.
export const billing: BillingProvider = new StubBillingProvider();
