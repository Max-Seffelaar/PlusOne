import 'server-only';

// Does the domain of an event's contact address take mail? (Gastcommunicatie
// F, PR 6c, z8uq9m2vpy; decision Max 2026-10-10: a domain check only, no
// confirmation mail.)
//
// RFC 5321 §5.1: look up MX; a domain without MX records but with an A/AAAA
// record still takes mail (the implicit MX). RFC 7505: a lone "null MX"
// (exchange ".") says the domain takes no mail at all.
//
//   'no_mail_domain'  NXDOMAIN, or no MX and no A/AAAA, or a null MX: the
//                     organiser gets a clear error and fixes the address.
//   'ok'              anything else, INCLUDING every DNS failure (timeout,
//                     SERVFAIL, refused): fail-open, never block an event on a
//                     resolver hiccup. Logged by code only, never the address
//                     or the domain.
//
// Only DNS queries leave the server, through the platform resolver: no
// connection is made to the domain itself, and an IP literal is refused
// before any lookup. The whole check is capped at CHECK_BUDGET_MS.

import { Resolver } from 'node:dns/promises';

export type MailDomainCheck = 'ok' | 'no_mail_domain';

export interface DomainResolver {
  resolveMx(domain: string): Promise<Array<{ exchange: string; priority: number }>>;
  resolve4(domain: string): Promise<string[]>;
  resolve6(domain: string): Promise<string[]>;
}

/** One try, short per-query timeout: a save waits at most CHECK_BUDGET_MS. */
const QUERY_TIMEOUT_MS = 1500;
const CHECK_BUDGET_MS = 3000;

/** The answer "this name does not exist / has no such record". */
const NOT_THERE = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN']);

function errCode(err: unknown): string {
  const code = err && typeof err === 'object' ? (err as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code : 'unknown';
}

/** The domain part, lower-cased, without a trailing dot; null when unusable. */
export function mailDomainOf(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  const domain = email.slice(at + 1).trim().toLowerCase().replace(/\.$/, '');
  if (domain.length < 3 || domain.length > 253 || !domain.includes('.')) return null;
  // Hostname characters only (IDN arrives as punycode or fails the lookup).
  if (!/^[a-z0-9.-]+$/.test(domain) || domain.includes('..')) return null;
  // An IP literal is not a mail domain (and never a lookup target).
  if (/^[0-9.]+$/.test(domain)) return null;
  return domain;
}

function defaultResolver(): DomainResolver {
  const r = new Resolver({ timeout: QUERY_TIMEOUT_MS, tries: 1 });
  return {
    resolveMx: (d) => r.resolveMx(d),
    resolve4: (d) => r.resolve4(d),
    resolve6: (d) => r.resolve6(d),
  };
}

async function lookup(domain: string, resolver: DomainResolver): Promise<MailDomainCheck | 'error'> {
  try {
    const mx = await resolver.resolveMx(domain);
    if (mx.length > 0) {
      const nullMx = mx.every((m) => m.exchange === '' || m.exchange === '.');
      return nullMx ? 'no_mail_domain' : 'ok';
    }
  } catch (err) {
    const code = errCode(err);
    if (code === 'ENOTFOUND' || code === 'NXDOMAIN') return 'no_mail_domain';
    if (!NOT_THERE.has(code)) return 'error';
  }
  // No MX: the implicit MX (an address record) still takes mail.
  const [v4, v6] = await Promise.allSettled([resolver.resolve4(domain), resolver.resolve6(domain)]);
  const has = (r: PromiseSettledResult<string[]>) => r.status === 'fulfilled' && r.value.length > 0;
  if (has(v4) || has(v6)) return 'ok';
  const missing = (r: PromiseSettledResult<string[]>) =>
    r.status === 'fulfilled' || NOT_THERE.has(errCode(r.reason));
  return missing(v4) && missing(v6) ? 'no_mail_domain' : 'error';
}

/**
 * RFC 2606/6761 reserved names, answered without a lookup: `.invalid`,
 * `.localhost` and `.example` never take mail. `.test` never resolves either,
 * so production refuses it, while dev and CI accept it: every seed and flow
 * address is `@….test`, and the check stays deterministic without network.
 */
function reservedAnswer(domain: string): MailDomainCheck | null {
  const tld = domain.slice(domain.lastIndexOf('.') + 1);
  if (tld === 'invalid' || tld === 'localhost' || tld === 'example') return 'no_mail_domain';
  if (tld === 'test') return process.env.NODE_ENV === 'production' ? 'no_mail_domain' : 'ok';
  return null;
}

/** Check the domain of `email`. Never throws; DNS trouble answers 'ok'. */
export async function checkMailDomain(
  email: string,
  resolver: DomainResolver = defaultResolver(),
  budgetMs: number = CHECK_BUDGET_MS,
): Promise<MailDomainCheck> {
  const domain = mailDomainOf(email);
  if (!domain) return 'no_mail_domain';
  const reserved = reservedAnswer(domain);
  if (reserved) return reserved;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<'error'>((resolve) => {
    timer = setTimeout(() => resolve('error'), budgetMs);
  });
  try {
    const result = await Promise.race([lookup(domain, resolver).catch(() => 'error' as const), budget]);
    if (result === 'error') {
      console.warn('mail domain check failed open', { event: 'mail_domain_check_failed_open' });
      return 'ok';
    }
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
