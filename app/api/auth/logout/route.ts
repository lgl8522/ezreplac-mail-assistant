import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/access-control';

export async function POST(request: Request) {
  return NextResponse.json(
    { ok: true },
    {
      headers: {
        'Cache-Control': 'no-store',
        'Set-Cookie': clearSessionCookie(request),
      },
    },
  );
}
