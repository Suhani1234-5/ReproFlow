import { describe, expect, it } from 'vitest';
import { SPEC_HEADER_PREFIX, readSpecHeader } from '@shared/spec';
import type { LocatorHints, RecordedEvent } from '@shared/types';
import { generateSpec, validateSpecSource } from './generator';

const SESSION = 'session-1';
const CHECKOUT_URL = 'https://shop.example.com/checkout';

function base(seq: number, url: string = CHECKOUT_URL) {
  return { id: `event-${seq}`, ts: 1_700_000_000_000 + seq, url, sessionId: SESSION, seq };
}

function fill(
  seq: number,
  selector: string,
  value: string,
  redacted = false,
  locator?: LocatorHints,
): RecordedEvent {
  return { ...base(seq), type: 'fill', selector, value, redacted, locator };
}

function click(seq: number, selector: string, text?: string, locator?: LocatorHints): RecordedEvent {
  return { ...base(seq), type: 'click', selector, text, locator };
}

function select(seq: number, selector: string, value: string, locator?: LocatorHints): RecordedEvent {
  return { ...base(seq), type: 'select', selector, value, locator };
}

function check(seq: number, selector: string, checked: boolean, locator?: LocatorHints): RecordedEvent {
  return { ...base(seq), type: 'check', selector, checked, locator };
}

function navigate(seq: number, toUrl: string): RecordedEvent {
  return { ...base(seq, toUrl), type: 'navigation', kind: 'pushState', toUrl };
}

function consoleError(seq: number, message: string): RecordedEvent {
  return { ...base(seq), type: 'console', level: 'error', message };
}

function requestFailed(seq: number, method: string, requestUrl: string, status: number): RecordedEvent {
  return { ...base(seq), type: 'requestfailed', method, requestUrl, status };
}

/** Sample session 1: a login that blows up with a console error. */
const loginSession: RecordedEvent[] = [
  fill(1, 'form:nth-child(1) > input:nth-child(1)', 'qa@example.com', false, {
    label: 'Email',
    testId: 'email',
    text: 'Email',
  }),
  fill(2, 'form:nth-child(1) > input:nth-child(1)', 'qa@example.com', false, { label: 'Email' }),
  fill(3, 'form:nth-child(1) > input:nth-child(2)', '[REDACTED]', true, { label: 'Password' }),
  click(4, '[data-testid="signin"]', 'Sign in', {
    role: 'button',
    name: 'Sign in',
    testId: 'signin',
    text: 'Sign in',
  }),
  consoleError(5, 'TypeError: cannot read properties of undefined'),
];

/** Sample session 2: checkout where the payment call fails with HTTP 500. */
const checkoutSession: RecordedEvent[] = [
  click(1, '#pay-now', 'Pay now', { testId: 'pay-now', text: 'Pay now' }),
  requestFailed(2, 'POST', 'https://shop.example.com/api/pay', 500),
];

/** Sample session 3: an SPA route that lands on a broken URL. */
const navigationSession: RecordedEvent[] = [
  select(1, 'form:nth-child(1) > select:nth-child(1)', 'us', { testId: 'country' }),
  check(2, 'form:nth-child(1) > input:nth-child(2)', true, { testId: 'terms' }),
  click(3, 'form:nth-child(1) > button:nth-child(3)', 'Continue', { text: 'Continue' }),
  navigate(4, 'https://shop.example.com/broken'),
];

