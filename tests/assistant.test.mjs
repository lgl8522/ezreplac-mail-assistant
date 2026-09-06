import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLocalizationTask,
  buildTask,
  checkAndNormalize,
  checkAndNormalizeLocalization,
  compactTracking,
} from '../lib/assistant-task.ts';
import { RequestSession } from '../lib/request-session.ts';

test('translation excludes store, logistics and reply scaffolding', () => {
  const t = buildTask({
    mode: 'translate',
    mail: 'Hello',
    logistics: 'secret tracking',
    shop: { rules: 'unused' },
  });
  assert.deepEqual(JSON.parse(t.input), { mail: 'Hello' });
  assert.deepEqual(t.schema.required, ['translation', 'language']);
  assert.equal(t.schema.properties.translation.type, 'array');
  assert.ok(t.instructions.length < 500);
});
test('mail translation preserves plaintext lines, blanks and indentation', () => {
  const mail = 'Subject: Hello\r\n\r\n  - Order YT123456  ';
  const task = buildTask({ mode: 'translate', mail });
  assert.equal(task.schema.properties.translation.minItems, 3);
  assert.equal(task.schema.properties.translation.maxItems, 3);
  const result = checkAndNormalize(
    'translate',
    {
      translation: ['主题：你好', '这一行必须被丢弃', '- 订单 YT123456'],
      language: 'en',
    },
    mail,
  );
  assert.equal(result.translation, '主题：你好\n\n  - 订单 YT123456  ');
  assert.throws(
    () =>
      checkAndNormalize(
        'translate',
        { translation: ['主题：你好'], language: 'en' },
        mail,
      ),
    /未保持原文换行/,
  );
});
test('custom-only replies and button combination retain custom priority', () => {
  const t = buildTask({
    mode: 'drafts',
    mail: '',
    customInstruction: '用日文回复，安排退款',
    action: 'wait',
  });
  const p = JSON.parse(t.input);
  assert.equal(p.custom, '用日文回复，安排退款');
  assert.equal(p.action, 'wait');
  assert.match(t.instructions, /自定义要求优先/);
  assert.ok(!t.schema.required.includes('translation'));
});
test('cached translation and analysis remove duplicated work', () => {
  const t = buildTask({
    mode: 'drafts',
    mail: 'hello',
    hasTranslation: true,
    logistics: 'FULL-RAW',
    logisticsSummary: 'DELIVERED',
  });
  assert.ok(!t.schema.required.includes('translation'));
  assert.equal(JSON.parse(t.input).logistics, 'DELIVERED');
  assert.ok(!t.input.includes('FULL-RAW'));
});
test('sync sends only edited Chinese and known target language', () => {
  const t = buildTask({
    mode: 'sync',
    chinese: '您好',
    language: 'ja',
    mail: 'long original email',
    shop: { rules: 'unused' },
    logistics: 'unused',
  });
  assert.deepEqual(JSON.parse(t.input), { chinese: '您好', language: 'ja' });
});
test('tracking compaction preserves newest, oldest and explicit omissions in either order', () => {
  const lines = Array.from(
    { length: 25 },
    (_, i) => `2026-08-${String(i + 1).padStart(2, '0')} 12:00 Event ${i}`,
  );
  for (const events of [lines, [...lines].reverse()]) {
    const result = compactTracking(['单号：YT123456', ...events].join('\n'));
    assert.match(result, /YT123456/);
    assert.match(result, /2026-08-25/);
    assert.match(result, /2026-08-01/);
    assert.match(result, /省略14条/);
    assert.ok(result.length < events.join('\n').length);
  }
});
test('unknown or oversized inputs fail before calling the model', () => {
  assert.throws(() => buildTask({ mode: 'bad' }));
  assert.throws(() =>
    buildTask({ mode: 'translate', mail: 'x'.repeat(12001) }),
  );
  assert.throws(() => buildTask({ mode: 'drafts' }));
});
test('incomplete or empty provider responses are rejected', () => {
  assert.throws(() => checkAndNormalize('drafts', {}));
  assert.throws(() =>
    checkAndNormalize('drafts', {
      language: 'en',
      drafts: [{ chinese: '好', localized: 'Hi' }],
    }),
  );
  assert.throws(() =>
    checkAndNormalize('sync', { language: 'ja', localized: '' }),
  );
});
test('draft creation and localization are separate strict steps', () => {
  const sync = buildTask({
    mode: 'sync',
    chinese: 'Dear Customer,\n您的包裹已寄出。\nBest regards,\nEZReplace',
    language: 'ja',
  });
  assert.match(sync.instructions, /称呼、正文、结束语都要翻译/);
  assert.match(sync.instructions, /不照抄Dear Customer/);
  assert.match(sync.instructions, /固定署名EZReplace/);
  const drafts = buildTask({
    mode: 'drafts',
    mail: 'Dear Customer,\n荷物が届いていません。',
    customInstruction: '回复买家',
    language: 'ja',
  });
  assert.match(drafts.instructions, /按邮件正文判断目标语言/);
  assert.match(drafts.instructions, /只写完整中文/);
  assert.deepEqual(drafts.schema.properties.drafts.items.required, ['chinese']);

  const chineseDrafts = [
    '您好，退款金额为10美元。\nEZReplace',
    '您好，包裹单号YT123456仍在运输。\nEZReplace',
    '您好，请等待3天。\nEZReplace',
  ];
  const generated = checkAndNormalize('drafts', {
    language: 'ja',
    drafts: chineseDrafts.map((chinese) => ({ chinese })),
  });
  assert.deepEqual(
    generated.drafts.map((draft) => draft.localized),
    ['', '', ''],
  );
  const localization = buildLocalizationTask(chineseDrafts, 'ja');
  assert.deepEqual(JSON.parse(localization.input), {
    language: 'ja',
    drafts: chineseDrafts,
  });
  assert.match(
    localization.instructions,
    /不重新创作、不润色、不概括、不增删信息/,
  );
  const localized = checkAndNormalizeLocalization(
    {
      localized: [
        'こんにちは、返金額は10ドルです。\nEZReplace',
        'こんにちは、荷物番号YT123456はまだ輸送中です。\nEZReplace',
        'こんにちは、3日間お待ちください。\nEZReplace',
      ],
    },
    chineseDrafts,
  );
  assert.equal(localized.length, 3);
  assert.deepEqual(
    checkAndNormalizeLocalization(
      { localized: ['こんにちは', 'こんにちは', 'こんにちは'] },
      chineseDrafts,
    ),
    ['こんにちは', 'こんにちは', 'こんにちは'],
  );
});
test('risk controls apply to sync too without banning normal order review language', () => {
  assert.throws(
    () =>
      buildTask({ mode: 'sync', chinese: '请删除差评评论', language: 'en' }),
    /高风险/,
  );
  assert.throws(
    () =>
      checkAndNormalize('sync', {
        language: 'en',
        localized: 'Please remove your review.',
      }),
    /高风险/,
  );
  assert.doesNotThrow(() =>
    checkAndNormalize('sync', {
      language: 'en',
      localized: 'We will review your order details.',
    }),
  );
});
test('draft cache avoids a second call after its translation has been displayed', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json({ translation: '你好', language: 'en', drafts: [] });
  });
  const session = new RequestSession();
  await session.request(
    'drafts',
    { mail: 'hello', hasTranslation: false },
    'm',
  );
  await session.request('drafts', { mail: 'hello', hasTranslation: true }, 'm');
  assert.equal(calls, 1);
});
test('session deduplicates in-flight calls and caches exact results', async (t) => {
  let calls = 0;
  let resolve;
  t.mock.method(globalThis, 'fetch', () => {
    calls++;
    return new Promise((r) => {
      resolve = r;
    });
  });
  const session = new RequestSession();
  const a = session.request('translate', { mail: 'hello' }, 'model-a');
  const b = session.request('translate', { mail: 'hello' }, 'model-a');
  resolve(Response.json({ language: 'en', translation: '你好' }));
  assert.deepEqual(await a, await b);
  await session.request('translate', { mail: 'hello' }, 'model-a');
  assert.equal(calls, 1);
});
test('changing input aborts old request and cancelled results never enter cache', async (t) => {
  const calls = [];
  t.mock.method(
    globalThis,
    'fetch',
    (_url, init) => new Promise((resolve) => calls.push({ init, resolve })),
  );
  const session = new RequestSession();
  const old = session
    .request('translate', { mail: 'old' }, 'model')
    .catch((e) => e.name);
  const fresh = session.request('translate', { mail: 'new' }, 'model');
  assert.equal(calls[0].init.signal.aborted, true);
  calls[0].resolve(Response.json({ translation: 'old' }));
  calls[1].resolve(Response.json({ translation: 'new' }));
  assert.equal(await old, 'AbortError');
  assert.equal((await fresh).translation, 'new');
  const retry = session.request('translate', { mail: 'old' }, 'model');
  assert.equal(calls.length, 3);
  calls[2].resolve(Response.json({ translation: 'old' }));
  await retry;
});
test('cache isolates model changes and clears on next email', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json({ translation: 'ok' });
  });
  const session = new RequestSession();
  await session.request('translate', { mail: 'same' }, 'one');
  await session.request('translate', { mail: 'same' }, 'two');
  session.clear();
  await session.request('translate', { mail: 'same' }, 'two');
  assert.equal(calls, 3);
});
test('failed upstream responses are not cached', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json({ error: 'provider error' }, { status: 502 });
  });
  const session = new RequestSession();
  for (let i = 0; i < 2; i++)
    await assert.rejects(
      session.request('logistics', { logistics: 'x' }, 'm'),
      /provider error/,
    );
  assert.equal(calls, 2);
});
