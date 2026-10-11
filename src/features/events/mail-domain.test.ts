/**
 * The event contact domain check (guest mail 6c): MX first, the A/AAAA
 * implicit MX, a null MX refused, and every DNS failure fails OPEN so a
 * resolver hiccup never blocks an event. No real DNS: the resolver is a stub.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { checkMailDomain, mailDomainOf, type DomainResolver } from './mail-domain';

function dnsError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

function resolver(over: Partial<Record<keyof DomainResolver, () => Promise<unknown>>>): DomainResolver {
  const none = () => Promise.reject(dnsError('ENODATA'));
  return {
    resolveMx: (over.resolveMx ?? none) as DomainResolver['resolveMx'],
    resolve4: (over.resolve4 ?? none) as DomainResolver['resolve4'],
    resolve6: (over.resolve6 ?? none) as DomainResolver['resolve6'],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mailDomainOf', () => {
  it('takes the domain after the last @, lower-cased, without a trailing dot', () => {
    expect(mailDomainOf('Guests@Vesper.Test')).toBe('vesper.test');
    expect(mailDomainOf('a@vesper.test.')).toBe('vesper.test');
  });
  it('refuses IP literals, single labels and junk before any lookup', () => {
    for (const e of ['a@127.0.0.1', 'a@localhost', 'a@', '@x.test', 'a@b..c', 'a@ex ample.test', 'a@[1.2.3.4]']) {
      expect(mailDomainOf(e), e).toBeNull();
    }
  });
});

describe('checkMailDomain', () => {
  it('reserved names never reach DNS: .invalid/.localhost/.example refused, .test only outside production', async () => {
    const mx = vi.fn(async () => [{ exchange: 'mx.x', priority: 1 }]);
    const r = resolver({ resolveMx: mx });
    for (const e of ['a@nope.invalid', 'a@x.localhost', 'a@x.example']) {
      expect(await checkMailDomain(e, r), e).toBe('no_mail_domain');
    }
    expect(await checkMailDomain('guests@vesper.test', r)).toBe('ok');
    vi.stubEnv('NODE_ENV', 'production');
    expect(await checkMailDomain('guests@vesper.test', r)).toBe('no_mail_domain');
    vi.unstubAllEnvs();
    expect(mx).not.toHaveBeenCalled();
  });

  it('ok when the domain has an MX record', async () => {
    const r = resolver({ resolveMx: async () => [{ exchange: 'mx.vesper.test', priority: 10 }] });
    expect(await checkMailDomain('guests@vesper.nl', r)).toBe('ok');
  });

  it('ok without MX when an A or AAAA record exists (RFC 5321 implicit MX)', async () => {
    expect(await checkMailDomain('a@x.nl', resolver({ resolve4: async () => ['192.0.2.1'] }))).toBe('ok');
    expect(await checkMailDomain('a@x.nl', resolver({ resolve6: async () => ['2001:db8::1'] }))).toBe('ok');
  });

  it('refuses NXDOMAIN, a name with no MX and no address, and a null MX', async () => {
    const nx = resolver({ resolveMx: () => Promise.reject(dnsError('ENOTFOUND')) });
    expect(await checkMailDomain('a@does-not-exist.nl', nx)).toBe('no_mail_domain');
    expect(await checkMailDomain('a@empty.nl', resolver({}))).toBe('no_mail_domain');
    const nullMx = resolver({ resolveMx: async () => [{ exchange: '', priority: 0 }] });
    expect(await checkMailDomain('a@nomail.nl', nullMx)).toBe('no_mail_domain');
  });

  it('refuses an IP literal without asking DNS', async () => {
    const mx = vi.fn(async () => []);
    expect(await checkMailDomain('a@10.0.0.1', resolver({ resolveMx: mx }))).toBe('no_mail_domain');
    expect(mx).not.toHaveBeenCalled();
  });

  it('fails OPEN on DNS trouble (timeout, SERVFAIL, refused) and logs no address', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const code of ['ETIMEOUT', 'ESERVFAIL', 'ECONNREFUSED']) {
      const r = resolver({ resolveMx: () => Promise.reject(dnsError(code)) });
      expect(await checkMailDomain('secret@vesper.nl', r), code).toBe('ok');
    }
    // No MX, and the address lookups fail rather than come back empty.
    const half = resolver({ resolve4: () => Promise.reject(dnsError('ETIMEOUT')) });
    expect(await checkMailDomain('secret@vesper.nl', half)).toBe('ok');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('vesper');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret');
  });

  it('fails OPEN when DNS hangs past the budget', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const hang = resolver({ resolveMx: () => new Promise(() => undefined) });
    expect(await checkMailDomain('a@slow.nl', hang, 20)).toBe('ok');
  });
});
