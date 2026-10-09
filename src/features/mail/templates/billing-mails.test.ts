/**
 * Billing-mail templates (z8uq9m2z19): copy v3 lands verbatim, the injection
 * rules hold, every button goes to a web page, and no amount ever appears.
 */
import { describe, expect, it } from 'vitest';
import { renderBillingMail, trialEndDate, BILLING_MAIL_FROM, BILLING_MAIL_REPLY_TO } from './billing-mails';
import { billingMailCopy } from './billing-copy';
import { TRIAL_MAIL_TYPES, EVENT_MAIL_TYPES, type BillingMailType } from '@/features/billing/mail-schedule';

const APP = 'https://app.plus-one.io';
const ALL: BillingMailType[] = [...TRIAL_MAIL_TYPES, ...EVENT_MAIL_TYPES];
// ADE override: 27 Oct 00:00 Amsterdam.
const ADE_END = '2026-10-26T23:00:00Z';

function render(type: BillingMailType, over: Partial<Parameters<typeof renderBillingMail>[0]> = {}) {
  return renderBillingMail({ type, firstName: 'Sanne', companyName: 'Club Vesper', trialEndsAt: ADE_END, ...over }, APP);
}

describe('renderBillingMail: the seven subjects from copy v3', () => {
  it.each([
    ['billing_trial_day0', "You're in. Club Vesper is on PlusOne"],
    ['billing_trial_day7', 'Keep PlusOne after 27 October?'],
    ['billing_trial_day12', 'Your trial ends in 2 days'],
    ['billing_trial_ended', 'Your PlusOne trial has ended'],
    ['billing_trial_day21', 'Was something missing in PlusOne?'],
    ['billing_payment_failed', "Your PlusOne payment didn't go through"],
    ['billing_canceled', 'Your PlusOne subscription has ended'],
  ] as const)('%s -> %s', (type, subject) => {
    expect(render(type).subject).toBe(subject);
  });
});

describe('renderBillingMail: body facts', () => {
  it('trial-0: greeting, the trial end in Amsterdam, button to a new event', () => {
    const m = render('billing_trial_day0');
    expect(m.text).toContain('Hi Sanne,');
    expect(m.text).toContain('Club Vesper is live on PlusOne, and your Pro trial runs until 27 October.');
    expect(m.html).toContain('href="https://app.plus-one.io/app/events/new"');
    expect(m.text).toContain('Create your first event: https://app.plus-one.io/app/events/new');
  });

  it.each(['billing_trial_day7', 'billing_trial_day12', 'billing_trial_ended', 'billing_trial_day21', 'billing_payment_failed', 'billing_canceled'] as const)(
    '%s: button goes to the web Billing page',
    (type) => {
      const m = render(type);
      expect(m.html).toContain('href="https://app.plus-one.io/app/billing"');
      expect(m.html).toContain(`>${billingMailCopy[type].button}</a>`);
      expect(m.html).toContain('Button not working? Open https://app.plus-one.io/app/billing');
    }
  );

  it('the preheader is in the html, hidden', () => {
    expect(render('billing_trial_day12').html).toContain(
      'After 27 October, new events and invites pause until payment is set up.'
    );
  });

  it('every mail ends with the reply line; only the Stripe mails name the invoices', () => {
    for (const type of ALL) {
      const m = render(type);
      expect(m.text).toContain('Reply to this email with any question. It goes straight to the PlusOne team.');
      expect(m.text).toContain("You got this email because you're an admin or in finance at Club Vesper on PlusOne.");
      const invoices = m.text.includes('Stripe sends your invoices separately.');
      expect(invoices).toBe(type === 'billing_payment_failed' || type === 'billing_canceled');
    }
  });

  it('no amount, currency or price anywhere', () => {
    for (const type of ALL) {
      const m = render(type);
      expect(m.text).not.toMatch(/[€$£]|\bEUR\b|\d+[.,]\d{2}/);
      expect(m.html).not.toMatch(/[€$£]|\bEUR\b/);
    }
  });

  it('no name: "Hi there," instead of "Hi ,"', () => {
    for (const firstName of [null, '', '   ']) {
      const m = render('billing_trial_day7', { firstName });
      expect(m.text).toContain('Hi there,');
      expect(m.text).not.toContain('Hi ,');
    }
  });

  it('no unfilled placeholder survives in any mail', () => {
    for (const type of ALL) {
      const m = render(type);
      expect(m.text).not.toMatch(/\{[a-z_]+\}/);
      expect(m.html).not.toMatch(/\{[a-z_]+\}/);
    }
  });
});

describe('renderBillingMail: injection rules', () => {
  it('HTML in a company or first name renders as text', () => {
    const m = render('billing_trial_day0', { companyName: '<a href="https://evil">Bar</a>', firstName: '<b>x</b>' });
    expect(m.html).not.toContain('<a href="https://evil">');
    expect(m.html).toContain('&lt;a href=&quot;https://evil&quot;&gt;Bar&lt;/a&gt;');
    expect(m.html).toContain('Hi &lt;b&gt;x&lt;/b&gt;,');
  });

  it('subject: no CR/LF (header injection), no HTML entities, capped name', () => {
    const m = render('billing_trial_day0', { companyName: 'Bar & Grill\r\nBcc: x@evil.test' });
    expect(m.subject).toBe("You're in. Bar & Grill Bcc: x@evil.test is on PlusOne");
    expect(m.subject).not.toMatch(/[\r\n]/);
    const long = render('billing_trial_day0', { companyName: 'A'.repeat(300) });
    expect(long.subject.length).toBeLessThan(120);
  });

  it('a trailing slash on the app URL does not double up', () => {
    const m = renderBillingMail({ type: 'billing_canceled', firstName: 'S', companyName: 'C', trialEndsAt: null }, `${APP}/`);
    expect(m.html).toContain('href="https://app.plus-one.io/app/billing"');
  });
});

describe('trialEndDate', () => {
  it('is the Amsterdam calendar day of the end moment', () => {
    expect(trialEndDate(ADE_END)).toBe('27 October');
    // 23:30 UTC on 31 Mar 2026 is already 1 April in Amsterdam (summer time).
    expect(trialEndDate('2026-03-31T23:30:00Z')).toBe('1 April');
  });
  it('is empty for nothing or junk', () => {
    expect(trialEndDate(null)).toBe('');
    expect(trialEndDate('nope')).toBe('');
  });
});

describe('sender', () => {
  it('is replyable: support@ as sender and reply-to', () => {
    expect(BILLING_MAIL_FROM).toBe('PlusOne <support@plus-one.io>');
    expect(BILLING_MAIL_REPLY_TO).toBe('support@plus-one.io');
  });
});
