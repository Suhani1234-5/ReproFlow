/** Bumped whenever the persisted report shape changes. v2 added `failureAssertion`. */
export const REPORT_SCHEMA_VERSION = 2;

export type NavigationKind = 'pushState' | 'replaceState' | 'hashchange' | 'popstate';

/** Candidate locators captured for one element; the generator picks the highest priority one. */
export interface LocatorHints {
  role?: string;
  /** Accessible name for `role`. */
  name?: string;
  label?: string;
  testId?: string;
  text?: string;
}

interface EventBase {
  /** Stable id so retries and de-duplication are safe. */
  id: string;
  /** Epoch milliseconds, stamped where the event happened. */
  ts: number;
  /** Page URL the event happened on. */
  url: string;
  /** Locator candidates; `selector` stays the CSS fallback. */
  locator?: LocatorHints;
}

export interface ClickEvent extends EventBase {
  type: 'click';
  selector: string;
  text?: string;
}

export interface FillEvent extends EventBase {
  type: 'fill';
  selector: string;
  value: string;
  redacted: boolean;
}

export interface SelectEvent extends EventBase {
  type: 'select';
  selector: string;
  value: string;
}

export interface CheckEvent extends EventBase {
  type: 'check';
  selector: string;
  checked: boolean;
}

export interface SubmitEvent extends EventBase {
  type: 'submit';
  selector: string;
}

export interface NavigationEvent extends EventBase {
  type: 'navigation';
  kind: NavigationKind;
  toUrl: string;
}

export interface ConsoleEvent extends EventBase {
  type: 'console';
  level: 'error';
  message: string;
}

export interface ExceptionEvent extends EventBase {
  type: 'exception';
  message: string;
}

export interface RequestFailedEvent extends EventBase {
  type: 'requestfailed';
  method: string;
  requestUrl: string;
  /** HTTP status, or 0 when the request never got a response. */
  status: number;
}

/** Emitted by the recorder. The service worker adds `sessionId` and `seq`. */
export type RawEvent =
  | ClickEvent
  | FillEvent
  | SelectEvent
  | CheckEvent
  | SubmitEvent
  | NavigationEvent
  | ConsoleEvent
  | ExceptionEvent
  | RequestFailedEvent;

/** Persisted event: `seq` is a per-session monotonic counter owned by the service worker. */
export type RecordedEvent = RawEvent & { sessionId: string; seq: number };

/** Raw event without the fields the recorder itself stamps. */
export type EventPayload = RawEvent extends infer T
  ? T extends RawEvent
    ? Omit<T, 'id' | 'ts' | 'url'>
    : never
  : never;

export type SessionStatus = 'recording' | 'stopped';

export interface Session {
  id: string;
  status: SessionStatus;
  startedAt: number;
  endedAt?: number;
  tabId: number;
  startUrl: string;
  eventCount: number;
  /** Measured once at start; the report's environment needs it. */
  viewport?: string;
}

export type ScreenshotLabel = 'start' | 'navigation' | 'stop';

export interface Screenshot {
  id: string;
  sessionId: string;
  label: ScreenshotLabel;
  url: string;
  ts: number;
  dataUrl: string;
}
