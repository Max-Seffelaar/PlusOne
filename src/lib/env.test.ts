import { afterEach, describe, expect, it } from 'vitest';
import { requiredServerEnv } from './env';

describe('requiredServerEnv', () => {
  const KEY = 'TEST_REQUIRED_ENV_VAR';

  afterEach(() => {
    delete process.env[KEY];
  });

  it('returns the value when the var is set', () => {
    process.env[KEY] = 'hello';
    expect(requiredServerEnv(KEY)).toBe('hello');
  });

  it('throws a message naming the missing var', () => {
    delete process.env[KEY];
    expect(() => requiredServerEnv(KEY)).toThrowError(/TEST_REQUIRED_ENV_VAR/);
  });

  it('throws on an empty string, not just undefined', () => {
    process.env[KEY] = '';
    expect(() => requiredServerEnv(KEY)).toThrow();
  });
});
