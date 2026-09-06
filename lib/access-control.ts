import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';

const COOKIE_NAME = 'ezreplace_session';
const SESSION_SECONDS = 24 * 60 * 60;
const encoder = new TextEncoder();

function accessCode() {
  const value = (env as Record<string, unknown>).APP_ACCESS_CODE;
  return typeof value === 'string' && /^\d{4}$/.test(value) ? value : '';
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function signature(expires: string, code: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(code),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const result = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`ezreplace:${expires}`),
  );
  return bytesToBase64Url(new Uint8Array(result));
}

async function secureEqual(left: string, right: string) {
  const [leftHash, rightHash] = await Promise.all(
    [left, right].map((value) =>
      crypto.subtle.digest('SHA-256', encoder.encode(value)),
    ),
  );
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < a.length; index++)
    difference |= a[index] ^ b[index];
  return difference === 0;
}

function cookieValue(request: Request) {
  const cookies = request.headers.get('Cookie') ?? '';
  for (const item of cookies.split(';')) {
    const [name, ...value] = item.trim().split('=');
    if (name === COOKIE_NAME) return value.join('=');
  }
  return '';
}

export function isAccessConfigured() {
  return Boolean(accessCode());
}

export async function verifyAccessCode(value: string) {
  const expected = accessCode();
  return (
    Boolean(expected) && /^\d{4}$/.test(value) && secureEqual(value, expected)
  );
}

export async function isAuthorized(request: Request) {
  const code = accessCode();
  if (!code) return false;
  const [expires = '', provided = ''] = cookieValue(request).split('.');
  if (!/^\d{10,13}$/.test(expires) || Number(expires) <= Date.now())
    return false;
  const expected = await signature(expires, code);
  return secureEqual(provided, expected);
}

export async function createSessionCookie(request: Request) {
  const code = accessCode();
  if (!code) throw Error('APP_ACCESS_CODE is not configured.');
  const expires = String(Date.now() + SESSION_SECONDS * 1000);
  const token = `${expires}.${await signature(expires, code)}`;
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly${secure}; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
}

export function clearSessionCookie(request: Request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE_NAME}=; Path=/; HttpOnly${secure}; SameSite=Strict; Max-Age=0`;
}

export async function requireAccess(request: Request) {
  if (await isAuthorized(request)) return null;
  return NextResponse.json(
    { error: '登录状态已失效，请重新输入校验码。' },
    { status: 401, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function accessIdentifier(request: Request) {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(ip));
  return bytesToBase64Url(new Uint8Array(digest));
}
