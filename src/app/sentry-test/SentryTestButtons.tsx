'use client';

import * as Sentry from '@sentry/nextjs';
import { useState, type CSSProperties } from 'react';
import { triggerServerError } from './actions';

// Three triggers exercising the whole pipeline: (1) a client throw → global
// error handler, (2) a server action throw → onRequestError, (3) an explicit
// captureMessage. Bare inline styling — this is a dev/preview diagnostics page.
export function SentryTestButtons(): JSX.Element {
  const [status, setStatus] = useState<string>('');

  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#0B0B0D',
        color: '#fafafa',
        display: 'grid',
        placeItems: 'center',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ display: 'grid', gap: 12, padding: 24, maxWidth: 360 }}>
        <h1 style={{ fontSize: 18 }}>Sentry test</h1>
        <p style={{ opacity: 0.7, fontSize: 13 }}>
          Elke knop triggert bewust een fout. Controleer daarna Sentry.
        </p>
        <button
          style={btn}
          onClick={() => {
            throw new Error('sentry-test: client error');
          }}
        >
          Client error (throw)
        </button>
        <button
          style={btn}
          onClick={async () => {
            setStatus('Server action aangeroepen…');
            try {
              await triggerServerError();
            } catch {
              setStatus('Server action gooide (verwacht) — check Sentry.');
            }
          }}
        >
          Server action error
        </button>
        <button
          style={btn}
          onClick={() => {
            Sentry.captureMessage('sentry-test: message', 'info');
            setStatus('captureMessage verstuurd.');
          }}
        >
          Capture message
        </button>
        {status && <p style={{ fontSize: 13, opacity: 0.8 }}>{status}</p>}
      </div>
    </main>
  );
}

const btn: CSSProperties = {
  padding: '10px 16px',
  borderRadius: 8,
  border: '1px solid #3f3f46',
  background: '#18181b',
  color: '#fafafa',
  cursor: 'pointer',
  fontSize: 14,
};
