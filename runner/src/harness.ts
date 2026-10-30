import type { Browser, BrowserContext, Locator, Page } from 'playwright';

export interface TestFixtures {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export type TestBody = (fixtures: TestFixtures) => Promise<void> | void;

export interface RegisteredTest {
  title: string;
  body: TestBody;
}

export interface ExpectOptions {
  timeout?: number;
  message?: string;
}

const DEFAULT_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 50;

const registry: RegisteredTest[] = [];

/** Playwright-compatible `test()`: importing a spec registers its tests, the runner executes them. */
export function test(title: string, body: TestBody): void {
  registry.push({ title, body });
}

export function registeredTests(): readonly RegisteredTest[] {
  return registry;
}

export function resetRegistry(): void {
  registry.length = 0;
}

/** Raised when an expectation never held; the message carries what the replay observed. */
export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function stringify(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
}

/** Locators and pages describe themselves; plain objects fall back to JSON. */
function describe(value: unknown): string {
  if (value === null || typeof value !== 'object') return stringify(value);
  const text = String(value);
  return text === '[object Object]' ? stringify(value) : text;
}

function matchesUrl(actual: string, expected: string | RegExp): boolean {
  return typeof expected === 'string' ? actual === expected : expected.test(actual);
}

interface Outcome {
  ok: boolean;
  detail: string;
}

export interface Matchers {
  readonly not: Matchers;
  toContain(expected: unknown): Promise<void>;
  toBeVisible(options?: ExpectOptions): Promise<void>;
  toBeHidden(options?: ExpectOptions): Promise<void>;
  toHaveURL(expected: string | RegExp, options?: ExpectOptions): Promise<void>;
}

/** Web-first semantics: every matcher retries until it holds or the timeout expires. */
function createMatchers(resolve: () => unknown, negated: boolean, options: ExpectOptions): Matchers {
  const settle = async (
    predicate: (inverted: boolean) => Promise<Outcome>,
    override: ExpectOptions,
  ): Promise<void> => {
    const timeout = override.timeout ?? options.timeout ?? DEFAULT_TIMEOUT_MS;
    const message = override.message ?? options.message;
    const deadline = Date.now() + timeout;
    let detail = 'the expectation never resolved';

    for (;;) {
      const outcome = await predicate(negated);
      if (outcome.ok !== negated) return;
      detail = outcome.detail;
      if (Date.now() >= deadline) break;
      await sleep(POLL_INTERVAL_MS);
    }

    throw new AssertionError(message === undefined ? detail : `${message}: ${detail}`);
  };

  return {
    get not(): Matchers {
      return createMatchers(resolve, !negated, options);
    },
    async toContain(expected: unknown): Promise<void> {
      await settle(async (inverted) => {
        const value = await resolve();
        const items = Array.isArray(value) ? value : [value];
        return {
          ok: items.includes(expected),
          detail: `expected ${stringify(items)} ${inverted ? 'not ' : ''}to contain ${stringify(expected)}`,
        };
      }, {});
    },
    async toBeVisible(override: ExpectOptions = {}): Promise<void> {
      await settle(async (inverted) => {
        const locator = resolve() as Locator;
        return {
          ok: await locator.isVisible(),
          detail: `expected ${describe(locator)} ${inverted ? 'not ' : ''}to be visible`,
        };
      }, override);
    },
    async toBeHidden(override: ExpectOptions = {}): Promise<void> {
      await settle(async (inverted) => {
        const locator = resolve() as Locator;
        return {
          ok: !(await locator.isVisible()),
          detail: `expected ${describe(locator)} ${inverted ? 'not ' : ''}to be hidden`,
        };
      }, override);
    },
    async toHaveURL(expected: string | RegExp, override: ExpectOptions = {}): Promise<void> {
      await settle(async (inverted) => {
        const page = resolve() as Page;
        const actual = page.url();
        return {
          ok: matchesUrl(actual, expected),
          detail: `expected the page URL ${stringify(actual)} ${inverted ? 'not ' : ''}to match ${stringify(String(expected))}`,
        };
      }, override);
    },
  };
}

export interface Expect {
  (actual: unknown, options?: ExpectOptions): Matchers;
  poll(resolve: () => unknown, options?: ExpectOptions): Matchers;
}

function createExpect(): Expect {
  const base = (actual: unknown, options: ExpectOptions = {}): Matchers =>
    createMatchers(() => actual, false, options);
  return Object.assign(base, {
    poll: (resolve: () => unknown, options: ExpectOptions = {}): Matchers =>
      createMatchers(resolve, false, options),
  });
}

export const expect: Expect = createExpect();
