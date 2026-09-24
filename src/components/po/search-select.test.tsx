// @vitest-environment jsdom
/**
 * SearchSelect (z8uq9m0hw2), the venue settings Country dropdown.
 *
 * Load-bearing: a stored value that is not an option renders as-is and is
 * never replaced until the user picks; search narrows by label or value; a
 * pick reports the option VALUE (the ISO code), not the label.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SearchSelect, type SearchSelectOption } from './search-select';

const OPTIONS: SearchSelectOption[] = [
  { value: 'BE', label: 'Belgium', hint: 'BE' },
  { value: 'DE', label: 'Germany', hint: 'DE' },
  { value: 'NL', label: 'Netherlands', hint: 'NL' },
];
const COPY = {
  label: 'Country',
  placeholder: 'Pick a country',
  searchPlaceholder: 'Search a country or code…',
  searchLabel: 'Search a country',
  emptyText: 'No country found',
};

afterEach(cleanup);

function trigger(): HTMLElement {
  return screen.getByRole('button', { name: /Country:/ });
}

describe('SearchSelect', () => {
  it('shows the label of the stored option, closed', () => {
    render(<SearchSelect {...COPY} value="NL" options={OPTIONS} onChange={() => {}} />);
    expect(trigger()).toHaveTextContent('Netherlands');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('renders a stored value that is not an option exactly as stored, without calling onChange', () => {
    const onChange = vi.fn();
    render(<SearchSelect {...COPY} value="Nederland" options={OPTIONS} onChange={onChange} />);
    expect(trigger()).toHaveTextContent('Nederland');
    fireEvent.click(trigger());
    // Open, nothing selected, and still nothing written.
    expect(screen.getAllByRole('option').every((o) => o.getAttribute('aria-selected') === 'false')).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the placeholder for an empty value', () => {
    render(<SearchSelect {...COPY} value="" options={OPTIONS} onChange={() => {}} />);
    expect(trigger()).toHaveTextContent('Pick a country');
  });

  it('opens, marks the current option, and reports the picked VALUE', () => {
    const onChange = vi.fn();
    render(<SearchSelect {...COPY} value="NL" options={OPTIONS} onChange={onChange} />);
    fireEvent.click(trigger());
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('option', { name: /Netherlands/ })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('button', { name: /Germany/ }));
    expect(onChange).toHaveBeenCalledWith('DE');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('filters by label or by code, and says so when nothing matches', () => {
    render(<SearchSelect {...COPY} value="NL" options={OPTIONS} onChange={() => {}} />);
    fireEvent.click(trigger());
    const search = screen.getByRole('textbox', { name: 'Search a country' });

    fireEvent.change(search, { target: { value: 'germ' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['GermanyDE']);

    fireEvent.change(search, { target: { value: 'be' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['BelgiumBE']);

    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('No country found')).toBeInTheDocument();
  });

  it('picks the first match on Enter', () => {
    const onChange = vi.fn();
    render(<SearchSelect {...COPY} value="NL" options={OPTIONS} onChange={onChange} />);
    fireEvent.click(trigger());
    const search = screen.getByRole('textbox', { name: 'Search a country' });
    fireEvent.change(search, { target: { value: 'bel' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('BE');
  });

  it('closes on Escape and on an outside tap without changing the value', () => {
    const onChange = vi.fn();
    render(
      <div>
        <span data-testid="outside">outside</span>
        <SearchSelect {...COPY} value="NL" options={OPTIONS} onChange={onChange} />
      </div>,
    );
    fireEvent.click(trigger());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.click(trigger());
    fireEvent.pointerDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('is read-only without onChange: no button, value still shown', () => {
    render(<SearchSelect {...COPY} value="NL" options={OPTIONS} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Netherlands')).toBeInTheDocument();
  });
});
