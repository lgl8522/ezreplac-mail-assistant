import { NextResponse } from 'next/server';
import {
  defaultRuntimeSettings,
  getRuntimeSettings,
  getSettingsStore,
  validateRuntimeSettings,
} from '@/lib/runtime-settings';
import { requireAccess } from '@/lib/access-control';

export async function GET(request: Request) {
  const unauthorized = await requireAccess(request);
  if (unauthorized) return unauthorized;
  return NextResponse.json(await getRuntimeSettings(), {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function PUT(request: Request) {
  const unauthorized = await requireAccess(request);
  if (unauthorized) return unauthorized;
  const store = getSettingsStore();
  if (!store)
    return NextResponse.json(
      { error: '缺少 SHOP_TEMPLATES Cloudflare KV 绑定。' },
      { status: 503 },
    );

  const settings = validateRuntimeSettings(await request.json());
  if (!settings) {
    return NextResponse.json(
      { error: '请填写有效的 HTTPS Responses API 地址和模型名称。' },
      { status: 400 },
    );
  }

  await store.put('runtime-settings', JSON.stringify(settings));
  return NextResponse.json({
    ok: true,
    settings: settings ?? defaultRuntimeSettings,
  });
}
