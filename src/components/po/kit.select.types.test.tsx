/**
 * Type-level guard (z8uq9m5m8h): a kit Select must be named. `ariaLabel` when it
 * has no visible label, `labelledBy` when it has one, never neither and never
 * both. `pnpm type-check` covers this file: if the props ever loosen, the
 * `@ts-expect-error` lines stop erroring and tsc fails on them.
 */
import type { JSX } from 'react';
import { describe, it, expect } from 'vitest';
import { Select } from './kit';

const OPTIONS = [{ value: 'a', label: 'A' }];
const noop = (): void => {};

// Never called: these only have to type-check (or fail to, as marked).
export function typeCases(): JSX.Element[] {
  return [
    <Select key="1" value="" onChange={noop} options={OPTIONS} ariaLabel="City" />,
    <Select key="2" value="" onChange={noop} options={OPTIONS} labelledBy="city-label" />,
    // @ts-expect-error -- no accessible name at all
    <Select key="3" value="" onChange={noop} options={OPTIONS} />,
    // @ts-expect-error -- both names: pick one
    <Select key="4" value="" onChange={noop} options={OPTIONS} ariaLabel="City" labelledBy="city-label" />,
  ];
}

describe('Select naming props', () => {
  it('is enforced by the type checker (see the @ts-expect-error cases above)', () => {
    expect(typeof typeCases).toBe('function');
  });
});
