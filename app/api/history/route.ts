import { NextResponse } from 'next/server';
import {
  getHistoryStore,
  HISTORY_RETENTION_MS,
  removeExpiredHistory,
} from '@/lib/history-store';
import type {
  MailHistoryRecord,
  MailHistorySummary,
  NewMailHistoryRecord,
} from '@/lib/mail-history';
import { requireAccess } from '@/lib/access-control';

const noStore = { 'Cache-Control': 'no-store' };
const fields: Array<[keyof NewMailHistoryRecord, number]> = [
  ['id', 80],
  ['shopId', 120],
  ['shopName', 200],
  ['buyerMail', 12000],
  ['buyerTranslation', 12000],
  ['trackingNumber', 50],
  ['logisticsStatus', 300],
  ['logisticsSummary', 4000],
  ['logisticsRecommendation', 4000],
  ['customInstruction', 4000],
  ['action', 30],
  ['chineseReply', 12000],
  ['localizedReply', 12000],
  ['targetLanguage', 30],
  ['buyerLanguage', 30],
];

const recordColumns = `
  id,
  created_at AS createdAt,
  shop_id AS shopId,
  shop_name AS shopName,
  buyer_mail AS buyerMail,
  buyer_translation AS buyerTranslation,
  tracking_number AS trackingNumber,
  logistics_status AS logisticsStatus,
  logistics_summary AS logisticsSummary,
  logistics_recommendation AS logisticsRecommendation,
  custom_instruction AS customInstruction,
  action,
  chinese_reply AS chineseReply,
  localized_reply AS localizedReply,
  target_language AS targetLanguage,
  buyer_language AS buyerLanguage`;

const legacyRecordColumns = `
  id,
  created_at AS createdAt,
  shop_id AS shopId,
  shop_name AS shopName,
  buyer_mail AS buyerMail,
  buyer_translation AS buyerTranslation,
  tracking_number AS trackingNumber,
  logistics_status AS logisticsStatus,
  logistics_summary AS logisticsSummary,
  logistics_recommendation AS logisticsRecommendation,
  custom_instruction AS customInstruction,
  action,
  chinese_reply AS chineseReply,
  localized_reply AS localizedReply,
  target_language AS targetLanguage,
  '' AS buyerLanguage`;

const summaryColumns = `
  id,
  created_at AS createdAt,
  shop_id AS shopId,
  shop_name AS shopName,
  tracking_number AS trackingNumber,
  action,
  target_language AS targetLanguage,
  substr(
    CASE
      WHEN trim(buyer_translation) <> '' THEN buyer_translation
      WHEN trim(buyer_mail) <> '' THEN buyer_mail
      WHEN trim(custom_instruction) <> '' THEN custom_instruction
      ELSE chinese_reply
    END,
    1,
    240
  ) AS preview`;

function unavailable() {
  return NextResponse.json(
    { error: '缺少 HISTORY_DB Cloudflare D1 绑定。' },
    { status: 503, headers: noStore },
  );
}

function isPendingBuyerLanguageMigration(error: unknown) {
  return /(?:no such column|has no column named).*buyer_language/i.test(
    String(error),
  );
}

async function readRecord(
  database: D1Database,
  id: string,
  retentionStart: number,
) {
  try {
    return await database
      .prepare(
        `SELECT ${recordColumns}
        FROM mail_history
        WHERE id = ? AND created_at >= ?
        LIMIT 1`,
      )
      .bind(id, retentionStart)
      .first<MailHistoryRecord>();
  } catch (error) {
    if (!isPendingBuyerLanguageMigration(error)) throw error;
    return database
      .prepare(
        `SELECT ${legacyRecordColumns}
        FROM mail_history
        WHERE id = ? AND created_at >= ?
        LIMIT 1`,
      )
      .bind(id, retentionStart)
      .first<MailHistoryRecord>();
  }
}

function readInput(value: unknown): NewMailHistoryRecord | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const [name, maxLength] of fields) {
    const field = source[name];
    if (typeof field !== 'string' || field.length > maxLength) return null;
    result[name] = field;
  }
  if (
    !/^[A-Za-z0-9_-]{8,80}$/.test(result.id) ||
    !result.shopId.trim() ||
    !result.shopName.trim() ||
    !result.chineseReply.trim() ||
    !result.localizedReply.trim() ||
    !result.targetLanguage.trim()
  )
    return null;
  return result as NewMailHistoryRecord;
}

