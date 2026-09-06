import { NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { getRuntimeSettings } from '@/lib/runtime-settings';
import { requireAccess } from '@/lib/access-control';
import { MODEL_FORMAT_ERROR, withFormatRetry } from '@/lib/format-retry';
import {
  buildLocalizationTask,
  buildTask,
  checkAndNormalize,
  checkAndNormalizeLocalization,
} from '@/lib/assistant-task';
type SecretStoreBinding = { get(): Promise<unknown> };

function isSecretStoreBinding(value: unknown): value is SecretStoreBinding {
  return (
    typeof value === 'object' &&
    value !== null &&
    'get' in value &&
    typeof value.get === 'function'
  );
}

async function readApiKey() {
  const workerEnv = env as Record<string, unknown>;
  const workerBinding = workerEnv.OPENAI_API_KEY;
  const processSecret =
    typeof process.env.OPENAI_API_KEY === 'string'
      ? process.env.OPENAI_API_KEY
      : undefined;
  const workerSecret =
    typeof workerBinding === 'string' ? workerBinding : undefined;

  if (processSecret)
    return { apiKey: processSecret, source: 'process' as const };
  if (workerSecret)
    return { apiKey: workerSecret, source: 'worker-secret' as const };
  if (isSecretStoreBinding(workerBinding)) {
    const stored = await workerBinding.get();
    if (typeof stored === 'string' && stored)
      return { apiKey: stored, source: 'secrets-store' as const };
  }
  return {
    apiKey: undefined,
    source: 'missing' as const,
    bindingPresent: Object.hasOwn(workerEnv, 'OPENAI_API_KEY'),
    bindingIsSecretStore: isSecretStoreBinding(workerBinding),
  };
}

type ProviderResult = {
  status?: string;
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};

function parseJsonOutput(value: string) {
  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const objectStart = trimmed.indexOf('{');
  const objectEnd = trimmed.lastIndexOf('}');
  const arrayStart = trimmed.indexOf('[');
  const arrayEnd = trimmed.lastIndexOf(']');
  const candidates = [
    trimmed,
    fenced,
    objectStart >= 0 && objectEnd > objectStart
      ? trimmed.slice(objectStart, objectEnd + 1)
      : '',
    arrayStart >= 0 && arrayEnd > arrayStart
      ? trimmed.slice(arrayStart, arrayEnd + 1)
      : '',
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next compatible response shape.
    }
  }
  throw new Error(MODEL_FORMAT_ERROR);
}

async function readProviderJson(response: Response) {
  if (!response.ok)
    throw new Error(`模型请求失败（HTTP ${response.status}）。`);
  let result: ProviderResult;
  try {
    result = (await response.json()) as ProviderResult;
  } catch {
    throw new Error(MODEL_FORMAT_ERROR);
  }
  if (result.status === 'incomplete' || result.status === 'failed')
    throw new Error('模型未完成回复，请重试。');
  const output =
    result.output_text ||
    result.output
      ?.filter((item) => item.type === 'message')
      .flatMap((item) => item.content ?? [])
      .filter((item) => item.type === 'output_text')
      .map((item) => item.text ?? '')
      .join('') ||
    result.choices
      ?.map((choice) => choice.message?.content)
      .flatMap((content) =>
        typeof content === 'string'
          ? [content]
          : (content ?? []).map((item) => item.text ?? ''),
      )
      .join('');
  if (!output?.trim()) throw new Error('模型返回为空，请核对模型名称。');
  return parseJsonOutput(output);
}

type ModelTask =
  | ReturnType<typeof buildTask>
  | ReturnType<typeof buildLocalizationTask>;
type RuntimeSettings = Awaited<ReturnType<typeof getRuntimeSettings>>;

async function requestProvider(
  task: ModelTask,
  settings: RuntimeSettings,
  apiKey: string,
  signal: AbortSignal,
) {
  const body = {
    model: settings.model,
    store: false,
    ...(/^qwen3\.8-/i.test(settings.model)
      ? { reasoning: { effort: 'none' } }
      : /^gpt-/i.test(settings.model)
        ? { reasoning: { effort: 'low' } }
        : {}),
    instructions: task.instructions,
    input: task.input,
    text: {
      format: {
        type: 'json_schema',
        name: 'mail_' + task.mode,
        strict: true,
        schema: task.schema,
      },
    },
  };
  const response = await fetch(settings.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(90000)]),
  });
  if (!response.ok)
    throw new Error(
      `模型请求失败（HTTP ${response.status}）。${response.status === 401 ? '请核对模型服务对应的密钥。' : response.status === 404 ? '请核对接口地址及模型名称。' : response.status === 429 ? '请求过多或额度不足，请稍后重试。' : '请检查模型配置或稍后重试。'}`,
    );
  return readProviderJson(response);
}

export async function POST(request: Request) {
  const unauthorized = await requireAccess(request);
  if (unauthorized) return unauthorized;
  try {
    let payload: Record<string, unknown>;
    try {
      const raw = await request.text();
      if (raw.length > 64000)
        return NextResponse.json(
          { error: '内容过长，请精简后重试。' },
          { status: 413 },
        );
      payload = JSON.parse(raw);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        throw new Error();
    } catch {
      return NextResponse.json({ error: '请求格式无效。' }, { status: 400 });
    }
    let task;
    try {
      task = buildTask(payload);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : '请求无效。' },
        { status: 400 },
      );
    }
    const [secret, settings] = await Promise.all([
      readApiKey(),
      getRuntimeSettings(),
    ]);
    if (!secret.apiKey)
      return NextResponse.json(
        {
          error:
            '尚未配置 OPENAI_API_KEY。请在 Cloudflare Worker Secret 中设置。',
        },
        { status: 503 },
      );
    const sourceMail =
      typeof payload.mail === 'string'
        ? payload.mail.replace(/\r\n/g, '\n')
        : '';
    const normalized = await withFormatRetry(async () => {
      const parsed = await requestProvider(
        task,
        settings,
        secret.apiKey,
        request.signal,
      );
      const result = checkAndNormalize(task.mode, parsed, sourceMail);
      if (
        task.mode === 'drafts' &&
        !payload.hasTranslation &&
        payload.mail &&
        !result.translation
      )
        throw new Error('模型未返回邮件翻译，请重试。');
      return result;
    });
    if (task.mode === 'drafts' && normalized.drafts) {
      const chineseDrafts = normalized.drafts.map((draft) => draft.chinese);
      const localizationTask = buildLocalizationTask(
        chineseDrafts,
        normalized.language ?? 'en',
      );
      const localizedDrafts = await withFormatRetry(async () => {
        const localization = await requestProvider(
          localizationTask,
          settings,
          secret.apiKey,
          request.signal,
        );
        return checkAndNormalizeLocalization(localization, chineseDrafts);
      });
      normalized.drafts = chineseDrafts.map((chinese, index) => ({
        chinese,
        localized: localizedDrafts[index],
      }));
    }
    return NextResponse.json(normalized, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '模型请求失败。';
    const interrupted =
      error instanceof Error &&
      ['TimeoutError', 'AbortError'].includes(error.name);
    return NextResponse.json(
      {
        error: interrupted
          ? '请求超时或已取消，请重试。'
          : message === 'fetch failed'
            ? '暂时无法连接模型服务，请稍后重试。'
            : message,
      },
      { status: 502 },
    );
  }
}
