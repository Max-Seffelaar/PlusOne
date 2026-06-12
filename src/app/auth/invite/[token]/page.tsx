'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';

export default function AcceptInvitePage() {
  const params = useParams();
  const token = params.token as string;
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    async function fetchInvite() {
      try {
        // In a real scenario, this would be a server action
        // For now, we'll show a placeholder message
        setError('Uitnodiging laden... Dit vereist server-side verwerking.');
        setLoading(false);
      } catch (err) {
        setError('Fout bij laden uitnodiging');
        setLoading(false);
      }
    }

    fetchInvite();
  }, [token]);

  async function handleAccept(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      // This flow requires server-side processing
      // In phase 2, this will be implemented with an Edge Function
      setError('Invite acceptance requires server-side setup. Coming in next phase.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-600">Uitnodiging laden...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100 p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow p-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Welkom bij PLUSONE</h1>
          <p className="text-gray-600 mb-6">U bent uitgenodigd om lid te worden van een venue.</p>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm mb-4">
              {error}
            </div>
          )}

          {success && (
            <div className="p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm mb-4">
              Welkom! U kunt nu inloggen.
            </div>
          )}

          <form onSubmit={handleAccept} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Uw naam
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={submitting}
                placeholder="Voer uw naam in"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                required
              />
            </div>

            <button
              type="submit"
              disabled={submitting || !displayName}
              className="w-full py-2 bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50"
            >
              {submitting ? 'Verwerking...' : 'Uitnodiging accepteren'}
            </button>
          </form>

          <p className="text-center text-sm text-gray-600 mt-4">
            Al een account? <a href="/auth/login" className="text-purple-600 hover:underline">Inloggen</a>
          </p>
        </div>
      </div>
    </div>
  );
}
