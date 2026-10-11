// @vitest-environment jsdom
/**
 * Review #466 rounds 3–4, layer 1: PlusOne's own labels are a TYPE, not text.
 * A member's name renders as plain text whatever it says ("System" + an
 * invisible character, "PlusOne support", a styled look-alike with a shield
 * symbol); only a non-member kind renders as the CHIP — bordered pill, icon,
 * data-actor-kind, and a screen-reader hint — which no name text can produce.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { t } from '@/lib/i18n';
import { ActorName, ActorPhrase } from './kit';
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

/** The visible text of a chip (without the sr-only hint). */
function chipText(el: Element): string {
  return el.querySelector('.truncate')?.textContent ?? '';
}

describe('ActorName', () => {
  it.each(['Max Seffelaar', `System${LRI}`, 'PlusOne support', 'PIusOne support', STYLED_LOOKALIKE])(
    'renders the member %j as plain text: no chip, no icon, no hint',
    (name) => {
      const { container } = render(<ActorName name={name} kind="member" />);
      expect(container.textContent).toBe(name);
      expect(container.querySelector('[data-actor-kind]')).toBeNull();
      expect(container.querySelector('svg')).toBeNull();
      expect(container.querySelector('.sr-only')).toBeNull();
      expect(container.innerHTML).not.toContain('border');
    },
  );

  it('omitted kind = member (existing call sites keep their rendering)', () => {
    const { container } = render(<ActorName name="System" />);
    expect(container.querySelector('[data-actor-kind]')).toBeNull();
  });

  it.each([
    ['support', 'PlusOne support', 'border-acc'],
    ['system', 'System', 'border-line2'],
    ['unknown', 'Unknown', 'border-line2'],
    ['unnamed', 'Unnamed', 'border-line2'],
  ] as const)('renders kind %s as a bordered chip with an icon and a screen-reader hint', (kind, text, border) => {
    const { container } = render(<ActorName name={text} kind={kind} />);
    const el = container.querySelector(`[data-actor-kind="${kind}"]`);
    expect(el).not.toBeNull();
    expect(chipText(el!)).toBe(text);
    expect(el?.querySelector('svg')).not.toBeNull();
    expect(el?.className).toContain('rounded-full');
    expect(el?.className).toContain(border);
    // Screen readers hear that it is PlusOne's label, not a name.
    expect(el?.querySelector('.sr-only')?.textContent?.trim()).toBe(t.shared.actor.labelHint);
  });

  it('the chip shrinks and truncates its own text inside a truncate caption (390px rows)', () => {
    const { container } = render(<ActorName name="PlusOne support" kind="support" />);
    const el = container.querySelector('[data-actor-kind]')!;
    expect(el.className).toContain('min-w-0');
    expect(el.className).toContain('max-w-full');
    expect(el.querySelector('.truncate')?.className).toContain('min-w-0');
  });
});

describe('ActorPhrase', () => {
  it('drops the actor into the template slot', () => {
    const { container } = render(<ActorPhrase template="by {name} today" slot="name" name="PlusOne support" kind="support" />);
    const el = container.querySelector('[data-actor-kind="support"]')!;
    expect(chipText(el)).toBe('PlusOne support');
    expect(container.textContent?.startsWith('by PlusOne support')).toBe(true);
    expect(container.textContent?.endsWith(' today')).toBe(true);
  });

  it('a member named like a label inside a phrase stays plain', () => {
    const { container } = render(<ActorPhrase template="by {name}" slot="name" name={`System${LRI}`} kind="member" />);
    expect(container.querySelector('[data-actor-kind]')).toBeNull();
    expect(container.textContent).toBe(`by System${LRI}`);
  });
});

describe('GuestSourceCaption', () => {
  it('renders an operator as the support chip', () => {
    const { container } = render(<GuestSourceCaption source="app" addedByName="PlusOne support" addedByKind="support" />);
    const el = container.querySelector('[data-actor-kind="support"]')!;
    expect(chipText(el)).toBe('PlusOne support');
    expect(container.textContent?.startsWith('Added by PlusOne support')).toBe(true);
  });

  it('renders a member called "PlusOne support" or the styled look-alike plainly', () => {
    for (const name of ['PlusOne support', STYLED_LOOKALIKE]) {
      const { container } = render(<GuestSourceCaption source="app" addedByName={name} addedByKind="member" />);
      expect(container.querySelector('[data-actor-kind]')).toBeNull();
    }
  });
});
