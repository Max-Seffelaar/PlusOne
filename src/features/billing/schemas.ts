// Zod schemas for the billing/onboarding mutations (CLAUDE.md: all input through
// Zod). The plan enum is derived from the single PLAN_IDS catalog so the picker,
// the action and the validation can never drift.

import { z } from 'zod';
import { PLAN_IDS } from './plans';

const uuid = z.string().uuid('Invalid id');

export const planIdSchema = z.enum(PLAN_IDS as unknown as [string, ...string[]]);

export const setVenuePlanSchema = z.object({
  venueId: uuid,
  planId: planIdSchema,
});
export type SetVenuePlanInput = z.input<typeof setVenuePlanSchema>;

export const completeOnboardingSchema = z.object({
  venueId: uuid,
});
export type CompleteOnboardingInput = z.input<typeof completeOnboardingSchema>;
