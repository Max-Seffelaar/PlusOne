/**
 * "There’s already an open invite for this email." (team invite, z8uq9m5enh):
 * a rule the user hit, not a bug, so it must classify as expected and land in
 * Sentry as a breadcrumb (runbook "Sentry triage", rule 3). The string carries a
 * curly apostrophe (U+2019); this file spells it out so a retyped straight one
 * fails here instead of silently reopening the Sentry issue.
 */
import { describe, it, expect } from 'vitest';
import { asExpectedMutationError, OPEN_INVITE_EXISTS_MESSAGE } from './db-errors';

describe('open-invite refusal', () => {
  it('is the exact action copy, curly apostrophe included', () => {
    expect(OPEN_INVITE_EXISTS_MESSAGE).toBe('There’s already an open invite for this email.');
  });

  it('is an expected error as the Error po/mutations.ts rethrows', () => {
    expect(asExpectedMutationError(new Error('There’s already an open invite for this email.'))).toEqual({
      message: OPEN_INVITE_EXISTS_MESSAGE,
    });
  });

  it('only that exact copy: a straight apostrophe or another sentence stays reportable', () => {
    expect(asExpectedMutationError(new Error("There's already an open invite for this email."))).toBeNull();
    expect(asExpectedMutationError(new Error('There’s already an open invite for this email. Oops'))).toBeNull();
  });
});
