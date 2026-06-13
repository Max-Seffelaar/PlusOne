// Reads OTP codes from the local mail catcher. The Supabase CLI ships Mailpit
// (not Inbucket) on the mail port; this uses the Mailpit REST API.
const MAIL = process.env.INBUCKET_URL ?? 'http://127.0.0.1:55324';

interface MailpitMessage {
  ID: string;
  Created: string;
  To?: Array<{ Address: string }>;
}

/** Wipe all captured mail so the next login reads a fresh code (serial e2e). */
export async function clearMailbox(): Promise<void> {
  await fetch(`${MAIL}/api/v1/messages`, { method: 'DELETE' }).catch(() => undefined);
}

/** Polls for the newest message addressed to `email` and extracts its 6-digit OTP. */
export async function getLatestOtp(email: string, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const target = email.toLowerCase();

  while (Date.now() < deadline) {
    const res = await fetch(`${MAIL}/api/v1/messages?limit=50`).catch(() => null);
    if (res?.ok) {
      const data = (await res.json()) as { messages?: MailpitMessage[] };
      const mine = (data.messages ?? [])
        .filter((m) => (m.To ?? []).some((t) => t.Address.toLowerCase() === target))
        .sort((a, b) => Date.parse(b.Created) - Date.parse(a.Created));

      if (mine.length > 0) {
        const full = (await (await fetch(`${MAIL}/api/v1/message/${mine[0].ID}`)).json()) as {
          Text?: string;
          HTML?: string;
        };
        const text = `${full.Text ?? ''} ${full.HTML ?? ''}`;
        const match = text.match(/enter the code:\s*(\d{6})/i) ?? text.match(/\b(\d{6})\b/);
        if (match) return match[1];
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No OTP e-mail for ${email} within ${timeoutMs}ms`);
}
