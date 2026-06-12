import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = [
  '/auth/login',
  '/auth/invite',
  '/health',
  '/api/health',
];

const PROTECTED_PATHS = [
  '/dashboard',
  '/settings',
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check if path is public
  const isPublicPath = PUBLIC_PATHS.some((path) => pathname.startsWith(path)) ||
    pathname === '/' ||
    pathname.match(/^\/auth\/invite\/[\w-]+$/);

  if (isPublicPath) {
    return NextResponse.next();
  }

  // For protected paths, verify session
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    {
      cookies: {
        getAll() {
          return Object.entries(request.cookies.getAll()).map(([name, cookie]) => ({
            name,
            value: (cookie as any).value,
          }));
        },
        setAll(cookiesToSet: Array<{ name: string; value: string }>) {
          cookiesToSet.forEach(({ name, value }: { name: string; value: string }) => {
            request.cookies.set(name, value);
          });
        },
      },
    }
  );

  const { data: { session } } = await supabase.auth.getSession();

  // If no session and trying to access protected path, redirect to login
  if (!session && PROTECTED_PATHS.some((path) => pathname.startsWith(path))) {
    const loginUrl = new URL('/auth/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // If authenticated and trying to access login, redirect to dashboard
  if (session && pathname === '/auth/login') {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
