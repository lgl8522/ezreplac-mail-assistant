import { env } from 'cloudflare:workers';

export type KVStore = {
  get(key: string, type?: 'json'): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
};

export type RuntimeSettings = {
  endpoint: string;
  model: string;
};

export const defaultRuntimeSettings: RuntimeSettings = {
  endpoint: 'https://api.sudorelay.com/v1/responses',
  model: 'gpt-5.6-luna',
};

export function getSettingsStore() {
  return (env as Record<string, unknown>).SHOP_TEMPLATES as KVStore | undefined;
}

export async function getRuntimeSettings(): Promise<RuntimeSettings> {
  const store = getSettingsStore();
  if (!store) return defaultRuntimeSettings;

  const saved = (await store.get(
    'runtime-settings',
    'json',
  )) as Partial<RuntimeSettings> | null;
  if (
    !saved ||
    typeof saved.endpoint !== 'string' ||
    typeof saved.model !== 'string'
  )
    return defaultRuntimeSettings;
  return { endpoint: saved.endpoint, model: saved.model };
}

export function validateRuntimeSettings(
  value: unknown,
): RuntimeSettings | null {
  if (!value || typeof value !== 'object') return null;
  const { endpoint, model } = value as Partial<RuntimeSettings>;
  if (typeof endpoint !== 'string' || typeof model !== 'string') return null;

  const normalizedEndpoint = endpoint.trim();
  const normalizedModel = model.trim();
  if (
    !normalizedEndpoint ||
    normalizedEndpoint.length > 500 ||
    !normalizedModel ||
    normalizedModel.length > 120
  )
    return null;

  try {
    const url = new URL(normalizedEndpoint);
    if (url.protocol !== 'https:' || !url.hostname) return null;
  } catch {
    return null;
  }

  return { endpoint: normalizedEndpoint, model: normalizedModel };
}