export async function GET(request: Request) {
  const unauthorized = await requireAccess(request);
  if (unauthorized) return unauthorized;
  const database = getHistoryStore();
  if (!database) return unavailable();
  try {
    await removeExpiredHistory(database);
    const searchParams = new URL(request.url).searchParams;
    const id = searchParams.get('id') ?? '';
    if (id) {
      if (!/^[A-Za-z0-9_-]{8,80}$/.test(id))
        return NextResponse.json(
          { error: '历史记录 ID 无效。' },
          { status: 400, headers: noStore },
        );
      const record = await readRecord(
        database,
        id,
        Date.now() - HISTORY_RETENTION_MS,
      );
      if (!record)
        return NextResponse.json(
          { error: '历史记录不存在或已过期。' },
          { status: 404, headers: noStore },
        );
      return NextResponse.json({ record }, { headers: noStore });
    }

    const page = Math.min(
      100,
      Math.max(0, Number.parseInt(searchParams.get('page') ?? '0', 10) || 0),
    );
    const limit = 40;
    const clauses = ['created_at >= ?'];
    const bindings: Array<string | number> = [
      Date.now() - HISTORY_RETENTION_MS,
    ];
    const shopId = (searchParams.get('shopId') ?? '').slice(0, 120);
    if (shopId && shopId !== 'all') {
      clauses.push('shop_id = ?');
      bindings.push(shopId);
    }
    const from = Number(searchParams.get('from'));
    if (Number.isFinite(from) && from > 0) {
      clauses.push('created_at >= ?');
      bindings.push(from);
    }
    const to = Number(searchParams.get('to'));
    if (Number.isFinite(to) && to > 0) {
      clauses.push('created_at < ?');
      bindings.push(to);
    }
    const query = (searchParams.get('query') ?? '').trim().slice(0, 120);
    if (query) {
      clauses.push(`instr(lower(
        shop_name || ' ' || buyer_mail || ' ' || buyer_translation || ' ' ||
        tracking_number || ' ' || logistics_summary || ' ' ||
        custom_instruction || ' ' || chinese_reply || ' ' || localized_reply
      ), lower(?)) > 0`);
      bindings.push(query);
    }
    const result = await database
      .prepare(
        `SELECT ${summaryColumns}
        FROM mail_history
        WHERE ${clauses.join(' AND ')}
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?`,
      )
      .bind(...bindings, limit + 1, page * limit)
      .all<MailHistorySummary>();
    const records = result.results ?? [];
    return NextResponse.json(
      { records: records.slice(0, limit), hasMore: records.length > limit },
      { headers: noStore },
    );
  } catch (error) {
    console.error('History read failed', error);
    return NextResponse.json(
      { error: '历史记录读取失败，请确认已执行 D1 数据库迁移。' },
      { status: 500, headers: noStore },
    );
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireAccess(request);
  if (unauthorized) return unauthorized;
  const database = getHistoryStore();
  if (!database) return unavailable();
  const record = readInput(await request.json().catch(() => null));
  if (!record)
    return NextResponse.json(
      { error: '历史记录格式无效。' },
      { status: 400, headers: noStore },
    );
  const createdAt = Date.now();
  try {
    await removeExpiredHistory(database);
    const commonValues = [
      record.id,
      createdAt,
      record.shopId,
      record.shopName,
      record.buyerMail,
      record.buyerTranslation,
      record.trackingNumber,
      record.logisticsStatus,
      record.logisticsSummary,
      record.logisticsRecommendation,
      record.customInstruction,
      record.action,
      record.chineseReply,
      record.localizedReply,
      record.targetLanguage,
    ];
    try {
      await database
        .prepare(
          `INSERT INTO mail_history (
            id, created_at, shop_id, shop_name, buyer_mail, buyer_translation,
            tracking_number, logistics_status, logistics_summary,
            logistics_recommendation, custom_instruction, action, chinese_reply,
            localized_reply, target_language, buyer_language
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO NOTHING`,
        )
        .bind(...commonValues, record.buyerLanguage)
        .run();
    } catch (error) {
      if (!isPendingBuyerLanguageMigration(error)) throw error;
      await database
        .prepare(
          `INSERT INTO mail_history (
            id, created_at, shop_id, shop_name, buyer_mail, buyer_translation,
            tracking_number, logistics_status, logistics_summary,
            logistics_recommendation, custom_instruction, action, chinese_reply,
            localized_reply, target_language
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO NOTHING`,
        )
        .bind(...commonValues)
        .run();
    }
    return NextResponse.json(
      { ok: true, record: { ...record, createdAt } },
      { status: 201, headers: noStore },
    );
  } catch (error) {
    console.error('History save failed', error);
    return NextResponse.json(
      { error: '历史记录保存失败，请确认已执行 D1 数据库迁移。' },
      { status: 500, headers: noStore },
    );
  }
}

export async function DELETE(request: Request) {
  const unauthorized = await requireAccess(request);
  if (unauthorized) return unauthorized;
  const database = getHistoryStore();
  if (!database) return unavailable();
  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(id))
    return NextResponse.json(
      { error: '历史记录 ID 无效。' },
      { status: 400, headers: noStore },
    );
  try {
    await removeExpiredHistory(database);
    await database
      .prepare('DELETE FROM mail_history WHERE id = ?')
      .bind(id)
      .run();
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (error) {
    console.error('History delete failed', error);
    return NextResponse.json(
      { error: '历史记录删除失败。' },
      { status: 500, headers: noStore },
    );
  }
}
