import { NextResponse } from 'next/server';
import { isAccessConfigured, isAuthorized } from '@/lib/access-control';

export async function GET(request: Request) {
  return NextResponse.json(
    {
      configured: isAccessConfigured(),
      authenticated: await isAuthorized(request),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
