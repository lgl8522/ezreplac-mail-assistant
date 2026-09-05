'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Check,
  Clipboard,
  FileText,
  Globe2,
  Languages,
  LoaderCircle,
  MapPinned,
  PencilLine,
  Plus,
  RotateCcw,
  Send,
  Settings2,
  Truck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';

type Action = 'wait' | 'resend' | 'refund' | 'none';
type Shop = {
  id: string;
  name: string;
  tone: string;
  length: string;
  greeting: string;
  rules: string;
};
type Draft = { id: string; label: string; chinese: string; localized: string };
type ApiSettings = { endpoint: string; model: string };

const defaultShop: Shop = {
  id: 'ezreplac',
  name: 'EZReplac · 默认店铺',
  tone: '亲和、诚恳、专业',
  length: '简洁，3–5 个短段落',
  greeting: '使用 Dear + 买家姓名；姓名未知时使用 Dear Customer',
  rules:
    '先表达理解，再给出清晰下一步。不得以补偿交换评价或要求移除评价。固定落款：EZReplac。',
};
const defaultApiSettings: ApiSettings = {
  endpoint: 'https://api.sudorelay.com/v1/responses',
  model: 'gpt-5.6-luna',
};
const apiSettingsStorageKey = 'ezreplac-api-settings';

function getBrowserApiSettings(): ApiSettings | null {
  try {
    const saved = JSON.parse(
      window.localStorage.getItem(apiSettingsStorageKey) ?? 'null',
    ) as Partial<ApiSettings> | null;
    if (
      saved &&
      typeof saved.endpoint === 'string' &&
      typeof saved.model === 'string' &&
      saved.endpoint &&
      saved.model
    )
      return { endpoint: saved.endpoint, model: saved.model };
  } catch {
    /* Ignore an old or malformed browser cache. */
  }
  return null;
}

function saveBrowserApiSettings(settings: ApiSettings) {
  try {
    window.localStorage.setItem(
      apiSettingsStorageKey,
      JSON.stringify(settings),
    );
  } catch {
    /* Cloud persistence can still succeed when browser storage is unavailable. */
  }
}

const actions: Record<
  Action,
  { title: string; detail: string; color: string }
> = {
  none: {
    title: '仅生成建议',
    detail: '不承诺补偿，由你决定后续动作。',
    color: 'border-slate-200 bg-slate-50 text-slate-700',
  },
  wait: {
    title: '请客户检查 / 等待',
    detail: '解释物流状态，并说明下一步检查或等待。',
    color: 'border-amber-200 bg-amber-50 text-amber-800',
  },
  resend: {
    title: '补发',
    detail: '确认补发意愿；需要时请求核对地址。',
    color: 'border-sky-200 bg-sky-50 text-sky-800',
  },
  refund: {
    title: '退款',
    detail: '说明退款处理与原付款方式到账时间。',
    color: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  },
};
const sampleMail =
  'Hello, I still have not received my parcel. The tracking says it was delivered yesterday, but it is not at my door. Could you please help?';
const sampleLogistics =
  '单号：YT2621521293056971\n包裹状态：成功签收 (14 天)\n国家：中国 -> 美国\nYunExpress:\n2026-08-17 12:56 North Chesterfield, VA, Delivered, Door/Yard.\n2026-08-17 07:14 Richmond, VA, Out for Delivery';

