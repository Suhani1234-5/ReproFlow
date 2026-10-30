import type { EventPayload, LocatorHints, RawEvent } from '@shared/types';
import {
  CHANNEL,
  PAGE_CHANNEL,
  type CaptureMessage,
  type PageSignal,
  type PageSignalMessage,
  type StopCaptureMessage,
} from '../lib/messages';
import { redactText, redactValue, type FieldHints } from '../lib/redact';

declare global {
  interface Window {
    __reproflowRecorder?: boolean;
  }
}

const FILL_DEBOUNCE_MS = 300;
const MAX_MESSAGE_LENGTH = 500;
const MAX_TEXT_LENGTH = 120;

let recording = false;

function forward(event: RawEvent): void {
  if (!recording) return;
  const message: CaptureMessage = { channel: CHANNEL, type: 'EVENT', event };
  void chrome.runtime.sendMessage(message).catch(() => {
    // Service worker restarting: already-persisted events are safe, the next one retries.
  });
}

function emit(payload: EventPayload): void {
  forward({ id: crypto.randomUUID(), ts: Date.now(), url: location.href, ...payload } as RawEvent);
}

function hintsOf(el: Element): FieldHints {
  return {
    type: el instanceof HTMLInputElement ? el.type : undefined,
    name: el.getAttribute('name') ?? undefined,
    id: el.id || undefined,
    autocomplete: el.getAttribute('autocomplete') ?? undefined,
  };
}

function cssPath(el: Element): string {
  const testId = el.getAttribute('data-testid') ?? el.getAttribute('data-test-id');
  if (testId) return `[data-testid="${testId}"]`;
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && parts.length < 4) {
    if (node.id) {
      parts.unshift(`#${CSS.escape(node.id)}`);
      break;
    }
    const parent: Element | null = node.parentElement;
    const index = parent ? Array.from(parent.children).indexOf(node) + 1 : 1;
    parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${index})`);
    node = parent;
  }
  return parts.join(' > ');
}

function visibleText(el: Element): string | undefined {
  const text = el.textContent?.trim().replace(/\s+/g, ' ');
  return text ? redactText(text).slice(0, MAX_TEXT_LENGTH) : undefined;
}

const IMPLICIT_ROLE: Record<string, string | undefined> = {
  a: 'link',
  button: 'button',
  select: 'combobox',
  textarea: 'textbox',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  img: 'img',
  nav: 'navigation',
};

function implicitRole(el: Element): string | undefined {
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox') return 'checkbox';
    if (el.type === 'radio') return 'radio';
    if (el.type === 'search') return 'searchbox';
    if (el.type === 'submit' || el.type === 'button' || el.type === 'reset') return 'button';
    return 'textbox';
  }
  return IMPLICIT_ROLE[el.tagName.toLowerCase()];
}

function labelText(el: Element): string | undefined {
  const labelled = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
  const raw = labelled?.textContent ?? el.closest('label')?.textContent;
  const text = raw?.trim().replace(/\s+/g, ' ');
  return text ? redactText(text).slice(0, MAX_TEXT_LENGTH) : undefined;
}

/** Everything the generator needs to pick the strongest Playwright locator. */
function locatorHints(el: Element): LocatorHints {
  const hints: LocatorHints = {};
  const text = visibleText(el);
  const role = el.getAttribute('role') ?? implicitRole(el);
  const ariaLabel = el.getAttribute('aria-label');
  const name = ariaLabel ? redactText(ariaLabel).slice(0, MAX_TEXT_LENGTH) : text;
  if (role && name) {
    hints.role = role;
    hints.name = name;
  }
  const label = labelText(el);
  if (label) hints.label = label;
  const testId = el.getAttribute('data-testid') ?? el.getAttribute('data-test-id');
  if (testId) hints.testId = testId;
  if (text) hints.text = text;
  return hints;
}

/** Page-world signals carry raw text; redaction happens here, before anything is persisted. */
function signalToEvent(signal: PageSignal): RawEvent {
  const base = { id: crypto.randomUUID(), ts: Date.now(), url: location.href };
  switch (signal.kind) {
    case 'console':
      return { ...base, type: 'console', level: 'error', message: redactText(signal.message).slice(0, MAX_MESSAGE_LENGTH) };
    case 'exception':
      return { ...base, type: 'exception', message: redactText(signal.message).slice(0, MAX_MESSAGE_LENGTH) };
    case 'requestfailed':
      return {
        ...base,
        type: 'requestfailed',
        method: signal.method,
        requestUrl: redactText(signal.requestUrl),
        status: signal.status,
      };
    case 'navigation':
      return { ...base, type: 'navigation', kind: signal.navigationKind, toUrl: signal.toUrl };
  }
}

function install(): void {
  if (window.__reproflowRecorder) return;
  window.__reproflowRecorder = true;
  recording = true;

  let pending: { el: HTMLInputElement | HTMLTextAreaElement } | null = null;
  let timer = 0;

  const flushFill = (): void => {
    if (!pending) return;
    const el = pending.el;
    pending = null;
    clearTimeout(timer);
    const { value, redacted } = redactValue(el.value, hintsOf(el));
    emit({ type: 'fill', selector: cssPath(el), value, redacted, locator: locatorHints(el) });
  };

  const onInput = (event: Event): void => {
    const el = event.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
    if (el.type === 'checkbox' || el.type === 'radio' || el.type === 'file') return;
    if (pending && pending.el !== el) flushFill();
    pending = { el };
    clearTimeout(timer);
    // Consecutive keystrokes on one field collapse into a single fill.
    timer = window.setTimeout(flushFill, FILL_DEBOUNCE_MS);
  };

  const onClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    flushFill();
    emit({ type: 'click', selector: cssPath(target), text: visibleText(target), locator: locatorHints(target) });
  };

  const onChange = (event: Event): void => {
    const el = event.target;
    if (el instanceof HTMLSelectElement) {
      flushFill();
      emit({ type: 'select', selector: cssPath(el), value: redactText(el.value), locator: locatorHints(el) });
      return;
    }
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
      flushFill();
      emit({ type: 'check', selector: cssPath(el), checked: el.checked, locator: locatorHints(el) });
    }
  };

  const onSubmit = (event: Event): void => {
    if (!(event.target instanceof HTMLFormElement)) return;
    flushFill();
    emit({ type: 'submit', selector: cssPath(event.target), locator: locatorHints(event.target) });
  };

  const onPageSignal = (event: MessageEvent): void => {
    if (event.source !== window) return;
    const data = event.data as Partial<PageSignalMessage> | undefined;
    if (!data || data.channel !== PAGE_CHANNEL || data.type !== 'SIGNAL' || !data.signal) return;
    forward(signalToEvent(data.signal));
  };

  const stop = (): void => {
    flushFill();
    recording = false;
  };

  document.addEventListener('click', onClick, true);
  document.addEventListener('input', onInput, true);
  document.addEventListener('change', onChange, true);
  document.addEventListener('submit', onSubmit, true);
  window.addEventListener('message', onPageSignal);
  window.addEventListener('pagehide', flushFill);

  chrome.runtime.onMessage.addListener((message: StopCaptureMessage) => {
    if (message.channel !== CHANNEL || message.type !== 'STOP_CAPTURE') return;
    stop();
  });
}

install();
