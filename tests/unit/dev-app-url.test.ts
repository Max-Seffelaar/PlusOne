/**
 * NEXT_PUBLIC_APP_URL in local dev (scripts/lib/dev-app-url.mjs, used by
 * scripts/dev-env.mjs). Without it the app's invite mail pointed its
 * /auth/confirm button at the prod origin, where a token minted by the local
 * stack can never verify (found testing #437, 2026-10-09).
 */
import { describe, expect, it } from 'vitest';
import { appUrlAdvice, envLocalBody, readEnvValue } from '../../scripts/lib/dev-app-url.mjs';

const LOCAL_SUPABASE = 'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321\n';

describe('envLocalBody', () => {
  it('writes the app origin for the port it serves on, next to the stack keys', () => {
    const body = envLocalBody({ url: 'http://127.0.0.1:55321', anon: 'anon', service: 'svc', port: 7042 });
    expect(readEnvValue(body, 'NEXT_PUBLIC_APP_URL')).toBe('http://localhost:7042');
    expect(readEnvValue(body, 'NEXT_PUBLIC_SUPABASE_URL')).toBe('http://127.0.0.1:55321');
    expect(readEnvValue(body, 'SUPABASE_SERVICE_ROLE_KEY')).toBe('svc');
  });
});

describe('readEnvValue', () => {
  it('strips quotes and CRLF, and treats an empty value as absent', () => {
    expect(readEnvValue('NEXT_PUBLIC_APP_URL="http://localhost:7000"\r\n', 'NEXT_PUBLIC_APP_URL')).toBe(
      'http://localhost:7000'
    );
    expect(readEnvValue('NEXT_PUBLIC_APP_URL=\n', 'NEXT_PUBLIC_APP_URL')).toBeNull();
    expect(readEnvValue('# NEXT_PUBLIC_APP_URL=http://x\n', 'NEXT_PUBLIC_APP_URL')).toBeNull();
  });
});

describe('appUrlAdvice (existing .env.local, never rewritten)', () => {
  it('hints when a local-stack file lacks the key, without overriding', () => {
    const advice = appUrlAdvice(LOCAL_SUPABASE, 7005);
    expect(advice.override).toBeUndefined();
    expect(advice.hint).toContain('NEXT_PUBLIC_APP_URL=http://localhost:7005');
  });

  it('stays quiet for a file that points at a hosted Supabase', () => {
    expect(appUrlAdvice('NEXT_PUBLIC_SUPABASE_URL=https://x.supabase.co\n', 7000)).toEqual({});
  });

  it('corrects a localhost origin on another port (CI writes 7000, Playwright serves 3000)', () => {
    const advice = appUrlAdvice(`${LOCAL_SUPABASE}NEXT_PUBLIC_APP_URL=http://localhost:7000\n`, 3000);
    expect(advice.override).toBe('http://localhost:3000');
  });

  it('leaves a matching or non-localhost origin alone', () => {
    expect(appUrlAdvice(`${LOCAL_SUPABASE}NEXT_PUBLIC_APP_URL=http://localhost:7000/\n`, 7000)).toEqual({});
    expect(appUrlAdvice(`${LOCAL_SUPABASE}NEXT_PUBLIC_APP_URL=https://dev.example.ngrok.app\n`, 7000)).toEqual({});
  });
});
