'use client';

// Share-import S2: the landing of `/app/share`, where text shared from WhatsApp,
// Mail, Notes or Excel arrives — via the installed PWA's Web Share Target today,
// via the native share plugin (S6) in a later store build. It is Paste a list
// with the text filled in and an event + tier picker on top; Add runs the one
// existing import path.
//
// The text is PII. On mount it moves from the URL into the in-memory share
// inbox and the address bar is rewritten without it — nothing here stores,
// logs or sends it anywhere before the user presses Add.
import { type JSX, useEffect, useState } from 'react';
import { captureShareFromLocation, clearSharedText, peekSharedText } from '@/features/guests/share-inbox';
import { BulkPaste } from './guests/bulk-paste';

export function ShareScreen(): JSX.Element | null {
  // null = not captured yet: BulkPaste seeds its textarea once, at mount.
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    // Rewriting the URL remounts this screen (the shell keys it on the URL);
    // the second mount finds the URL clean and reads the same inbox.
    captureShareFromLocation();
    setText(peekSharedText() ?? '');
  }, []);
  if (text === null) return null;
  return <BulkPaste share initialText={text} onImported={clearSharedText} />;
}
