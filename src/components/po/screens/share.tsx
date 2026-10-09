'use client';

// Share-import S2: the landing of `/app/share`, where text shared from WhatsApp,
// Mail, Notes or Excel arrives — via the installed PWA's Web Share Target today,
// via the native share plugin (S6) in a later store build. It is Paste a list
// with the text filled in and an event + tier picker on top; Add runs the one
// existing import path.
//
// The text is PII. On mount it moves from the URL into the in-memory share
// inbox and the address bar is rewritten without it — nothing here stores,
// logs or sends it anywhere before the user presses Add. Leaving the screen
// forgets it.
import { type JSX, useEffect, useState } from 'react';
import { captureShareFromLocation, clearSharedText, peekSharedText } from '@/features/guests/share-inbox';
import { BulkPaste } from './guests/bulk-paste';

export function ShareScreen(): JSX.Element | null {
  // null = not captured yet: BulkPaste seeds its textarea once, at mount.
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    // 'reloading': a fresh document (without the query) replaces this one and
    // captures the text itself — render nothing until then.
    if (captureShareFromLocation() === 'reloading') return undefined;
    // StrictMode's second pass finds the URL clean: keep what the first took.
    setText((prev) => peekSharedText() ?? prev ?? '');
    return () => clearSharedText();
  }, []);
  if (text === null) return null;
  return <BulkPaste share initialText={text} onImported={clearSharedText} />;
}
