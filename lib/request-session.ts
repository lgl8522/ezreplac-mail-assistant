import type { AssistantResult, Mode } from './assistant-task';

// Per-tab, in-memory only. Keys contain the exact task inputs; buyer content is
// never saved to localStorage, shared KV or a shared server cache.
export class RequestSession {
  private readonly onUnauthorized?: () => void;

  constructor(onUnauthorized?: () => void) {
    this.onUnauthorized = onUnauthorized;
  }

  private cache = new Map<string, { value: AssistantResult; at: number }>();
  private active = new Map<
    Mode,
    {
      key: string;
      controller: AbortController;
      promise: Promise<AssistantResult>;
    }
  >();
  cancel(mode: Mode) {
    this.active.get(mode)?.controller.abort();
    this.active.delete(mode);
  }
  clear() {
    for (const mode of this.active.keys()) this.cancel(mode);
    this.cache.clear();
  }
  async request(
    mode: Mode,
    payload: Record<string, unknown>,
    modelKey: string,
  ): Promise<AssistantResult> {
    // Reusing an existing draft with its translation also satisfies a later
    // request that does not need that translation again.
    const keyPayload =
      mode === 'drafts' ? { ...payload, hasTranslation: false } : payload;
    const key = JSON.stringify([modelKey, mode, keyPayload]);
    const cached = this.cache.get(key);
    if (
      cached &&
      Date.now() - cached.at < 15 * 60_000 &&
      (mode !== 'drafts' ||
        payload.hasTranslation ||
        !payload.mail ||
        cached.value.translation)
    )
      return cached.value;
    const active = this.active.get(mode);
    if (active?.key === key) return active.promise;
    this.cancel(mode);
    const controller = new AbortController();
    const promise = (async () => {
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, ...payload }),
        signal: controller.signal,
      });
      const result = (await response.json()) as AssistantResult & {
        error?: string;
      };
      if (response.status === 401) this.onUnauthorized?.();
      if (!response.ok)
        throw new Error(
          result.error || `请求失败（HTTP ${response.status}）。`,
        );
      if (controller.signal.aborted)
        throw new DOMException('Aborted', 'AbortError');
      this.cache.set(key, { value: result, at: Date.now() });
      while (this.cache.size > 24)
        this.cache.delete(this.cache.keys().next().value!);
      return result;
    })();
    this.active.set(mode, { key, controller, promise });
    try {
      return await promise;
    } finally {
      if (this.active.get(mode)?.controller === controller)
        this.active.delete(mode);
    }
  }
}
