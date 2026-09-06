'use client';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  Mail,
  Truck,
  Clock,
  Package,
  Undo2,
  CircleCheck,
  Copy,
  ArrowRight,
  Settings2,
  ShieldCheck,
  RefreshCw,
  PencilLine,
  Plus,
  X,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  defaultShop,
  languageNames,
  type Shop,
  type Analysis,
  type Draft,
  type Mode,
} from '@/lib/assistant-task';
import { RequestSession } from '@/lib/request-session';
import './workspace.css';

type Settings = { endpoint: string; model: string };
type Translation = { mail: string; text: string; language: string };
const defaults: Settings = {
  endpoint: 'https://api.sudorelay.com/v1/responses',
  model: 'gpt-5.6-luna',
};
const actionOptions = [
  { id: 'wait', title: '检查 / 等待', detail: '继续核实', Icon: Clock },
  { id: 'refund', title: '退款', detail: '安排退款', Icon: Undo2 },
  { id: 'resend', title: '补发', detail: '安排补发', Icon: Package },
];
function message(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请重试。';
}
function cancelled(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

export default function Home() {
  const [shops, setShops] = useState<Shop[]>([defaultShop]);
  const [shopId, setShopId] = useState(defaultShop.id);
  const shop = shops.find((s) => s.id === shopId) ?? shops[0];
  const [mail, setMail] = useState('');
  const [translation, setTranslation] = useState<Translation | null>(null);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [logistics, setLogistics] = useState('');
  const [analysis, setAnalysis] = useState<{
    raw: string;
    result: Analysis;
  } | null>(null);
  const [analyzingRaw, setAnalyzingRaw] = useState('');
  const [analysisError, setAnalysisError] = useState<{
    raw: string;
    message: string;
  } | null>(null);
  const [trackBusy, setTrackBusy] = useState(false);
  const [action, setAction] = useState('none');
  const [custom, setCustom] = useState('');
  const [language, setLanguage] = useState('auto');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [version, setVersion] = useState(0);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [draftLanguage, setDraftLanguage] = useState('en');
  const [draftSource, setDraftSource] = useState('');
  const [busyTask, setBusyTask] = useState<{
    mode: Mode;
    source: string;
  } | null>(null);
  const [notice, setNotice] = useState('');
  const [settings, setSettings] = useState<Settings>(defaults);
  const [settingsForm, setSettingsForm] = useState<Settings>(defaults);
  const [configured, setConfigured] = useState(false);
  const [shopDialog, setShopDialog] = useState(false);
  const [modelDialog, setModelDialog] = useState(false);
  const [shopForm, setShopForm] = useState<Shop>(defaultShop);
  const [saving, setSaving] = useState(false);
  const [modalNotice, setModalNotice] = useState('');
  const [requests] = useState(() => new RequestSession());
  const trackAbort = useRef<AbortController | null>(null);
  const trackCache = useRef(new Map<string, { raw: string; at: number }>());
  const job = useRef(0);
  const source = JSON.stringify([
    mail,
    logistics,
    custom,
    action,
    language,
    shop,
    settings,
  ]);
  const latest = useRef({ source, logistics, mail, version, chinese: '' });
  const selected = drafts[version];
  const chinese = edits[version] ?? selected?.chinese ?? '';
  useLayoutEffect(() => {
    latest.current = { source, logistics, mail, version, chinese };
  }, [source, logistics, mail, version, chinese]);
  const busy = busyTask?.source === source ? busyTask.mode : null;
  function setBusy(mode: Mode | null) {
    setBusyTask(mode ? { mode, source } : null);
  }
  const logisticsBusy = !!logistics.trim() && analyzingRaw === logistics.trim();
  const logisticsError =
    analysisError?.raw === logistics.trim() ? analysisError.message : '';
  const currentTranslation = translation?.mail === mail ? translation : null;
  const currentAnalysis =
    analysis?.raw === logistics.trim() ? analysis.result : null;
  const dirty = !!selected && chinese !== selected.chinese;
  const stale = !!drafts.length && draftSource !== source;
  const modelKey = JSON.stringify(settings);
  const detected =
    currentTranslation?.language || (mail.match(/[\u3040-\u30ff]/) ? 'ja' : '');
  const target = language === 'auto' ? detected || 'auto' : language;

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      const results = await Promise.allSettled([
        fetch('/api/shops', {
          signal: controller.signal,
          cache: 'no-store',
        }).then(async (r) => {
          if (!r.ok) throw Error();
          return r.json() as Promise<Shop[]>;
        }),
        fetch('/api/settings', {
          signal: controller.signal,
          cache: 'no-store',
        }).then(async (r) => {
          if (!r.ok) throw Error();
          return r.json() as Promise<Settings>;
        }),
      ]);
      if (controller.signal.aborted) return;
      if (results[0].status === 'fulfilled' && results[0].value.length) {
        setShops(results[0].value);
        setShopId(results[0].value[0].id);
      }
      if (results[1].status === 'fulfilled') {
        setSettings(results[1].value);
        setSettingsForm(results[1].value);
        setConfigured(true);
      } else setNotice('模型配置读取失败，请重新保存设置后使用。');
    }
    void load();
    return () => {
      controller.abort();
      requests.clear();
      trackAbort.current?.abort();
    };
  }, [requests]);
  useEffect(() => {
    // Invalidate all reply work on context changes, independently of logistics.
    job.current++;
    requests.cancel('drafts');
    requests.cancel('sync');
  }, [source, requests]);
  useEffect(() => {
    requests.cancel('translate');
  }, [mail, requests]);
  useEffect(() => {
    trackAbort.current?.abort();
  }, [trackingNumber]);
  const analyze = useCallback(
    async (raw: string): Promise<Analysis | null> => {
      if (!raw) return null;
      if (!configured) throw Error('请先保存模型设置。');
      setAnalyzingRaw(raw);
      setAnalysisError(null);
      try {
        const r = await requests.request(
          'logistics',
          { logistics: raw },
          modelKey,
        );
        if (!r.analysis) throw Error('未返回物流判断，请重试。');
        if (latest.current.logistics.trim() === raw)
          setAnalysis({ raw, result: r.analysis });
        return r.analysis;
      } catch (e) {
        if (!cancelled(e) && latest.current.logistics.trim() === raw)
          setAnalysisError({ raw, message: message(e) });
        throw e;
      } finally {
        if (latest.current.logistics.trim() === raw) setAnalyzingRaw('');
      }
    },
    [configured, modelKey, requests],
  );
  useEffect(() => {
    const raw = logistics.trim();
    if (!raw || !configured) return;
    const timer = window.setTimeout(() => {
      void analyze(raw).catch(() => {});
    }, 1000);
    return () => {
      window.clearTimeout(timer);
      requests.cancel('logistics');
    };
  }, [logistics, configured, analyze, requests]);
  async function translate() {
    if (!mail.trim() || busy || !configured) return;
    const id = ++job.current;
    const snapshot = mail;
    setBusy('translate');
    setNotice('');
    try {
      const r = await requests.request('translate', { mail }, modelKey);
      if (id === job.current && latest.current.mail === snapshot)
        setTranslation({
          mail: snapshot,
          text: r.translation ?? '',
          language: r.language ?? '',
        });
    } catch (e) {
      if (!cancelled(e) && id === job.current) setNotice(message(e));
    } finally {
      if (id === job.current) setBusy(null);
    }
  }
  async function generate() {
    if (busy || !configured) return;
    if (!mail.trim() && !logistics.trim() && !custom.trim())
      return setNotice('请输入邮件、物流或自定义要求。');
    const id = ++job.current;
    const snapshot = source;
    setBusy('drafts');
    setNotice('');
    try {
      // Share the pending automatic analysis, including clicks during debounce.
      const judgement = await analyze(logistics.trim());
      if (id !== job.current || latest.current.source !== snapshot) return;
      const r = await requests.request(
        'drafts',
        {
          mail,
          customInstruction: custom,
          action,
          shop,
          language: target,
          hasTranslation: !!currentTranslation,
          logisticsSummary: judgement ? JSON.stringify(judgement) : '',
        },
        modelKey,
      );
      if (id !== job.current || latest.current.source !== snapshot) return;
      setDrafts(r.drafts ?? []);
      setVersion(0);
      setEdits({});
      setDraftLanguage(r.language ?? 'en');
      setDraftSource(snapshot);
      if (r.translation)
        setTranslation({
          mail,
          text: r.translation,
          language: detected,
        });
    } catch (e) {
      if (!cancelled(e) && id === job.current) setNotice(message(e));
    } finally {
      if (id === job.current) setBusy(null);
    }
  }
  async function sync() {
    if (!selected || !chinese.trim() || busy || !dirty || stale) return;
    const id = ++job.current;
    const original = chinese;
    const index = version;
    setBusy('sync');
    setNotice('');
    try {
      const r = await requests.request(
        'sync',
        { chinese: original, language: draftLanguage },
        modelKey,
      );
      if (
        id !== job.current ||
        latest.current.version !== index ||
        latest.current.chinese !== original
      )
        return;
      setDrafts((list) =>
        list.map((d, i) =>
          i === index
            ? { chinese: original, localized: r.localized ?? d.localized }
            : d,
        ),
      );
    } catch (e) {
      if (!cancelled(e) && id === job.current) setNotice(message(e));
    } finally {
      if (id === job.current) setBusy(null);
    }
  }
  async function track() {
    if (trackBusy) return;
    if (!/^[A-Za-z0-9-]{5,50}$/.test(trackingNumber.trim()))
      return setNotice('请输入有效物流单号。');
    const number = trackingNumber.trim();
    const cached = trackCache.current.get(number);
    if (cached && Date.now() - cached.at < 120000) {
      setLogistics(cached.raw);
      return;
    }
    const fallbackUrl = `https://t.17track.net/zh-cn?nums=${encodeURIComponent(number)}`;
    const fallbackTab = window.open('', 'ezreplac-17track');
    if (fallbackTab) {
      fallbackTab.document.title = '物流查询中';
      fallbackTab.document.body.textContent = '正在自动查询物流…';
      fallbackTab.opener = null;
    }
    const openFallback = (url = fallbackUrl) => {
      if (fallbackTab && !fallbackTab.closed) {
        fallbackTab.location.replace(url);
        return true;
      }
      return Boolean(window.open(url, '_blank', 'noopener,noreferrer'));
    };
    trackAbort.current?.abort();
    const controller = new AbortController();
    trackAbort.current = controller;
    setTrackBusy(true);
    setNotice('');
    try {
      const r = await fetch(
        '/api/track?number=' + encodeURIComponent(trackingNumber.trim()),
        { signal: controller.signal },
      );
      const result = (await r.json()) as {
        raw?: string;
        message?: string;
        fallbackUrl?: string;
      };
      if (controller.signal.aborted) {
        fallbackTab?.close();
        return;
      }
      if (result.raw) {
        fallbackTab?.close();
        trackCache.current.set(number, { raw: result.raw, at: Date.now() });
        while (trackCache.current.size > 12)
          trackCache.current.delete(trackCache.current.keys().next().value!);
        setLogistics(result.raw);
      } else {
        const opened = openFallback(result.fallbackUrl);
        setNotice(
          opened
            ? '自动读取失败，请在已打开的 17TRACK 页面复制物流结果后粘贴。'
            : (result.message ??
                '自动读取失败，浏览器拦截了查询页，请点击“打开 17TRACK”。'),
        );
      }
    } catch (e) {
      if (cancelled(e)) fallbackTab?.close();
      else {
        const opened = openFallback();
        setNotice(
          opened
            ? '查询失败，请在已打开的 17TRACK 页面复制物流结果后粘贴。'
            : '查询失败，浏览器拦截了查询页，请点击“打开 17TRACK”。',
        );
      }
    } finally {
      if (trackAbort.current === controller) setTrackBusy(false);
    }
  }
  function nextMail() {
    job.current++;
    requests.clear();
    trackAbort.current?.abort();
    trackCache.current.clear();
    setMail('');
    setTranslation(null);
    setTrackingNumber('');
    setLogistics('');
    setAnalysis(null);
    setAnalyzingRaw('');
    setAnalysisError(null);
    setTrackBusy(false);
    setCustom('');
    setAction('none');
    setLanguage('auto');
    setDrafts([]);
    setEdits({});
    setVersion(0);
    setDraftSource('');
    setBusy(null);
    setNotice('');
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice('已复制。');
    } catch {
      setNotice('复制失败，请手动选择文本复制。');
    }
  }
  async function saveSettings() {
    setSaving(true);
    setModalNotice('');
    try {
      const r = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsForm),
      });
      const result = (await r.json()) as {
        settings?: Settings;
        error?: string;
      };
      if (!r.ok || !result.settings) throw Error(result.error ?? '保存失败。');
      requests.clear();
      setSettings(result.settings);
      setSettingsForm(result.settings);
      setAnalysis(null);
      setConfigured(true);
      setModelDialog(false);
      setNotice('模型设置已保存。');
      try {
        localStorage.setItem(
          'ezreplac-api-settings',
          JSON.stringify(result.settings),
        );
      } catch {
        /* Server remains authoritative. */
      }
    } catch (e) {
      setModalNotice(message(e));
    } finally {
      setSaving(false);
    }
  }
  async function saveShop() {
    if (!shopForm.name.trim()) return setModalNotice('请输入店铺名称。');
    const item = {
      ...shopForm,
      id: shopForm.id || crypto.randomUUID(),
      name: shopForm.name.trim(),
    };
    const next = shops.some((s) => s.id === item.id)
      ? shops.map((s) => (s.id === item.id ? item : s))
      : [...shops, item];
    setSaving(true);
    setModalNotice('');
    try {
      const r = await fetch('/api/shops', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      const result = (await r.json()) as { error?: string };
      if (!r.ok) throw Error(result.error ?? '保存失败。');
      setShops(next);
      setShopId(item.id);
      setShopDialog(false);
      setNotice('店铺已保存。');
    } catch (e) {
      setModalNotice(message(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mail-workspace">
      <header>
        <div className="brand">
          <div className="mark">E</div>
          <div>
            <div className="brand-name">EZReplac</div>
            <div className="brand-sub">MAIL WORKSPACE</div>
          </div>
          <div className="sep" />
          <div className="store">
            <div className="store-avatar">
              {shop.name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <label htmlFor="store">当前处理店铺</label>
              <select
                id="store"
                value={shopId}
                onChange={(e) => setShopId(e.target.value)}
              >
                {shops.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <div className="header-actions">
          <button
            className="btn"
            onClick={() => {
              setShopForm({ ...shop });
              setModalNotice('');
              setShopDialog(true);
            }}
          >
            店铺管理
          </button>
          <button
            className="btn ghost icon-btn"
            aria-label="高级模型设置"
            title="高级模型设置"
            onClick={() => {
              setSettingsForm(settings);
              setModalNotice('');
              setModelDialog(true);
            }}
          >
            <Settings2 />
          </button>
        </div>
      </header>
      <main>
        <div className="page-heading">
          <h1>邮件工作台</h1>
          <button className="btn ghost" onClick={nextMail}>
            <RefreshCw />
            下一封
          </button>
        </div>
        <div className="workspace">
          <section className="col">
            <div className="col-title">
              <span className="number">01</span>邮件与物流<small>CONTEXT</small>
            </div>
            <article className="card">
              <div className="card-header">
                <h2>
                  <Mail />
                  买家邮件
                </h2>
                {detected && (
                  <span className="pill">
                    {languageNames[detected] ?? detected}
                  </span>
                )}
              </div>
              <div className="content">
                <textarea
                  className="field mail"
                  aria-label="买家邮件"
                  value={mail}
                  maxLength={12000}
                  onChange={(e) => setMail(e.target.value)}
                  placeholder="粘贴买家邮件"
                />
                <div className="inline-actions">
                  <span />
                  <button
                    className="text-btn"
                    onClick={translate}
                    disabled={!!busy || !mail.trim() || !configured}
                  >
                    {busy === 'translate' ? '翻译中…' : '翻译成中文'}
                    <ArrowRight />
                  </button>
                </div>
                <div className="translation">
                  <div className="mini-label">中文理解</div>
                  <p>{currentTranslation?.text || '—'}</p>
                </div>
              </div>
            </article>
            <article className="card">
              <div className="card-header">
                <h2>
                  <Truck />
                  物流信息
                </h2>
                <span className="pill">可选</span>
              </div>
              <div className="content">
                <div className="tracking-input">
                  <input
                    className="field"
                    aria-label="物流单号"
                    value={trackingNumber}
                    maxLength={50}
                    onChange={(e) => setTrackingNumber(e.target.value)}
                    placeholder="物流单号"
                  />
                  <button className="btn" onClick={track} disabled={trackBusy}>
                    {trackBusy ? '查询中…' : '查询物流'}
                  </button>
                </div>
                <textarea
                  className="field track-raw"
                  aria-label="物流轨迹"
                  value={logistics}
                  maxLength={24000}
                  onChange={(e) => setLogistics(e.target.value)}
                  placeholder="粘贴 17TRACK 查询结果"
                />
                <div className="under-field">
                  <a
                    className="text-btn muted"
                    href={
                      'https://t.17track.net/zh-cn?nums=' +
                      encodeURIComponent(trackingNumber.trim())
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    打开 17TRACK
                  </a>
                  <button
                    className="text-btn muted"
                    onClick={() => setLogistics('')}
                  >
                    清空
                  </button>
                </div>
                {logisticsBusy && <output className="caption">判断中…</output>}
                {logisticsError && (
                  <p className="caption" role="alert">
                    {logisticsError}{' '}
                    <button
                      className="text-btn"
                      onClick={() =>
                        void analyze(logistics.trim()).catch(() => {})
                      }
                    >
                      重试
                    </button>
                  </p>
                )}
                {currentAnalysis && (
                  <div className="analysis">
                    <div className="analysis-top">
                      <div className="analysis-title">
                        <CircleCheck />
                        {currentAnalysis.status}
                      </div>
                    </div>
                    <p>{currentAnalysis.summary}</p>
                    <div className="analysis-advice">
                      {currentAnalysis.recommendation}
                    </div>
                  </div>
                )}
              </div>
            </article>
          </section>
          <section className="col">
            <div className="col-title">
              <span className="number">02</span>回复要求<small>DIRECTION</small>
            </div>
            <article className="card compose">
              <div className="card-header">
                <h2>这封邮件怎么回复</h2>
                <span className="priority">自定义优先</span>
              </div>
              <div className="content">
                <textarea
                  className="field custom"
                  aria-label="自定义回复要求"
                  value={custom}
                  maxLength={4000}
                  onChange={(e) => setCustom(e.target.value)}
                  placeholder="填写处理要求，也可单独生成回复"
                />
                <div className="under-field">
                  <span>仅当前邮件</span>
                  <span>{custom.length} 字</span>
                </div>
                <div className="section-label">
                  处理方式<span>可不选</span>
                </div>
                <div className="decisions">
                  {actionOptions.map(({ id, title, detail, Icon }) => (
                    <button
                      className={'decision' + (action === id ? ' active' : '')}
                      key={id}
                      aria-pressed={action === id}
                      onClick={() => setAction(action === id ? 'none' : id)}
                    >
                      <Icon />
                      <b>{title}</b>
                      <small>{detail}</small>
                    </button>
                  ))}
                </div>
                <div className="language-row">
                  <span>回复语言</span>
                  <select
                    aria-label="回复语言"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                  >
                    <option value="auto">
                      {detected
                        ? '跟随买家 · ' + (languageNames[detected] ?? detected)
                        : mail
                          ? '跟随买家'
                          : '自动 · 默认英语'}
                    </option>
                    {Object.entries(languageNames).map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="context-list">
                  {mail.trim() && <span>买家邮件</span>}
                  {currentAnalysis && <span>物流判断</span>}
                  {custom.trim() && <span>自定义要求</span>}
                  <span>店铺模板</span>
                </div>
              </div>
              <div className="generate-footer">
                <button
                  className="btn primary"
                  onClick={generate}
                  disabled={!!busy || !configured}
                >
                  {busy === 'drafts' ? '生成中…' : '生成 3 个回复版本'}
                  <ArrowRight />
                </button>
              </div>
            </article>
          </section>
          <section className="col reply-col">
            <div className="col-title">
              <span className="number">03</span>审核与回复<small>REPLY</small>
            </div>
            <article className="card reply">
              <div className="reply-header">
                <div className="row">
                  <h2>回复草稿</h2>
                  <span
                    className={'pill' + (selected && !stale ? ' green' : '')}
                  >
                    {stale ? '要求已变更' : selected ? '待审核' : '等待生成'}
                  </span>
                </div>
                <div className="tabs" role="tablist" aria-label="回复版本">
                  {['简洁', '亲和', '正式'].map((label, i) => (
                    <button
                      className={'tab' + (version === i ? ' active' : '')}
                      role="tab"
                      aria-selected={version === i}
                      aria-controls="reply-panel"
                      id={'reply-tab-' + i}
                      disabled={!drafts[i]}
                      key={label}
                      onClick={() => setVersion(i)}
                    >
                      版本 0{i + 1} <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>
              {selected ? (
                <>
                  <div
                    className="reply-body"
                    id="reply-panel"
                    role="tabpanel"
                    aria-labelledby={'reply-tab-' + version}
                  >
                    <div>
                      <div className="editor-label">
                        <div className="left">
                          <span className="lang-icon">中</span>中文审核与编辑
                        </div>
                        <button
                          className="text-btn muted"
                          onClick={() =>
                            setEdits({ ...edits, [version]: selected.chinese })
                          }
                        >
                          恢复此版本
                        </button>
                      </div>
                      <textarea
                        className="field editor-cn"
                        aria-label="中文回复编辑"
                        maxLength={12000}
                        value={chinese}
                        onChange={(e) =>
                          setEdits({ ...edits, [version]: e.target.value })
                        }
                      />
                      <div className="sync-row">
                        <span
                          className={
                            'sync-note' + (dirty || stale ? ' dirty' : '')
                          }
                        >
                          {stale
                            ? '请按最新要求重新生成'
                            : dirty
                              ? '中文已修改'
                              : '已同步'}
                        </span>
                        <button
                          className="text-btn"
                          disabled={!dirty || stale || !!busy}
                          onClick={sync}
                        >
                          <RefreshCw />
                          {busy === 'sync' ? '同步中…' : '同步买家语言'}
                        </button>
                      </div>
                    </div>
                    <div>
                      <div className="editor-label">
                        <div className="left">
                          <span className="lang-icon">
                            {draftLanguage === 'ja'
                              ? '日'
                              : draftLanguage.toUpperCase()}
                          </span>
                          {languageNames[draftLanguage] ?? draftLanguage}回复
                        </div>
                        <button
                          className="text-btn muted"
                          onClick={() => void copy(chinese)}
                        >
                          复制中文
                        </button>
                      </div>
                      <p className="buyer-box">{selected.localized}</p>
                    </div>
                  </div>
                  <div className="reply-footer">
                    <span className="review-note">
                      <ShieldCheck />
                      请核对事实与承诺
                    </span>
                    <button
                      className="btn primary copy-btn"
                      disabled={dirty || stale || !!busy}
                      onClick={() => void copy(selected.localized)}
                    >
                      <Copy />
                      复制买家回复
                    </button>
                  </div>
                </>
              ) : (
                <div className="empty-reply">
                  <PencilLine />
                  <span>
                    {busy === 'drafts'
                      ? '正在生成双语回复…'
                      : '回复将显示在这里'}
                  </span>
                </div>
              )}
            </article>
          </section>
        </div>
        {notice && (
          <output className="notice">
            <span>{notice}</span>
            <button
              className="text-btn muted"
              aria-label="关闭提示"
              onClick={() => setNotice('')}
            >
              <X />
            </button>
          </output>
        )}
      </main>
      <Dialog open={shopDialog} onOpenChange={setShopDialog}>
        <DialogContent className="workspace-modal">
          <DialogTitle>店铺管理</DialogTitle>
          <DialogDescription className="sr-only">
            编辑店铺模板与回复要求
          </DialogDescription>
          <div className="form-row">
            <select
              aria-label="编辑店铺"
              value={shopForm.id}
              onChange={(e) =>
                setShopForm({ ...shops.find((s) => s.id === e.target.value)! })
              }
            >
              {!shopForm.id && <option value="">新店铺</option>}
              {shops.map((s) => (
                <option value={s.id} key={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => setShopForm({ ...defaultShop, id: '', name: '' })}
            >
              <Plus className="inline size-4" /> 新增店铺
            </button>
          </div>
          <label>
            店铺名称
            <input
              value={shopForm.name}
              maxLength={120}
              onChange={(e) =>
                setShopForm({ ...shopForm, name: e.target.value })
              }
            />
          </label>
          <div className="form-row">
            <label>
              回复语气
              <input
                value={shopForm.tone}
                maxLength={4000}
                onChange={(e) =>
                  setShopForm({ ...shopForm, tone: e.target.value })
                }
              />
            </label>
            <label>
              回复长度
              <input
                value={shopForm.length}
                maxLength={4000}
                onChange={(e) =>
                  setShopForm({ ...shopForm, length: e.target.value })
                }
              />
            </label>
          </div>
          <label>
            称呼规则
            <input
              value={shopForm.greeting}
              maxLength={4000}
              onChange={(e) =>
                setShopForm({ ...shopForm, greeting: e.target.value })
              }
            />
          </label>
          <label>
            回复要求
            <textarea
              value={shopForm.rules}
              maxLength={4000}
              onChange={(e) =>
                setShopForm({ ...shopForm, rules: e.target.value })
              }
            />
          </label>
          {modalNotice && (
            <p className="modal-notice" role="alert">
              {modalNotice}
            </p>
          )}
          <button className="save" onClick={saveShop} disabled={saving}>
            {saving ? '保存中…' : '保存店铺'}
          </button>
        </DialogContent>
      </Dialog>
      <Dialog open={modelDialog} onOpenChange={setModelDialog}>
        <DialogContent className="workspace-modal">
          <DialogTitle>高级模型设置</DialogTitle>
          <DialogDescription className="sr-only">
            接口地址和模型名称
          </DialogDescription>
          <label>
            接口地址
            <input
              value={settingsForm.endpoint}
              onChange={(e) =>
                setSettingsForm({ ...settingsForm, endpoint: e.target.value })
              }
            />
          </label>
          <label>
            模型名称
            <input
              value={settingsForm.model}
              onChange={(e) =>
                setSettingsForm({ ...settingsForm, model: e.target.value })
              }
            />
          </label>
          {modalNotice && (
            <p className="modal-notice" role="alert">
              {modalNotice}
            </p>
          )}
          <button className="save" onClick={saveSettings} disabled={saving}>
            {saving ? '保存中…' : '保存设置'}
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
