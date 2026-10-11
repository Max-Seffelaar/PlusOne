// @vitest-environment jsdom
/**
 * Review #466 rounds 3–5, layer 1: PlusOne's own labels are a TYPE, not text.
 * A member's name renders as plain text whatever it says ("System" + an
 * invisible character, "PlusOne support", a styled look-alike with a shield
 * symbol); only a non-member kind renders as the CHIP — bordered pill, icon,
 * data-actor-kind, and its accessible name ON the element (role="img" +
 * aria-label), which no name text can produce or fake.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { fmt, t } from '@/lib/i18n';
import { ActorAvatar, ActorCaption, ActorName, ActorPhrase } from './kit';
import { GuestSourceCaption } from './screens/guests/source-caption';

const cp = String.fromCodePoint;
const LRI = cp(0x2066);
/** Shield + Mathematical Sans-Serif Italic "PlusOne" + U+2800 + "support". */
const STYLED_LOOKALIKE =
  cp(0x26e8) +
  [...'PlusOne support']
    .map((ch) => {
      const c = ch.charCodeAt(0);
      if (c >= 65 && c <= 90) return cp(0x1d608 + c - 65);
      if (c >= 97 && c <= 122) return cp(0x1d622 + c - 97);
      return cp(0x2800);
    })
    .join('');
/** A member name that tries to carry the hint text itself (Cyrillic e). */
const HINT_SPOOF = `Syst${cp(0x0435)}m, PlusOne label`;

describe('ActorName', () => {
  it.each(['Max Seffelaar', `System${LRI}`, 'PlusOne support', 'PIusOne support', STYLED_LOOKALIKE, HINT_SPOOF])(
    'renders the member %j as plain text: no chip, no icon, no role, no aria-label',
    (name) => {
      const { container } = render(<ActorName name={name} kind="member" />);
      expect(container.textContent).toBe(name);
      expect(container.querySelector('[data-actor-kind]')).toBeNull();
      expect(container.querySelector('svg')).toBeNull();
      expect(container.querySelector('[role="img"]')).toBeNull();
      expect(container.querySelector('[aria-label]')).toBeNull();
    },
  );

  it('omitted kind = member (existing call sites keep their rendering)', () => {
    const { container } = render(<ActorName name="System" />);
    expect(container.querySelector('[data-actor-kind]')).toBeNull();
  });

  it.each([
    ['support', 'PlusOne support', 'border-acc'],
    ['system', 'System', 'border-line'],
    ['unknown', 'Unknown', 'border-line'],
    ['unnamed', 'Unnamed', 'border-line'],
  ] as const)('renders kind %s as a bordered chip that names itself for screen readers', (kind, text, border) => {
    const { container } = render(<ActorName name={text} kind={kind} />);
    const el = container.querySelector(`[data-actor-kind="${kind}"]`)!;
    expect(el).not.toBeNull();
    expect(el.textContent).toBe(text);
    expect(el.querySelector('svg')).not.toBeNull();
    expect(el.className).toContain('rounded-full');
    expect(el.className.split(' ')).toContain(border);
    // The hint is ON the chip (not sibling text a name could imitate), read once.
    expect(el.getAttribute('role')).toBe('img');
    expect(el.getAttribute('aria-label')).toBe(fmt(t.shared.actor.chipAria, { label: text }));
    expect(container.querySelector('.sr-only')).toBeNull();
  });

  it('the neutral chip uses the visible border-line (not the faint line2) so it shows on hover/elev rows', () => {
    const { container } = render(<ActorName name="System" kind="system" />);
    const cls = container.querySelector('[data-actor-kind]')!.className.split(' ');
    expect(cls).toContain('border-line');
    expect(cls).not.toContain('border-line2');
  });

  it('compact: icon + short label, never shrinks, full label in title and aria-label', () => {
    const { container } = render(<ActorName name="PlusOne support" kind="support" size="compact" />);
    const el = container.querySelector('[data-actor-kind="support"]')!;
    expect(el.textContent).toBe(t.shared.actor.short.support);
    expect(el.getAttribute('title')).toBe('PlusOne support');
    expect(el.getAttribute('aria-label')).toBe(fmt(t.shared.actor.chipAria, { label: 'PlusOne support' }));
    expect(el.className).toContain('shrink-0');
  });
});

