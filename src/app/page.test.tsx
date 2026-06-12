import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import Home from './page';

describe('Home Page', () => {
  it('renders PLUSONE branding', () => {
    render(<Home />);
    expect(screen.getByText('PLUSONE')).toBeInTheDocument();
  });

  it('displays the tagline', () => {
    render(<Home />);
    expect(screen.getByText('Guest list management for venues')).toBeInTheDocument();
  });

  it('has a Get Started button', () => {
    render(<Home />);
    expect(screen.getByRole('button', { name: /get started/i })).toBeInTheDocument();
  });
});
