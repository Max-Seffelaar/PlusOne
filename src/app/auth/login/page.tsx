import { redirect } from 'next/navigation';
import { LoginOTP } from '@/components/LoginOTP';
import { getCurrentUser } from '@/lib/auth';

export default async function LoginPage() {
  const user = await getCurrentUser();

  // If already logged in, redirect to dashboard
  if (user) {
    redirect('/dashboard');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100">
      <LoginOTP
        onSuccess={() => {
          // Client will handle redirect after successful login
          window.location.href = '/dashboard';
        }}
      />
    </div>
  );
}