describe('ActorCaption (review #466 V1: never clip the chip mid-pill)', () => {
  it('a non-member actor: a flex row with min-w-0; the text truncates, the compact chip stays whole', () => {
    const { container } = render(
      <ActorCaption template="Added by {name}" slot="name" name="PlusOne support" kind="support" lead="PLUSONE Launch Night · " />,
    );
    const root = container.querySelector('[data-actor-caption="chip"]')!;
    expect(root.className.split(' ')).toEqual(expect.arrayContaining(['flex', 'min-w-0']));
    const [lead] = Array.from(root.children);
    expect(lead!.className.split(' ')).toEqual(expect.arrayContaining(['min-w-0', 'truncate']));
    expect(lead!.textContent).toBe('PLUSONE Launch Night · Added by');
    const chip = root.querySelector('[data-actor-kind="support"]')!;
    expect(chip.getAttribute('data-actor-size')).toBe('compact');
    expect(chip.className).toContain('shrink-0');
  });

  it('keeps a tail (door row "· ••1234") as its own truncating text after the chip', () => {
    const { container } = render(
      <ActorCaption template="· by {name}" slot="name" name="System" kind="system" tail=" · ••1234" />,
    );
    const root = container.querySelector('[data-actor-caption="chip"]')!;
    expect(root.lastElementChild?.textContent).toBe('· ••1234');
    expect(root.lastElementChild?.className).toContain('truncate');
  });

  it('a member: one truncating text line, the name part of it (plain)', () => {
    const { container } = render(
      <ActorCaption template="Added by {name}" slot="name" name={STYLED_LOOKALIKE} kind="member" lead="Launch · " />,
    );
    const root = container.querySelector('[data-actor-caption="text"]')!;
    expect(root.className.split(' ')).toEqual(expect.arrayContaining(['min-w-0', 'truncate']));
    expect(root.textContent).toBe(`Launch · Added by ${STYLED_LOOKALIKE}`);
    expect(container.querySelector('[data-actor-kind]')).toBeNull();
  });
});

describe('ActorAvatar (review #466 V2)', () => {
  it('a member gets initials', () => {
    const { container } = render(<ActorAvatar name="PIusOne support" kind="member" size={36} />);
    expect(container.querySelector('[data-actor-avatar]')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
  });

  it.each(['support', 'system', 'unknown', 'unnamed'] as const)('kind %s gets the icon avatar, not initials', (kind) => {
    const { container } = render(<ActorAvatar name="PlusOne support" kind={kind} size={36} />);
    const el = container.querySelector(`[data-actor-avatar="${kind}"]`)!;
    expect(el).not.toBeNull();
    expect(el.querySelector('svg')).not.toBeNull();
    expect(el.textContent).toBe('');
  });
});

describe('ActorPhrase', () => {
  it('drops the actor into the template slot', () => {
    const { container } = render(<ActorPhrase template="by {name} today" slot="name" name="PlusOne support" kind="support" />);
    expect(container.querySelector('[data-actor-kind="support"]')?.textContent).toBe('PlusOne support');
    expect(container.textContent).toBe('by PlusOne support today');
  });

  it('a member named like a label inside a phrase stays plain', () => {
    const { container } = render(<ActorPhrase template="by {name}" slot="name" name={`System${LRI}`} kind="member" />);
    expect(container.querySelector('[data-actor-kind]')).toBeNull();
    expect(container.textContent).toBe(`by System${LRI}`);
  });
});

describe('GuestSourceCaption', () => {
  it('renders an operator as the compact support chip in a flex caption', () => {
    const { container } = render(<GuestSourceCaption source="app" addedByName="PlusOne support" addedByKind="support" />);
    expect(container.querySelector('[data-actor-caption="chip"]')).not.toBeNull();
    expect(container.querySelector('[data-actor-kind="support"]')?.getAttribute('data-actor-size')).toBe('compact');
  });

  it('renders a member called "PlusOne support" or the styled look-alike plainly', () => {
    for (const name of ['PlusOne support', STYLED_LOOKALIKE]) {
      const { container } = render(<GuestSourceCaption source="app" addedByName={name} addedByKind="member" />);
      expect(container.querySelector('[data-actor-kind]')).toBeNull();
    }
  });
});
