// @vitest-environment jsdom
/**
 * The kit Select's options carry the theme's colours (review #463): Windows
 * Chrome draws the native option list on a white background, so an option that
 * only inherits text-text is near-white on white. The select sets both the
 * background and the text of its options, the way the day picker's dropdowns do.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Select } from './kit';

afterEach(cleanup);

describe('Select', () => {
  it('gives its options an explicit theme background and text colour', () => {
    render(
      <Select
        value="b"
        onChange={() => {}}
        ariaLabel="Pick"
        placeholder="All"
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ]}
      />,
    );
    const select = screen.getByRole('combobox', { name: 'Pick' });
    expect(select.className).toContain('[&>option]:bg-elev');
    expect(select.className).toContain('[&>option]:text-text');
    expect(select.querySelectorAll('option')).toHaveLength(3);
  });
});
