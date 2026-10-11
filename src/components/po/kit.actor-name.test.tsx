// @vitest-environment jsdom
/**
 * Review #466 round 3, layer 1: PlusOne's own labels are a TYPE, not text.
 * A member's name renders plain whatever it says ("System" + an invisible
 * character, "PlusOne support", a look-alike); only a non-member kind renders
 * as the typed label (muted, italic, icon, data-actor-kind). So no name can
 * pass for "System" or "PlusOne support" on any surface.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ActorName, ActorPhrase } from './kit';
import { GuestSourceCaption } from './screens/guests/source-caption';

const LRI = String.fromCodePoint(0x2066);

describe('ActorName', () => {
  it.each(['Max Seffelaar', `System${LRI}`, 'PlusOne support', 'PIusOne support'])(
    'renders the member %j as plain text, never as a typed label',
    (name) => {
      const { container } = render(<ActorName name={name} kind="member" />);
      expect(container.textContent).toBe(name);
      expect(container.querySelector('[data-actor-kind]')).toBeNull();
      expect(container.querySelector('svg')).toBeNull();
    },
  );

  it('omitted kind = member (existing call sites keep their rendering)', () => {
    const { container } = render(<ActorName name="System" />);
    expect(container.querySelector('[data-actor-kind]')).toBeNull();
  });

  it.each([
    ['support', 'PlusOne support'],
    ['system', 'System'],
    ['unknown', 'Unknown'],
    ['unnamed', 'Unnamed'],
  ] as const)('renders kind %s as the typed label with an icon', (kind, text) => {
    const { container } = render(<ActorName name={text} kind={kind} />);
    const el = container.querySelector(`[data-actor-kind="${kind}"]`);
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe(text);
    expect(el?.querySelector('svg')).not.toBeNull();
    expect(el?.className).toContain('italic');
  });
});

describe('ActorPhrase', () => {
  it('drops the actor into the template slot', () => {
    const { container } = render(<ActorPhrase template="by {name} today" slot="name" name="PlusOne support" kind="support" />);
    expect(container.textContent).toBe('by PlusOne support today');
    expect(container.querySelector('[data-actor-kind="support"]')).not.toBeNull();
  });

  it('a member named like a label inside a phrase stays plain', () => {
    const { container } = render(<ActorPhrase template="by {name}" slot="name" name={`System${LRI}`} kind="member" />);
    expect(container.querySelector('[data-actor-kind]')).toBeNull();
  });
});

describe('GuestSourceCaption', () => {
  it('renders an operator as the typed support label', () => {
    const { container } = render(<GuestSourceCaption source="app" addedByName="PlusOne support" addedByKind="support" />);
    expect(container.textContent).toBe('Added by PlusOne support');
    expect(container.querySelector('[data-actor-kind="support"]')).not.toBeNull();
  });

  it('renders a member called "PlusOne support" plainly', () => {
    const { container } = render(<GuestSourceCaption source="app" addedByName="PlusOne support" addedByKind="member" />);
    expect(container.querySelector('[data-actor-kind]')).toBeNull();
  });
});
