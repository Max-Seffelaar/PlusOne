'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser-client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const supabase = getBrowserSupabaseClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }

    router.push('/admin/venues');
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-bg">
      <div className="w-full max-w-md p-8 rounded-lg border border-border bg-bg-secondary">
        <h1 className="text-2xl font-bricolage font-bold mb-6 text-text">PLUSONE</h1>

        <form onSubmit={handleLogin} className="space-y-4">
          {error && (
            <div className="p-3 rounded bg-red-100 text-red-900 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-dim mb-2">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="max.seffelaar@gmail.com"
              className="w-full px-4 py-2 rounded-lg border border-border bg-bg text-text focus:outline-none focus:ring-2 focus:ring-accent/50"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-dim mb-2">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••"
              className="w-full px-4 py-2 rounded-lg border border-border bg-bg text-text focus:outline-none focus:ring-2 focus:ring-accent/50"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-2 rounded-lg bg-accent text-bg font-medium hover:bg-accent-dark disabled:opacity-50 mt-6"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="text-xs text-dim text-center mt-4">
          Test account: max.seffelaar@gmail.com / 000000
        </p>
      </div>
    </main>
  );
}
