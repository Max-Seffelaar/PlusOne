import { describe, expect, it } from 'vitest';
import { EVENT_PROPERTY_KEYS } from './events';

/**
 * PII lint (plan "Testing / Definition of Done", CLAUDE.md "No PII in URLs,
 * query strings, or logs"): walks every property key of every catalogued event
 * and fails on anything that reads like personal data or free text. A guest's
 * name sits right in the mutation variables of the add-guest hooks and the
 * refusal reason is free text — neither may ever become an event property.
 *
 * Widening this list is never the fix. If a new event "needs" one of these, it
 * needs an id or a count instead.
 */
const FORBIDDEN = /name|email|e_mail|mail|phone|tel|address|street|postal|zip|city|note|reason|comment|message|text|query|search|ip|birth|dob|iban|card|token|password|secret|url|path/i;

describe('analytics event catalog', () => {
  const entries = Object.entries(EVENT_PROPERTY_KEYS) as [string, readonly string[]][];

  it('has events to check', () => {
    expect(entries.length).toBeGreaterThan(10);
  });

  it.each(entries)('%s carries no personal-data or free-text property', (_event, keys) => {
    for (const k of keys) expect(k, `property "${k}"`).not.toMatch(FORBIDDEN);
  });

  it('defines no guest-facing event (guests are never tracked)', () => {
    for (const [event] of entries) {
      expect(event).not.toMatch(/^guest_(viewed|opened|submitted|request)|^request_(submitted|sent)|status_page/);
    }
  });

  it('event names are object_action snake_case', () => {
    for (const [event] of entries) expect(event).toMatch(/^[a-z]+(_[a-z]+)+$/);
  });
});
