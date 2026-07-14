'use client';

// Root crash screen. Renders its own <html>/<body> (it replaces the root layout
// when that itself crashes) and deliberately shows NO error.message — it can
// carry guest PII. Inline styles: global CSS is gone once the root layout is
// down. Dark theme per the design tokens (#0B0B0D).
import { captureException } from '@/lib/observability/sentry-client';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): JSX.Element {
  useEffect(() => {
    captureException(error);
  }, [error]);

  return (
    <html lang="nl">
      <body
        style={{
          background: '#0B0B0D',
          color: '#fafafa',
          fontFamily: 'system-ui, sans-serif',
          display: 'grid',
          placeItems: 'center',
          minHeight: '100vh',
          margin: 0,
        }}
      >
        <div style={{ textAlign: 'center', padding: 24 }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Er ging iets mis</h1>
          <p style={{ opacity: 0.7, marginBottom: 16 }}>
            De fout is gemeld. Probeer het opnieuw.
          </p>
          <button
            onClick={reset}
            style={{
              padding: '10px 20px',
              borderRadius: 8,
              border: '1px solid #3f3f46',
              background: '#18181b',
              color: '#fafafa',
              cursor: 'pointer',
            }}
          >
            Opnieuw proberen
          </button>
        </div>
      </body>
    </html>
  );
}
