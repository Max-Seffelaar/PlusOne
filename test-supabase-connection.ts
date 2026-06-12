import { getBrowserSupabaseClient } from './src/lib/supabase/browser-client';

async function testConnection() {
  try {
    const supabase = getBrowserSupabaseClient();
    console.log('✓ Supabase client initialized');
    console.log('✓ Project URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);
    console.log('✓ Anon key configured:', !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    
    // Try to get auth status
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.error('✗ Auth error:', error.message);
    } else {
      console.log('✓ Auth endpoint reachable');
      console.log('✓ Session status:', data.session ? 'Authenticated' : 'Not authenticated (expected)');
    }
  } catch (err) {
    console.error('✗ Connection error:', err);
    process.exit(1);
  }
}

testConnection();
