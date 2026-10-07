/**
 * Provider selection + stub (Mail-infra F0). Mirrors billing/provider.test.ts:
 * no key = stub; the stub logs WITHOUT the address. teamMailActive decides
 * whether an existing account gets the team mail or keeps the magic link.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.restoreAllMocks();
});

async function load(env: { key?: string; nodeEnv: string }) {
  vi.stubEnv('RESEND_API_KEY', env.key ?? '');
  vi.stubEnv('NODE_ENV', env.nodeEnv);
  const config = await import('./config');
  const provider = await import('./provider');
  return { ...config, ...provider };
}

describe('mail provider selection', () => {
  it('serves the stub without a key, and it logs no address', async () => {
    const { mailProvider, StubMailProvider, mailConfig } = await load({ nodeEnv: 'test' });
    expect(mailConfig.resendEnabled).toBe(false);
    expect(mailProvider).toBeInstanceOf(StubMailProvider);
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const res = await mailProvider.send({
      to: 'crew@example.test',
      subject: 's',
      html: 'h',
      text: 't',
      idempotencyKey: 'mail_log/1',
      type: 'team_join',
    });
    expect(res).toEqual({ ok: true, providerMessageId: null });
    expect(JSON.stringify(log.mock.calls)).not.toContain('crew@example.test');
  });

  it('serves the Resend adapter with a key', async () => {
    const { mailProvider, mailConfig } = await load({ key: 're_test', nodeEnv: 'production' });
    expect(mailConfig.resendEnabled).toBe(true);
    expect(mailProvider.constructor.name).toBe('ResendAdapter');
  });

  it.each([
    [{ nodeEnv: 'production' }, false], // prod until Max sets the key: magic link stays
    [{ nodeEnv: 'production', key: 're_test' }, true],
    [{ nodeEnv: 'development' }, true], // local dev: the stub path is exercisable
    [{ nodeEnv: 'test' }, true],
  ])('teamMailActive(%j) = %s', async (env, expected) => {
    const { teamMailActive } = await load(env);
    expect(teamMailActive()).toBe(expected);
  });
});
