import { getServerSupabaseClient } from '@/lib/supabase/server-client';

export async function GET() {
  try {
    const supabase = await getServerSupabaseClient();

    // Test connection by getting session
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError && sessionError.message !== 'Auth session missing!') {
      return Response.json(
        {
          status: 'error',
          message: 'Supabase connection failed',
          error: sessionError.message,
        },
        { status: 500 },
      );
    }

    return Response.json(
      {
        status: 'ok',
        message: 'Supabase connected successfully',
        supabaseConfigured: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        hasAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        sessionExists: !!session,
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json(
      {
        status: 'error',
        message: 'Server error',
        error: message,
      },
      { status: 500 },
    );
  }
}
