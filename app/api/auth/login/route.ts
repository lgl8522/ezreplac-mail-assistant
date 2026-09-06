import { NextResponse } from 'next/server';
import {
  accessIdentifier,
  createSessionCookie,
  isAccessConfigured,
  verifyAccessCode,
} from '@/lib/access-control';
import { getHistoryStore } from '@/lib/history-store';

const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;
const noStore = { 'Cache-Control': 'no-store' };

type Attempt = {
  failed_count: number;
  locked_until: number;
  updated_at: number;
};

export async function POST(request: Request) {
  if (!isAccessConfigured())
    return NextResponse.json(
      { error: '尚未配置 APP_ACCESS_CODE Worker 密钥。' },
      { status: 503, headers: noStore },
    );
  const database = getHistoryStore();
  if (!database)
    return NextResponse.json(
      { error: '登录限速所需的 HISTORY_DB 尚未绑定。' },
      { status: 503, headers: noStore },
    );
  const body = (await request.json().catch(() => null)) as {
    code?: unknown;
  } | null;
  const code = typeof body?.code === 'string' ? body.code : '';
  if (!/^\d{4}$/.test(code))
    return NextResponse.json(
      { error: '请输入 4 位数字校验码。' },
      { status: 400, headers: noStore },
    );

  const identifier = await accessIdentifier(request);
  const now = Date.now();
  try {
    await database
      .prepare('DELETE FROM login_attempts WHERE updated_at < ?')
      .bind(now - 60 * 24 * 60 * 60 * 1000)
      .run();
    const attempt = await database
      .prepare(
        'SELECT failed_count, locked_until, updated_at FROM login_attempts WHERE identifier = ?',
      )
      .bind(identifier)
      .first<Attempt>();
    if (attempt && attempt.locked_until > now) {
      const retryAfter = Math.ceil((attempt.locked_until - now) / 1000);
      return NextResponse.json(
        {
          error: `尝试次数过多，请 ${Math.ceil(retryAfter / 60)} 分钟后再试。`,
        },
        {
          status: 429,
          headers: { ...noStore, 'Retry-After': String(retryAfter) },
        },
      );
    }

    if (!(await verifyAccessCode(code))) {
      const priorFailures =
        attempt &&
        attempt.locked_until === 0 &&
        now - attempt.updated_at < LOCK_MS
          ? attempt.failed_count
          : 0;
      const failures = priorFailures + 1;
      const lockedUntil = failures >= MAX_FAILURES ? now + LOCK_MS : 0;
      await database
        .prepare(
          `INSERT INTO login_attempts
            (identifier, failed_count, locked_until, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(identifier) DO UPDATE SET
            failed_count = excluded.failed_count,
            locked_until = excluded.locked_until,
            updated_at = excluded.updated_at`,
        )
        .bind(identifier, failures, lockedUntil, now)
        .run();
      if (lockedUntil)
        return NextResponse.json(
          { error: '已连续输错 5 次，请 15 分钟后再试。' },
          { status: 429, headers: { ...noStore, 'Retry-After': '900' } },
        );
      return NextResponse.json(
        { error: `校验码错误，还可尝试 ${MAX_FAILURES - failures} 次。` },
        { status: 401, headers: noStore },
      );
    }

    await database
      .prepare('DELETE FROM login_attempts WHERE identifier = ?')
      .bind(identifier)
      .run();
    return NextResponse.json(
      { ok: true },
      {
        headers: {
          ...noStore,
          'Set-Cookie': await createSessionCookie(request),
        },
      },
    );
  } catch (error) {
    console.error('Login failed', error);
    return NextResponse.json(
      { error: '登录校验失败，请确认已执行最新 D1 数据库迁移。' },
      { status: 500, headers: noStore },
    );
  }
}
