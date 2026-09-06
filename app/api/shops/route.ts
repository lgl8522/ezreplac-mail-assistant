import { NextResponse } from 'next/server';
import { getSettingsStore } from '@/lib/runtime-settings';
import { defaultShop as shopDefaults } from '@/lib/assistant-task';

const defaultShop = [shopDefaults];

export async function GET() {
  const store = getSettingsStore();
  if (!store) return NextResponse.json(defaultShop);
  const saved = await store.get('shops', 'json');
  return NextResponse.json(
    Array.isArray(saved) && saved.length ? saved : defaultShop,
  );
}

export async function PUT(request: Request) {
  const store = getSettingsStore();
  if (!store)
    return NextResponse.json(
      { error: '缺少 SHOP_TEMPLATES Cloudflare KV 绑定。' },
      { status: 503 },
    );
  const shops = await request.json();
  if (!Array.isArray(shops) || shops.length > 50)
    return NextResponse.json({ error: '店铺模板格式无效。' }, { status: 400 });
  await store.put('shops', JSON.stringify(shops));
  return NextResponse.json({ ok: true });
}
