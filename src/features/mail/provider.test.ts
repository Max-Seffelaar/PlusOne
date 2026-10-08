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

async function load(env: { key?: string; nodeEnv: string; supabaseUrl?: string }) {
  vi.stubEnv('RESEND_API_KEY', env.key ?? '');
  vi.stubEnv('NODE_ENV', env.nodeEnv);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', env.supabaseUrl ?? '');
  vi.stubEnv('INBUCKET_URL', '');
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

// One invite mail (z8uq9m2yvp): on the local stack the stub also hands the mail
// to Mailpit so a developer (and the QA flow) can read it. The same hard gate as
// dev-login: never in a production build, only against a localhost Supabase.
describe('stub → local Mailpit', () => {
  const MAIL = { to: 'new@example.test', subject: 's', html: 'h', text: 't', idempotencyKey: 'mail_log/1', type: 'team_join' };

  it.each([
    [{ nodeEnv: 'development', supabaseUrl: 'http://127.0.0.1:55321' }, 'http://127.0.0.1:55324'],
    [{ nodeEnv: 'test', supabaseUrl: 'http://localhost:55321' }, 'http://127.0.0.1:55324'],
    [{ nodeEnv: 'production', supabaseUrl: 'http://127.0.0.1:55321' }, null],
    [{ nodeEnv: 'development', supabaseUrl: 'https://tolxwgqhppdcvnogdpel.supabase.co' }, null],
    [{ nodeEnv: 'development', supabaseUrl: 'https://localhost.attacker.dev' }, null],
    [{ nodeEnv: 'development' }, null],
  ])('localMailCatcher(%j) = %s', async (env, expected) => {
    const { localMailCatcher } = await load(env);
    expect(localMailCatcher()).toBe(expected);
  });

  it('on the local stack the stub posts the mail to Mailpit; elsewhere it fetches nothing', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    const local = await load({ nodeEnv: 'development', supabaseUrl: 'http://127.0.0.1:55321' });
    expect(await local.mailProvider.send(MAIL)).toEqual({ ok: true, providerMessageId: null });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe('http://127.0.0.1:55324/api/v1/send');
    expect(JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body))).toMatchObject({ To: [{ Email: 'new@example.test' }] });

    vi.resetModules();
    fetchSpy.mockClear();
    const hosted = await load({ nodeEnv: 'development', supabaseUrl: 'https://tolxwgqhppdcvnogdpel.supabase.co' });
    await hosted.mailProvider.send(MAIL);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('the Mailpit hand-off is fire and forget: a hanging catcher never holds the send', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise<Response>(() => {}));
    const { mailProvider } = await load({ nodeEnv: 'development', supabaseUrl: 'http://127.0.0.1:55321' });
    expect(await mailProvider.send(MAIL)).toEqual({ ok: true, providerMessageId: null });
  });

  it('a missing Mailpit never fails the send', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    const { mailProvider } = await load({ nodeEnv: 'development', supabaseUrl: 'http://127.0.0.1:55321' });
    expect(await mailProvider.send(MAIL)).toEqual({ ok: true, providerMessageId: null });
  });
});
