import { NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';

function cleanHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?\s*>|<\/(?:div|p|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export async function GET(request: Request) {
  const number = new URL(request.url).searchParams.get('number')?.trim();
  const respond = (body: object, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'no-store' },
    });
  if (!number || !/^[A-Za-z0-9-]{5,50}$/.test(number))
    return respond({ message: '请输入有效物流单号。' }, 400);
  const fallbackUrl = `https://t.17track.net/zh-cn?nums=${encodeURIComponent(number)}`;
  const workerEnv = env as Record<string, string | undefined>;
  const accountId =
    workerEnv.CLOUDFLARE_ACCOUNT_ID ?? process.env.CLOUDFLARE_ACCOUNT_ID;
  const token =
    workerEnv.BROWSER_RUN_API_TOKEN ?? process.env.BROWSER_RUN_API_TOKEN;
  if (!accountId || !token)
    return respond({
      fallbackUrl,
      message: '请打开 17TRACK，复制并粘贴查询结果。',
    });
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/content`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: fallbackUrl }),
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(25000)]),
      },
    );
    const result = (await response.json()) as {
      result?: string;
      success?: boolean;
    };
    const raw = cleanHtml(
      typeof result.result === 'string' ? result.result : '',
    );
    if (!response.ok || !/\d{4}-\d{2}-\d{2}/.test(raw) || !raw.includes(number))
      return respond({
        fallbackUrl,
        message: '未读到有效物流，请手动粘贴查询结果。',
      });
    if (raw.length > 24000)
      return respond({
        fallbackUrl,
        message: '页面内容过长，请只复制物流轨迹。',
      });
    return respond({ fallbackUrl, raw });
  } catch {
    return respond({
      fallbackUrl,
      message: '查询超时或失败，请手动粘贴物流。',
    });
  }
}
