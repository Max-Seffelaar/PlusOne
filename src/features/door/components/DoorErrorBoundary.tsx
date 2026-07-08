'use client';

/**
 * Defence-in-depth for the door surface (C13). A render/effect throw anywhere in
 * the door subtree (e.g. a webview API that behaves unexpectedly) must degrade to
 * a recoverable message with a retry, never a blank white screen at the door.
 * The primary C13 fix is guarding localStorage in `getDeviceId`; this boundary
 * catches anything else that slips through.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class DoorErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Details to the server log only (CLAUDE.md: no PII to the client). Guard
    // console for webviews that don't expose it.
    if (typeof console !== 'undefined') console.error('Door surface crashed', error, info.componentStack);
  }

  private handleReload = (): void => {
    if (typeof window !== 'undefined') window.location.reload();
    else this.setState({ hasError: false });
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-4 bg-bg px-6 text-center">
        <div className="font-display text-[18px] font-extrabold tracking-[-0.01em] text-text">
          The door hit a snag
        </div>
        <p className="max-w-[280px] text-[13.5px] leading-[1.5] text-faint">
          Queued check-ins are saved on this device and will sync once it recovers. Reload to continue.
        </p>
        <button
          type="button"
          onClick={this.handleReload}
          className="rounded-full bg-acc px-5 py-2.5 font-display text-[14px] font-bold text-on-acc transition-[filter] hover:brightness-[1.07] active:scale-[0.97]"
        >
          Reload
        </button>
      </div>
    );
  }
}
