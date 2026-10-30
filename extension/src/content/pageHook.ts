/**
 * Runs in the page's own world via chrome.scripting.executeScript({ func: pageHook }).
 * The function body is serialised as-is, so it must stay self-contained: no imports,
 * no closure over module state, no chrome.* APIs. Everything it observes is posted to
 * the isolated recorder, which owns redaction and persistence.
 */
export function pageHook(): void {
  const scope = window as Window & { __reproflowPageHook?: boolean };
  if (scope.__reproflowPageHook) return;
  scope.__reproflowPageHook = true;

  // Mirror of PAGE_CHANNEL in src/lib/messages.ts.
  const channel = 'reproflow-page';
  const post = (signal: unknown): void => {
    window.postMessage({ channel, type: 'SIGNAL', signal }, '*');
  };

  const describe = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.message;
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  };

  const originalConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]): void => {
    post({ kind: 'console', message: args.map(describe).join(' ') });
    originalConsoleError(...args);
  };

  window.addEventListener('error', (event) => {
    if (event.target instanceof Element) return;
    post({ kind: 'exception', message: event.message });
  });

  window.addEventListener('unhandledrejection', (event) => {
    post({ kind: 'exception', message: describe(event.reason) });
  });

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    try {
      const response = await originalFetch(input, init);
      // Status and URL only, never the body.
      if (!response.ok) post({ kind: 'requestfailed', method, requestUrl, status: response.status });
      return response;
    } catch (error) {
      post({ kind: 'requestfailed', method, requestUrl, status: 0 });
      throw error;
    }
  };

  const requests = new WeakMap<XMLHttpRequest, { method: string; url: string }>();
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function open(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ): void {
    requests.set(this, { method, url: String(url) });
    originalOpen.call(this, method, url, async ?? true, username ?? null, password ?? null);
  };

  XMLHttpRequest.prototype.send = function send(
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ): void {
    this.addEventListener('loadend', () => {
      const meta = requests.get(this);
      if (!meta) return;
      if (this.status === 0 || this.status >= 400) {
        post({ kind: 'requestfailed', method: meta.method, requestUrl: meta.url, status: this.status });
      }
    });
    originalSend.call(this, body ?? null);
  };

  const navigate = (navigationKind: 'pushState' | 'replaceState' | 'hashchange' | 'popstate'): void => {
    post({ kind: 'navigation', navigationKind, toUrl: location.href });
  };

  const patchHistory = (method: 'pushState' | 'replaceState'): void => {
    const original = history[method].bind(history);
    history[method] = ((...args: Parameters<History['pushState']>) => {
      original(...args);
      navigate(method);
    }) as History[typeof method];
  };

  patchHistory('pushState');
  patchHistory('replaceState');
  window.addEventListener('popstate', () => navigate('popstate'));
  window.addEventListener('hashchange', () => navigate('hashchange'));
}
