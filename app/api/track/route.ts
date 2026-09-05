import { NextResponse } from 'next/server';

function cleanHtml(value: string) {
  return value.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function GET(request: Request) {
  const number = new URL(request.url).searchParams.get('number')?.trim();
  if (!number || !/^[A-Za-z0-9-]{5,50}$/.test(number)) return NextResponse.json({ message: '请输入有效物流单号。' }, { status: 400 });
  const fallbackUrl = `https://t.17track.net/zh-cn?nums=${encodeURIComponent(number)}`;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.BROWSER_RUN_API_TOKEN;
  if (!accountId || !token) return NextResponse.json({ fallbackUrl, message: '自动浏览器尚未配置。已打开 17TRACK 直达查询页；请复制物流结果后粘贴回本工具。' });

  try {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/content`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: fallbackUrl }),
    });
    const result = await response.json() as { result?: string; success?: boolean };
    const raw = cleanHtml(result.result ?? '');
    if (!response.ok || raw.length < 80) return NextResponse.json({ fallbackUrl, message: '17TRACK 页面未返回可读取的物流内容。请手动粘贴查询结果。' });
    return NextResponse.json({ fallbackUrl, raw: raw.slice(0, 12000), summary: '已读取 17TRACK 页面内容。请检查下方物流原文后生成回复。' });
  } catch {
    return NextResponse.json({ fallbackUrl, message: '自动浏览器查询失败。请手动粘贴 17TRACK 查询结果。' });
  }
}
