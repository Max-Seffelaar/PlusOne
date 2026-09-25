// @vitest-environment jsdom
/**
 * Webview-safe kit helpers (Fase 17 N1, decision #37): `copyText`,
 * `useCopyText`/`copyStateLabel`, `openExternal` and `ExternalLink`.
 *
 * `copyText` must never throw and must only report `true` when a copy really
 * happened — the copy buttons show "Couldn't copy" on `false` instead of the
 * old silent no-op. `openExternal` must never fall back to `_blank` inside the
 * native shell when the in-app browser plugin is there.
 */
import '@testing-library/jest-dom';
import type { JSX } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { t } from '@/lib/i18n';
import { ExternalLink, copyStateLabel, copyText, openExternal, useCopyText } from './kit';

const origClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

function setClipboard(value: unknown): void {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

function setExecCommand(impl: ((cmd: string) => boolean) | undefined): void {
  Object.defineProperty(document, 'execCommand', { value: impl, configurable: true, writable: true });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (origClipboard) Object.defineProperty(navigator, 'clipboard', origClipboard);
  else delete (navigator as { clipboard?: unknown }).clipboard;
  delete (document as { execCommand?: unknown }).execCommand;
  delete (window as { Capacitor?: unknown }).Capacitor;
});

describe('copyText', () => {
  it('resolves true and writes via the Clipboard API when it works', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    await expect(copyText('https://x.test/e/abc')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('https://x.test/e/abc');
  });

  it('falls back to execCommand when the Clipboard API is absent', async () => {
    setClipboard(undefined);
    const exec = vi.fn().mockReturnValue(true);
    setExecCommand(exec);
    await expect(copyText('hello')).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
    // The temporary textarea is always cleaned up.
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('resolves false (never throws) when the Clipboard API is absent and no fallback works', async () => {
    setClipboard(undefined);
    setExecCommand(undefined);
    await expect(copyText('hello')).resolves.toBe(false);
  });

  it('resolves false when writeText rejects and the fallback also fails', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('NotAllowedError')) });
    setExecCommand(vi.fn().mockReturnValue(false));
    await expect(copyText('hello')).resolves.toBe(false);
  });

  it('resolves false when the fallback itself throws', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('blocked')) });
    setExecCommand(() => {
      throw new Error('SecurityError');
    });
    await expect(copyText('hello')).resolves.toBe(false);
    expect(document.querySelector('textarea')).toBeNull();
  });
});

function CopyProbe({ text }: { text: string }): JSX.Element {
  const [state, copy] = useCopyText(1000);
  return (
    <button type="button" onClick={() => void copy(text)}>
      {copyStateLabel(state, 'Copy link', 'Copied!')}
    </button>
  );
}

describe('useCopyText + copyStateLabel', () => {
  it('shows "Copied!" on success, then reverts', async () => {
    vi.useFakeTimers();
    try {
      setClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
      render(<CopyProbe text="x" />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button'));
      });
      expect(screen.getByRole('button')).toHaveTextContent('Copied!');
      act(() => {
        vi.advanceTimersByTime(1001);
      });
      expect(screen.getByRole('button')).toHaveTextContent('Copy link');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the visible failure label when the copy fails', async () => {
    setClipboard(undefined);
    setExecCommand(undefined);
    render(<CopyProbe text="x" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
    });
    expect(screen.getByRole('button')).toHaveTextContent(t.shared.kit.copyFailed);
  });
});

describe('openExternal', () => {
  it('opens a new tab with noopener,noreferrer in the browser', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openExternal('https://plus-one.io/terms');
    expect(open).toHaveBeenCalledWith('https://plus-one.io/terms', '_blank', 'noopener,noreferrer');
  });

  it('uses the native in-app browser plugin inside the native shell, not window.open', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const browserOpen = vi.fn().mockResolvedValue(undefined);
    (window as { Capacitor?: unknown }).Capacitor = {
      isNativePlatform: () => true,
      Plugins: { Browser: { open: browserOpen } },
    };
    openExternal('https://plus-one.io/privacy');
    expect(browserOpen).toHaveBeenCalledWith({ url: 'https://plus-one.io/privacy' });
    expect(open).not.toHaveBeenCalled();
  });

  it('falls back to window.open in the native shell until the plugin is installed (N3 seam)', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    (window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    openExternal('https://plus-one.io/terms');
    expect(open).toHaveBeenCalledWith('https://plus-one.io/terms', '_blank', 'noopener,noreferrer');
  });
});

describe('ExternalLink', () => {
  it('keeps href, never sets target=_blank, and routes a plain click through openExternal', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<ExternalLink href="https://plus-one.io/terms">Terms</ExternalLink>);
    const link = screen.getByRole('link', { name: 'Terms' });
    expect(link).toHaveAttribute('href', 'https://plus-one.io/terms');
    expect(link).not.toHaveAttribute('target');
    fireEvent.click(link);
    expect(open).toHaveBeenCalledWith('https://plus-one.io/terms', '_blank', 'noopener,noreferrer');
  });

  it('leaves modified clicks (cmd/ctrl) to the browser', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    // jsdom can't navigate; swallow the default action after React has run.
    const stop = (e: Event): void => e.preventDefault();
    window.addEventListener('click', stop);
    try {
      render(<ExternalLink href="https://plus-one.io/terms">Terms</ExternalLink>);
      fireEvent.click(screen.getByRole('link', { name: 'Terms' }), { metaKey: true });
      expect(open).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('click', stop);
    }
  });
});