export default function Home() {
  const [shops, setShops] = useState<Shop[]>([defaultShop]);
  const [shopId, setShopId] = useState(defaultShop.id);
  const [mail, setMail] = useState('');
  const [translation, setTranslation] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [logistics, setLogistics] = useState('');
  const [logisticsSummary, setLogisticsSummary] = useState('');
  const [action, setAction] = useState<Action>('none');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [activeDraft, setActiveDraft] = useState<string | null>(null);
  const [editedChinese, setEditedChinese] = useState('');
  const [busy, setBusy] = useState<
    'translate' | 'drafts' | 'sync' | 'track' | null
  >(null);
  const [notice, setNotice] = useState('');
  const [newShop, setNewShop] = useState<Shop>({
    ...defaultShop,
    id: '',
    name: '',
  });
  const [apiSettings, setApiSettings] =
    useState<ApiSettings>(defaultApiSettings);
  const shop = useMemo(
    () => shops.find((item) => item.id === shopId) ?? shops[0],
    [shops, shopId],
  );
  const selected = drafts.find((item) => item.id === activeDraft);

  useEffect(() => {
    void loadConfiguration();
  }, []);
  async function loadConfiguration() {
    const browserSettings = getBrowserApiSettings();
    try {
      const [shopsResponse, settingsResponse] = await Promise.all([
        fetch('/api/shops'),
        fetch('/api/settings'),
      ]);
      const savedShops = (await shopsResponse.json()) as Shop[];
      const savedSettings = (await settingsResponse.json()) as ApiSettings;
      if (shopsResponse.ok && savedShops.length) {
        setShops(savedShops);
        setShopId(savedShops[0].id);
      }
      if (settingsResponse.ok && savedSettings.endpoint && savedSettings.model)
        setApiSettings(savedSettings);
    } catch {
      /* defaults remain usable before KV is bound */
    }
    // Browser cache keeps the current workstation usable even before the KV
    // binding is configured. It contains no API Key.
    if (browserSettings) setApiSettings(browserSettings);
  }
  async function loadShops() {
    try {
      const r = await fetch('/api/shops');
      const saved = (await r.json()) as Shop[];
      if (r.ok && saved.length) {
        setShops(saved);
        setShopId(saved[0].id);
      }
    } catch {
      /* default profile remains usable before KV is bound */
    }
  }
  async function saveShops(next: Shop[]) {
    setShops(next);
    try {
      const r = await fetch('/api/shops', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!r.ok) throw new Error();
    } catch {
      setNotice('店铺配置尚未写入云端。部署时请配置 Cloudflare KV 绑定。');
    }
  }
  async function saveApiSettings() {
    saveBrowserApiSettings(apiSettings);
    try {
      const r = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(apiSettings),
      });
      const result = (await r.json()) as {
        error?: string;
        settings?: ApiSettings;
      };
      if (!r.ok) throw new Error(result.error ?? '保存失败。');
      if (result.settings) {
        setApiSettings(result.settings);
        saveBrowserApiSettings(result.settings);
      }
      setNotice('接口地址和模型已保存到浏览器及云端。');
    } catch (e) {
      const detail = e instanceof Error ? `（${e.message}）` : '';
      setNotice(
        `接口地址和模型已保存到当前浏览器；云端保存未成功，发送请求仍会使用云端原配置${detail}`,
      );
    }
  }
  async function ask(
    mode: 'translate' | 'drafts' | 'sync',
    extra: Record<string, unknown> = {},
  ) {
    const r = await fetch('/api/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, shop, mail, logistics, action, ...extra }),
    });
    const result = (await r.json()) as {
      error?: string;
      translation?: string;
      logisticsSummary?: string;
      localized?: string;
      drafts?: Draft[];
    };
    if (!r.ok) throw new Error(result.error ?? '请求失败，请稍后重试。');
    return result;
  }
  async function translate() {
    if (!mail.trim()) return setNotice('先粘贴买家邮件。');
    setBusy('translate');
    setNotice('');
    try {
      const r = await ask('translate');
      setTranslation(r.translation ?? '未能识别翻译结果。');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '翻译失败。');
    } finally {
      setBusy(null);
    }
  }
  async function generate() {
    if (!mail.trim()) return setNotice('先粘贴买家邮件。');
    setBusy('drafts');
    setNotice('');
    try {
      const r = await ask('drafts');
      setTranslation(r.translation ?? translation);
      setLogisticsSummary(r.logisticsSummary ?? logisticsSummary);
      setDrafts(r.drafts ?? []);
      setActiveDraft(r.drafts?.[0]?.id ?? null);
      setEditedChinese(r.drafts?.[0]?.chinese ?? '');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '生成失败。');
    } finally {
      setBusy(null);
    }
  }
  async function syncChinese() {
    if (!selected || !editedChinese.trim()) return;
    setBusy('sync');
    try {
      const r = await ask('sync', {
        chinese: editedChinese,
        language: 'same-as-buyer',
      });
      setDrafts(
        drafts.map((d) =>
          d.id === selected.id
            ? {
                ...d,
                chinese: editedChinese,
                localized: r.localized ?? d.localized,
              }
            : d,
        ),
      );
      setNotice('已按买家原邮件语言同步翻译。');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '同步翻译失败。');
    } finally {
      setBusy(null);
    }
  }
  async function track() {
    if (!trackingNumber.trim()) return setNotice('输入物流单号后再查询。');
    setBusy('track');
    setNotice('');
    try {
      const r = await fetch(
        `/api/track?number=${encodeURIComponent(trackingNumber.trim())}`,
      );
      const result = (await r.json()) as {
        summary?: string;
        raw?: string;
        fallbackUrl?: string;
        message?: string;
      };
      if (result.summary) setLogisticsSummary(result.summary);
      if (result.raw) setLogistics(result.raw);
      if (result.message) setNotice(result.message);
      if (result.fallbackUrl)
        window.open(result.fallbackUrl, '_blank', 'noopener,noreferrer');
    } catch {
      setNotice('自动查询暂不可用。请粘贴 17TRACK 物流结果继续处理。');
    } finally {
      setBusy(null);
    }
  }
  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    setNotice('已复制到剪贴板。');
  }
  function addShop() {
    if (!newShop.name.trim()) return;
    const item = {
      ...newShop,
      id: crypto.randomUUID(),
      name: newShop.name.trim(),
    };
    const next = [...shops, item];
    void saveShops(next);
    setShopId(item.id);
    setNewShop({ ...defaultShop, id: '', name: '' });
  }

  return (
    <main className="min-h-screen bg-[#f5f5f7] text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1580px] items-center gap-3 px-5 py-3.5 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-[13px] bg-slate-950 text-white shadow-sm">
              <Send className="size-5" />
            </div>
            <div className="hidden sm:block">
              <p className="text-sm font-bold">EZReplac</p>
              <p className="text-xs text-slate-500">客服邮件工作台</p>
            </div>
          </div>
          <div className="hidden h-8 w-px bg-slate-200 sm:block" />
          <div className="min-w-0 sm:w-64">
            <NativeSelect
              aria-label="选择店铺"
              className="h-10 w-full border-0 bg-transparent px-2 font-semibold shadow-none focus:ring-0"
              value={shopId}
              onChange={(e) => setShopId(e.target.value)}
            >
              {shops.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <Dialog>
              <DialogTrigger
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label="管理店铺模板"
                  />
                }
              >
                店铺管理
              </DialogTrigger>
              <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto p-6">
                <DialogHeader>
                  <DialogTitle>店铺管理</DialogTitle>
                  <DialogDescription>
                    为每个店铺保存独立的称呼、语气与客服规则。
                  </DialogDescription>
                </DialogHeader>
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    新增店铺模板
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    每个店铺可保存独立的语气、称呼和回复规则。
                  </p>
                </div>
                <div className="grid gap-4 py-2 sm:grid-cols-2">
                  <Field label="店铺名称">
                    <Input
                      value={newShop.name}
                      onChange={(e) =>
                        setNewShop({ ...newShop, name: e.target.value })
                      }
                      placeholder="例如：North America Store"
                    />
                  </Field>
                  <Field label="回复语气">
                    <Input
                      value={newShop.tone}
                      onChange={(e) =>
                        setNewShop({ ...newShop, tone: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="回复长度">
                    <Input
                      value={newShop.length}
                      onChange={(e) =>
                        setNewShop({ ...newShop, length: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="称呼规则">
                    <Input
                      value={newShop.greeting}
                      onChange={(e) =>
                        setNewShop({ ...newShop, greeting: e.target.value })
                      }
                    />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="额外回复要求">
                      <Textarea
                        value={newShop.rules}
                        onChange={(e) =>
                          setNewShop({ ...newShop, rules: e.target.value })
                        }
                        className="min-h-28"
                      />
                    </Field>
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={addShop}>
                    <Plus />
                    保存店铺模板
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Dialog>
              <DialogTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="高级模型设置"
                    className="text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                  />
                }
              >
                <Settings2 />
              </DialogTrigger>
              <DialogContent className="max-w-lg p-6">
                <DialogHeader>
                  <DialogTitle>高级模型配置</DialogTitle>
                  <DialogDescription>
                    仅在更换模型服务或模型名称时修改。API Key 始终保存在
                    Cloudflare Worker Secret。
                  </DialogDescription>
                </DialogHeader>
                <div className="mt-2 grid gap-4">
                  <Field label="Responses API 地址">
                    <Input
                      value={apiSettings.endpoint}
                      onChange={(e) =>
                        setApiSettings({
                          ...apiSettings,
                          endpoint: e.target.value,
                        })
                      }
                      placeholder="https://api.example.com/v1（自动补 /responses）"
                    />
                  </Field>
                  <Field label="模型名称">
                    <Input
                      value={apiSettings.model}
                      onChange={(e) =>
                        setApiSettings({
                          ...apiSettings,
                          model: e.target.value,
                        })
                      }
                      placeholder="gpt-5.6-luna"
                    />
                  </Field>
                </div>
                <DialogFooter>
                  <Button onClick={saveApiSettings}>保存高级设置</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1580px] gap-5 px-5 py-6 lg:grid-cols-[minmax(620px,1fr)_minmax(470px,.74fr)] lg:px-8 lg:py-7">
        <section className="space-y-5">
          <Panel
            icon={<FileText />}
            eyebrow="01 · 买家邮件"
            title="粘贴邮件，先看中文含义"
          >
            <Textarea
              value={mail}
              onChange={(e) => setMail(e.target.value)}
              placeholder="将 Amazon 买家邮件粘贴到这里…"
              className="min-h-52 resize-y bg-white"
            />
            <div className="mt-3 flex gap-2">
              <Button onClick={translate} disabled={busy !== null}>
                <Languages />
                {busy === 'translate' ? '正在翻译…' : '翻译成中文'}
              </Button>
              <Button variant="ghost" onClick={() => setMail(sampleMail)}>
                填入示例
              </Button>
            </div>
            {translation && (
              <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
                <p className="mb-2 text-sm font-semibold text-indigo-950">
                  <Languages className="mr-1 inline size-4" />
                  中文翻译
                </p>
                <p className="whitespace-pre-wrap text-sm leading-6 text-indigo-950/80">
                  {translation}
                </p>
              </div>
            )}
          </Panel>
          <Panel
            icon={<Truck />}
            eyebrow="02 · 物流情况"
            title="自动查询或粘贴查询结果"
          >
            <div className="flex gap-2">
              <Input
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                placeholder="输入物流单号，例如 YT262…"
              />
              <Button
                onClick={track}
                disabled={busy !== null}
                variant="outline"
              >
                <MapPinned />
                {busy === 'track' ? '查询中' : '查询'}
              </Button>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              自动查询通过 17TRACK
              直达页完成；页面限制自动读取时，使用下方粘贴区继续。
            </p>
            <Textarea
              value={logistics}
              onChange={(e) => setLogistics(e.target.value)}
              placeholder="粘贴 17TRACK 的物流轨迹、状态和单号…"
              className="mt-3 min-h-36 resize-y bg-white"
            />
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => setLogistics(sampleLogistics)}
            >
              填入物流示例
            </Button>
            {logisticsSummary && (
              <div className="mt-3 rounded-xl border border-cyan-100 bg-cyan-50 p-4">
                <p className="text-sm font-semibold text-cyan-950">物流判断</p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-cyan-950/80">
                  {logisticsSummary}
                </p>
              </div>
            )}
          </Panel>
        </section>
        <section className="space-y-5 lg:sticky lg:top-[84px] lg:self-start">
          <Panel
            icon={<Check />}
            eyebrow="03 · 处理决定"
            title="先由你选择，再生成回复"
          >
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {(Object.keys(actions) as Action[]).map((key) => (
                <button
                  type="button"
                  key={key}
                  onClick={() => setAction(key)}
                  className={`rounded-xl border p-3 text-left transition ${action === key ? `${actions[key].color} ring-2 ring-slate-900/15 ring-offset-1` : 'border-slate-200 bg-white hover:border-slate-300'}`}
                >
                  <span className="flex items-center justify-between text-sm font-semibold">
                    {actions[key].title}
                    {action === key && <Check className="size-4" />}
                  </span>
                  <span className="mt-1 block text-xs leading-5 opacity-75">
                    {actions[key].detail}
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-blue-100 bg-blue-50/80 px-4 py-3.5">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  将生成 3 个可选版本
                </p>
                <p className="text-xs text-slate-500">
                  买家原语言 + 中文审核版 · {actions[action].title}
                </p>
              </div>
              <Button onClick={generate} disabled={busy !== null}>
                {busy === 'drafts' ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Bot />
                )}
                {busy === 'drafts' ? '正在生成…' : '生成回复'}
              </Button>
            </div>
          </Panel>
          <Panel
            icon={<PencilLine />}
            eyebrow="04 · 选择并微调"
            title="改中文，自动同步买家语言"
          >
            {drafts.length === 0 ? (
              <EmptyDraft />
            ) : (
              <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
                <div className="space-y-2">
                  {drafts.map((draft, index) => (
                    <button
                      type="button"
                      key={draft.id}
                      onClick={() => {
                        setActiveDraft(draft.id);
                        setEditedChinese(draft.chinese);
                      }}
                      className={`w-full rounded-xl border p-3 text-left ${activeDraft === draft.id ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                    >
                      <span className="text-xs opacity-70">
                        版本 {index + 1}
                      </span>
                      <span className="mt-1 block text-sm font-semibold">
                        {draft.label}
                      </span>
                      <span className="mt-1 line-clamp-2 block text-xs opacity-75">
                        {draft.chinese}
                      </span>
                    </button>
                  ))}
                </div>
                <div>
                  {selected && (
                    <>
                      <div className="mb-2 flex items-center justify-between">
                        <label className="text-sm font-semibold">
                          中文审核与编辑
                        </label>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditedChinese(selected.chinese)}
                        >
                          恢复版本
                        </Button>
                      </div>
                      <Textarea
                        value={editedChinese}
                        onChange={(e) => setEditedChinese(e.target.value)}
                        className="min-h-52 resize-y bg-white"
                      />
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button onClick={syncChinese} disabled={busy !== null}>
                          <RotateCcw />
                          {busy === 'sync' ? '同步中…' : '按买家语言重新翻译'}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => copy(editedChinese)}
                        >
                          <Clipboard />
                          复制中文
                        </Button>
                      </div>
                      <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-sm font-semibold">
                            <Globe2 className="mr-1 inline size-4" />
                            买家语言版本
                          </p>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copy(selected.localized)}
                          >
                            <Clipboard />
                            复制
                          </Button>
                        </div>
                        <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
                          {selected.localized}
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </Panel>
          {notice && (
            <p
              role="status"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600"
            >
              {notice}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-slate-700">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Panel({
  icon,
  eyebrow,
  title,
  children,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[20px] border border-slate-200/90 bg-white/90 p-5 shadow-[0_8px_26px_rgba(15,23,42,.045)] backdrop-blur-sm">
      <div className="mb-4 flex items-start gap-3">
        <div className="grid size-9 place-items-center rounded-xl bg-slate-100 text-slate-700">
          {icon}
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.12em] text-slate-400">
            {eyebrow}
          </p>
          <h1 className="mt-0.5 text-lg font-bold">{title}</h1>
        </div>
      </div>
      {children}
    </section>
  );
}
function EmptyDraft() {
  return (
    <div className="grid min-h-72 place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
      <div>
        <div className="mx-auto grid size-11 place-items-center rounded-xl bg-white text-slate-400">
          <PencilLine />
        </div>
        <p className="mt-3 text-sm font-semibold text-slate-600">
          还没有回复版本
        </p>
        <p className="mt-1 text-sm text-slate-500">
          选择处理方式后，生成 3 个双语回复供你挑选。
        </p>
      </div>
    </div>
  );
}