describe('generateSpec', () => {
  it('signs the spec with the recorded console error and collapses repeated typing', async () => {
    const { source, failure, fileName } = await generateSpec({
      startUrl: CHECKOUT_URL,
      events: loginSession,
    });

    expect(fileName).toBe('reproduction.spec.ts');
    expect(source.startsWith(SPEC_HEADER_PREFIX)).toBe(true);
    expect(failure).toEqual({
      kind: 'console-error',
      value: 'TypeError: cannot read properties of undefined',
    });

    const header = await readSpecHeader(source);
    expect(header?.failure).toBe('TypeError: cannot read properties of undefined');

    // GEN-7: three input events, two of them on the email field, produce a single fill.
    expect(source.split('page.getByLabel("Email").fill("qa@example.com");')).toHaveLength(2);
    // Locator priority: role beats label, test id and text.
    expect(source).toContain('await page.getByRole("button", { name: "Sign in" }).click();');
    // The password field is never written to the spec.
    expect(source).not.toContain('[REDACTED]');
    expect(source).toContain('// ReproFlow: the value typed into "form:nth-child(1) > input:nth-child(2)"');
    // The failure assertion is derived from the recorded console error.
    expect(source).toContain(
      'await expect.poll(() => reproflowConsoleErrors, { timeout: 5000 }).not.toContain("TypeError: cannot read properties of undefined");',
    );
    expect(validateSpecSource(source)).toEqual([]);
  });

  it('asserts on the HTTP status recorded for a failed request', async () => {
    const { source, failure } = await generateSpec({
      startUrl: CHECKOUT_URL,
      events: checkoutSession,
    });

    expect(failure).toEqual({
      kind: 'http-status',
      value: 'POST 500 https://shop.example.com/api/pay',
    });
    expect(source).toContain('await page.getByTestId("pay-now").click();');
    expect(source).toContain(
      'await expect.poll(() => reproflowHttpFailures, { timeout: 5000 }).not.toContain("POST 500 https://shop.example.com/api/pay");',
    );
    expect(source).toContain("page.on('response', (response) => {");
    expect(validateSpecSource(source)).toEqual([]);
  });

  it('falls back to the final URL when nothing else failed', async () => {
    const { source, failure } = await generateSpec({
      startUrl: CHECKOUT_URL,
      events: navigationSession,
    });

    expect(failure).toEqual({ kind: 'url', value: 'https://shop.example.com/broken' });
    expect(source).toContain('await page.getByTestId("country").selectOption("us");');
    expect(source).toContain('await page.getByTestId("terms").check();');
    expect(source).toContain('await page.getByText("Continue").click();');
    expect(source).toContain('await expect(page).not.toHaveURL("https://shop.example.com/broken");');
    expect(validateSpecSource(source)).toEqual([]);
  });

  it('is deterministic for the same session', async () => {
    const first = await generateSpec({ startUrl: CHECKOUT_URL, events: loginSession });
    const second = await generateSpec({ startUrl: CHECKOUT_URL, events: loginSession });
    expect(second.source).toBe(first.source);
  });

  it('ignores event order and uses descending ids only as a tie breaker', async () => {
    const shuffled = [loginSession[3], loginSession[0], loginSession[4], loginSession[2], loginSession[1]];
    const ordered = await generateSpec({ startUrl: CHECKOUT_URL, events: loginSession });
    const jumbled = await generateSpec({ startUrl: CHECKOUT_URL, events: shuffled });
    expect(jumbled.source).toBe(ordered.source);
  });

  it('falls back to a CSS locator when no hints were captured', async () => {
    const { source } = await generateSpec({
      startUrl: CHECKOUT_URL,
      events: [click(1, '#legacy-button')],
    });
    expect(source).toContain('await page.locator("#legacy-button").click();');
  });

  it('asserts on visible error text when the app rendered one', async () => {
    const { source, failure } = await generateSpec({
      startUrl: CHECKOUT_URL,
      events: [click(1, 'div:nth-child(2)', 'Something went wrong. Try again.', { testId: 'banner' })],
    });
    expect(failure).toEqual({ kind: 'visible-text', value: 'Something went wrong. Try again.' });
    expect(source).toContain('await expect(page.getByText("Something went wrong. Try again.")).toBeHidden');
    expect(validateSpecSource(source)).toEqual([]);
  });

  it('rejects a spec that is not byte-for-byte generator output', async () => {
    const { source } = await generateSpec({ startUrl: CHECKOUT_URL, events: checkoutSession });
    expect(await readSpecHeader(source)).not.toBeNull();
    expect(await readSpecHeader(source.replace(CHECKOUT_URL, 'https://evil.example.com'))).toBeNull();
  });

  it('reports syntax errors instead of emitting them', () => {
    expect(validateSpecSource('const = ;')).not.toEqual([]);
  });
});
