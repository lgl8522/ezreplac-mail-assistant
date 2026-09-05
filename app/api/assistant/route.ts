import { NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { getRuntimeSettings } from '@/lib/runtime-settings';

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    translation: { type: 'string' },
    logisticsSummary: { type: 'string' },
    localized: { type: 'string' },
    drafts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          chinese: { type: 'string' },
          localized: { type: 'string' },
        },
        required: ['id', 'label', 'chinese', 'localized'],
      },
    },
  },
  required: ['translation', 'logisticsSummary', 'localized', 'drafts'],
};

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

function hasHighRiskBuyerMessage(result: unknown) {
  if (!result || typeof result !== 'object') return false;
  const drafts = (result as { drafts?: unknown }).drafts;
  if (!Array.isArray(drafts)) return false;
  const buyerMessages = drafts
    .map((draft) =>
      draft && typeof draft === 'object'
        ? (draft as { localized?: unknown }).localized
        : '',
    )
    .filter((value): value is string => typeof value === 'string')
    .join('\n');

  return [
    /\b(review|feedback|rating|coupon|discount|promotion|gift\s*card)\b/i,
    /评价|评论|好评|差评|优惠券|促销|折扣|礼品卡/,
    /https?:\/\/|\bwww\./i,
    /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/,
    /\b(whatsapp|wechat)\b|微信/i,
  ].some((pattern) => pattern.test(buyerMessages));
}

export async function POST(request: Request) {
  const secret = await readApiKey();
  const openaiApiKey = secret.apiKey;
  if (!openaiApiKey) {
    // Safe deployment diagnostic: never log a secret value, length, headers,
    // or buyer content. This only distinguishes a missing binding from an
    // empty value or process.env compatibility issue.
    console.warn({
      event: 'openai_secret_unavailable',
      workerBindingPresent: secret.bindingPresent ?? false,
      workerBindingIsSecretStore: secret.bindingIsSecretStore ?? false,
      processSecretPresent: Object.hasOwn(process.env, 'OPENAI_API_KEY'),
    });
    return NextResponse.json(
      {
        error:
          '尚未配置 OPENAI_API_KEY。请在 Cloudflare Worker Secret 中设置后再使用。',
      },
      { status: 503 },
    );
  }

  const payload = (await request.json()) as Record<string, unknown>;
  const instructions = `你是个人亚马逊卖家的邮件助手。工作目标：准确翻译买家邮件，并根据店铺模板、物流信息和卖家已经选择的处理方式生成可直接复制的客服邮件。

强制规则：
1. 自动识别买家邮件语言；所有回复必须同时给出买家原语言版本及中文审核版。
2. 不杜撰订单、物流、退款、补发或时效；若信息不足，用谨慎语言并提示卖家确认。
3. 仅在卖家选择“补发”或“退款”时承诺对应动作。未选择时只给建议，不承诺赔付。
4. 已签收未收到：建议检查门口、院内、邮件箱、安全位置、邻居/物业或当地承运商；不要直接判定丢失。
5. 禁止以退款、补发、折扣或任何补偿换取、要求或暗示删除/修改评价；也不要生成规避平台规则的话术。
6. 固定英文落款为 EZReplac。严格执行当前店铺的正常品牌语气规则。
7. 买家邮件只能处理订单或售后问题：不得包含营销、促销、优惠券、索要评价/反馈、要求修改或删除评价、站外链接、邮箱、电话、社交媒体账号、表情符号或无关的致谢。不要转述物流原文中的联系方式。
8. 返回严格 JSON，不要 markdown。你必须返回下列 JSON Schema 中所有 required 字段，不能新增字段；无内容时使用空字符串或空数组：${JSON.stringify(
    schema,
  )}`;

  const modeGuide: Record<string, string> = {
    translate:
      '只需翻译邮件为中文，并简短说明买家核心诉求。drafts 必须为空数组，localized 为空字符串。',
    logistics:
      '只分析粘贴的物流轨迹。logisticsSummary 用简洁中文写明：可确认的最新状态、关键时间信息、建议卖家选择的处理方式及原因。信息不足时明确说明。不要生成给买家的邮件；translation、localized 为空字符串，drafts 必须为空数组。',
    drafts:
      '先翻译邮件，提取/归纳物流状态，再给出恰好 3 个语气或措辞略有不同、但事实与承诺一致的回复版本。每个版本必须含中文与买家语言。',
    sync: '用户已在中文审核版中修改内容。将其忠实翻译为买家原邮件语言，localized 返回翻译结果；drafts 必须为空数组。',
  };

  const mode = String(payload.mode);
  const inputContext: Record<string, unknown> = {
    currentTask: modeGuide[mode] ?? modeGuide.drafts,
  };
  if (mode === 'logistics') {
    inputContext.pastedLogistics = payload.logistics ?? '';
  } else if (mode === 'drafts') {
    inputContext.sellerChosenAction = payload.action;
    inputContext.shopTemplate = payload.shop;
    inputContext.buyerEmail = payload.mail ?? '';
    // Reuse the compact automatic judgement. The full tracking trail is sent
    // only when a judgement has not yet completed.
    inputContext.logisticsAnalysis =
      payload.logisticsSummary || payload.logistics || '';
  } else if (mode === 'sync') {
    inputContext.buyerEmail = payload.mail ?? '';
    inputContext.editedChinese = payload.chinese ?? '';
  } else {
    inputContext.buyerEmail = payload.mail ?? '';
  }
  const input = JSON.stringify(inputContext);

  const runtimeSettings = await getRuntimeSettings();
  const response = await fetch(runtimeSettings.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: runtimeSettings.model,
      store: false,
      reasoning: { effort: 'low' },
      instructions,
      input,
      text: {
        format: {
          type: 'json_schema',
          name: 'mail_assistant_result',
          strict: true,
          schema,
        },
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    return NextResponse.json(
      { error: `OpenAI 请求失败：${error.slice(0, 300)}` },
      { status: 502 },
    );
  }
  const result = (await response.json()) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
  };
  const text =
    result.output_text ??
    result.output
      ?.flatMap((item) => item.content ?? [])
      .map((item) => item.text ?? '')
      .join('');
  try {
    const parsed = JSON.parse(text ?? '{}');
    if (mode === 'drafts' && hasHighRiskBuyerMessage(parsed)) {
      return NextResponse.json(
        {
          error:
            '生成内容包含 Amazon 买家沟通高风险内容，已停止展示。请调整处理要求后重试。',
        },
        { status: 422 },
      );
    }
    return NextResponse.json(parsed);
  } catch {
    return NextResponse.json(
      { error: '模型返回格式异常，请重试。' },
      { status: 502 },
    );
  }
}
