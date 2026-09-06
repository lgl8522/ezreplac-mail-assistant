import { env } from 'cloudflare:workers';

export const HISTORY_RETENTION_MS = 60 * 24 * 60 * 60 * 1000;

export function getHistoryStore() {
  return (env as Record<string, unknown>).HISTORY_DB as D1Database | undefined;
}

export async function removeExpiredHistory(database: D1Database) {
  await database
    .prepare('DELETE FROM mail_history WHERE created_at < ?')
    .bind(Date.now() - HISTORY_RETENTION_MS)
    .run();
}
