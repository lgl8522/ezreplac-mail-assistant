import { NextResponse } from 'next/server';

type KV = { get(key: string, type?: 'json'): Promise<unknown>; put(key: string, value: string): Promise<void> };
const defaultShop = [{ id: 'ezreplac', name: 'EZReplac · 默认店铺', tone: '亲和、诚恳、专业', length: '简洁，3–5 个短段落', greeting: '使用 Dear + 买家姓名；姓名未知时使用 Dear Customer', rules: '先表达理解，再给出清晰下一步。不得以补偿交换评价或要求移除评价。固定落款：EZReplac。' }];

function kv() { return (globalThis as typeof globalThis & { SHOP_TEMPLATES?: KV }).SHOP_TEMPLATES; }

export async function GET() {
  const store = kv();
  if (!store) return NextResponse.json(defaultShop);
  const saved = await store.get('shops', 'json');
  return NextResponse.json(Array.isArray(saved) && saved.length ? saved : defaultShop);
}

export async function PUT(request: Request) {
  const store = kv();
  if (!store) return NextResponse.json({ error: '缺少 SHOP_TEMPLATES Cloudflare KV 绑定。' }, { status: 503 });
  const shops = await request.json();
  if (!Array.isArray(shops) || shops.length > 50) return NextResponse.json({ error: '店铺模板格式无效。' }, { status: 400 });
  await store.put('shops', JSON.stringify(shops));
  return NextResponse.json({ ok: true });
}
