'use client';

import { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

const STEP_EMAIL = 'email';
const STEP_OTP = 'otp';

interface LoginOTPProps {
  onSuccess?: (session: any) => void;
}

export function LoginOTP({ onSuccess }: LoginOTPProps) {
  const [step, setStep] = useState(STEP_EMAIL);
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  );

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.toLowerCase(),
      });

      if (error) {
        setError('Fout bij verzenden code. Probeer opnieuw.');
        return;
      }

      setMessage(`Code verzonden naar ${email}. Controleer spam-map.`);
      setStep(STEP_OTP);
    } catch {
      setError('Onverwachte fout. Probeer opnieuw.');
    } finally {
      setLoading(false);
    }
  }

  async function handleOTPSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: email.toLowerCase(),
        token: otp,
        type: 'email',
      });

      if (error || !data.session) {
        setError('Code ongeldig of verlopen. Probeer opnieuw.');
        return;
      }

      onSuccess?.(data.session);
    } catch {
      setError('Onverwachte fout. Probeer opnieuw.');
    } finally {
      setLoading(false);
    }
  }

  if (step === STEP_EMAIL) {
    return (
      <div className="w-full max-w-md mx-auto p-6">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">PLUSONE</h1>
          <p className="text-gray-600">Inloggen met e-mail</p>
        </div>

        <form onSubmit={handleEmailSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              E-mailadres
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              placeholder="naam@voorbeeld.nl"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
              required
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50"
          >
            {loading ? 'Verzenden...' : 'Code verzenden'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">PLUSONE</h1>
        <p className="text-gray-600">Voer uw code in</p>
      </div>

      <form onSubmit={handleOTPSubmit} className="space-y-4">
        {message && (
          <div className="p-3 bg-blue-50 border border-blue-200 text-blue-700 rounded-lg text-sm">
            {message}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            6-cijferige code
          </label>
          <input
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
            disabled={loading}
            placeholder="000000"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg text-center text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-purple-500"
            required
          />
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || otp.length !== 6}
          className="w-full py-2 bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50"
        >
          {loading ? 'Verifiëren...' : 'Verifiëren'}
        </button>

        <button
          type="button"
          onClick={() => {
            setStep(STEP_EMAIL);
            setOtp('');
            setError('');
          }}
          disabled={loading}
          className="w-full py-2 text-purple-600 font-medium hover:text-purple-700"
        >
          Terug
        </button>
      </form>
    </div>
  );
}
