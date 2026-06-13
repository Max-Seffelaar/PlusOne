import { describe, it, expect } from 'vitest';
import { requiresMfa, canGrantRoles, mergeRoles, isManager, hasRole } from './roles';

describe('requiresMfa', () => {
  it('is true for admin and finance', () => {
    expect(requiresMfa(['admin'])).toBe(true);
    expect(requiresMfa(['finance'])).toBe(true);
    expect(requiresMfa(['staff', 'admin'])).toBe(true);
  });
  it('is false for non-sensitive roles', () => {
    expect(requiresMfa(['staff'])).toBe(false);
    expect(requiresMfa(['doorhost', 'staff'])).toBe(false);
    expect(requiresMfa(['user_manager'])).toBe(false);
    expect(requiresMfa([])).toBe(false);
  });
});

describe('canGrantRoles (escalation guard — mirrors RLS)', () => {
  it('lets an admin grant anything, including admin', () => {
    expect(canGrantRoles(['admin'], ['admin'])).toBe(true);
    expect(canGrantRoles(['admin'], ['staff', 'doorhost'])).toBe(true);
  });
  it('lets a user_manager grant non-admin roles', () => {
    expect(canGrantRoles(['user_manager'], ['staff'])).toBe(true);
    expect(canGrantRoles(['user_manager'], ['finance', 'doorhost'])).toBe(true);
  });
  it('never lets a user_manager grant admin', () => {
    expect(canGrantRoles(['user_manager'], ['admin'])).toBe(false);
    expect(canGrantRoles(['user_manager'], ['staff', 'admin'])).toBe(false);
  });
  it('refuses non-managers entirely', () => {
    expect(canGrantRoles(['staff'], ['staff'])).toBe(false);
    expect(canGrantRoles(['doorhost'], ['doorhost'])).toBe(false);
    expect(canGrantRoles(['finance'], ['staff'])).toBe(false);
  });
  it('refuses an empty target role set', () => {
    expect(canGrantRoles(['admin'], [])).toBe(false);
  });
});

describe('mergeRoles', () => {
  it('unions and de-duplicates in canonical order', () => {
    expect(mergeRoles(['staff'], ['doorhost'])).toEqual(['staff', 'doorhost']);
    expect(mergeRoles(['doorhost'], ['admin', 'staff'])).toEqual(['admin', 'staff', 'doorhost']);
    expect(mergeRoles(['staff'], ['staff'])).toEqual(['staff']);
  });
});

describe('isManager / hasRole', () => {
  it('isManager covers admin + user_manager only', () => {
    expect(isManager(['admin'])).toBe(true);
    expect(isManager(['user_manager'])).toBe(true);
    expect(isManager(['finance'])).toBe(false);
    expect(isManager(['staff', 'doorhost'])).toBe(false);
  });
  it('hasRole checks membership', () => {
    expect(hasRole(['staff', 'doorhost'], 'doorhost')).toBe(true);
    expect(hasRole(['staff'], 'admin')).toBe(false);
  });
});
