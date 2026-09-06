import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const mailHistory = sqliteTable(
  'mail_history',
  {
    id: text('id').primaryKey(),
    createdAt: integer('created_at').notNull(),
    shopId: text('shop_id').notNull(),
    shopName: text('shop_name').notNull(),
    buyerMail: text('buyer_mail').notNull().default(''),
    buyerTranslation: text('buyer_translation').notNull().default(''),
    trackingNumber: text('tracking_number').notNull().default(''),
    logisticsStatus: text('logistics_status').notNull().default(''),
    logisticsSummary: text('logistics_summary').notNull().default(''),
    logisticsRecommendation: text('logistics_recommendation')
      .notNull()
      .default(''),
    customInstruction: text('custom_instruction').notNull().default(''),
    action: text('action').notNull().default('none'),
    chineseReply: text('chinese_reply').notNull(),
    localizedReply: text('localized_reply').notNull(),
    targetLanguage: text('target_language').notNull(),
    buyerLanguage: text('buyer_language').notNull().default(''),
  },
  (table) => [
    index('mail_history_created_at_idx').on(table.createdAt),
    index('mail_history_shop_created_at_idx').on(table.shopId, table.createdAt),
  ],
);

export const loginAttempts = sqliteTable('login_attempts', {
  identifier: text('identifier').primaryKey(),
  failedCount: integer('failed_count').notNull().default(0),
  lockedUntil: integer('locked_until').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
});
