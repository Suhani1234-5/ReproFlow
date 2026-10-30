import { beforeAll, describe, expect, it } from 'vitest';
import { REPORT_SCHEMA_VERSION } from '@shared/types';
import { isReproReport, type Environment, type ReproReport } from '@shared/report';
import { SPEC_FILE_NAME, readSpecHeader } from '@shared/spec';
import type { RecordedEvent, Screenshot, Session } from '@shared/types';
import { generateSpec, type GeneratedSpec } from './generator';
import {
  REPORT_FILE_NAME,
  REPORT_MARKDOWN_FILE_NAME,
  SCREENSHOT_DIR,
  buildReport,
  computeFingerprint,
  describeSteps,
  toJson,
  toMarkdown,
  toZip,
} from './report';

const SESSION_ID = 'session-1';
const CHECKOUT_URL = 'https://shop.example.com/checkout';
const PAY_FAILURE = 'POST 500 https://shop.example.com/api/pay';
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

function base(seq: number) {
  return { id: `event-${seq}`, ts: 1_700_000_000_000 + seq, url: CHECKOUT_URL, sessionId: SESSION_ID, seq };
}

const session: Session = {
  id: SESSION_ID,
  status: 'stopped',
  startedAt: 1_700_000_000_000,
  endedAt: 1_700_000_010_000,
  tabId: 7,
  startUrl: CHECKOUT_URL,
  eventCount: 4,
};

const environment: Environment = {
  browser: 'Chrome 131',
  os: 'Windows 11',
  viewport: '1280x720',
  url: CHECKOUT_URL,
  extensionVersion: '0.1.0',
};

const screenshot: Screenshot = {
  id: 'shot-1',
  sessionId: SESSION_ID,
  label: 'stop',
  url: CHECKOUT_URL,
  ts: 1_700_000_010_000,
  dataUrl: PNG_DATA_URL,
};

const events: RecordedEvent[] = [
  { ...base(0), type: 'fill', selector: '#email', value: 'qa@example.com', redacted: false, locator: { label: 'Email' } },
  { ...base(1), type: 'fill', selector: '#email', value: 'qa@example.com', redacted: false, locator: { label: 'Email' } },
  { ...base(2), type: 'fill', selector: '#card', value: '[REDACTED]', redacted: true, locator: { label: 'Card number' } },
  { ...base(3), type: 'click', selector: '#pay-now', text: 'Pay now', locator: { role: 'button', name: 'Pay now' } },
  { ...base(4), type: 'requestfailed', method: 'POST', requestUrl: 'https://shop.example.com/api/pay', status: 500 },
];

let spec: GeneratedSpec;
let report: ReproReport;

beforeAll(async () => {
  spec = await generateSpec({ startUrl: CHECKOUT_URL, events });
  report = await buildReport({
    session,
    events,
    screenshots: [screenshot],
    spec,
    environment,
    verification: { result: 'reproduced', runs: 3, failures: 3, message: 'the recorded failure reproduced' },
  });
});

/** Reads the central directory, so a malformed archive fails here rather than in a ZIP tool. */
function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
  expect(end).toBeGreaterThanOrEqual(0);

  const files = new Map<string, Uint8Array>();
  let cursor = view.getUint32(end + 16, true);
  const count = view.getUint16(end + 10, true);
  for (let index = 0; index < count; index += 1) {
    const crc = view.getUint32(cursor + 16, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const offset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    expect(view.getUint32(offset + 14, true)).toBe(crc);
    files.set(name, bytes.subarray(start, start + size));
    cursor += 46 + nameLength + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
  }
  return files;
}

describe('describeSteps', () => {
  it('collapses repeated typing and names elements the way a person would', () => {
    expect(describeSteps(events)).toEqual([
      'Type "qa@example.com" into "Email"',
      'Type a redacted value into "Card number"',
      'Click "Pay now"',
    ]);
  });

  it('describes select, check and submit', () => {
    const steps = describeSteps([
      { ...base(0), type: 'select', selector: '#country', value: 'IN', locator: { label: 'Country' } },
      { ...base(1), type: 'check', selector: '#terms', checked: true, locator: { testId: 'terms' } },
      { ...base(2), type: 'check', selector: '#terms', checked: false, locator: { testId: 'terms' } },
      { ...base(3), type: 'submit', selector: '#form', locator: { text: 'Place order' } },
    ]);
    expect(steps).toEqual([
      'Select "IN" in "Country"',
      'Check "terms"',
      'Uncheck "terms"',
      'Submit "Place order"',
    ]);
  });

  it('falls back to the CSS selector, and orders by seq not by array position', () => {
    const click: RecordedEvent = { ...base(5), type: 'click', selector: '#legacy' };
    const earlier: RecordedEvent = { ...base(1), type: 'click', selector: '#first' };
    expect(describeSteps([click, earlier])).toEqual(['Click "#first"', 'Click "#legacy"']);
  });
});

describe('buildReport', () => {
  it('stamps the schema version and a fresh id', () => {
    expect(report.schemaVersion).toBe(REPORT_SCHEMA_VERSION);
    expect(report.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(report.sessionId).toBe(SESSION_ID);
  });

  it('carries the failure assertion the fingerprint is built from', () => {
    expect(report.failureAssertion).toBe(PAY_FAILURE);
    expect(spec.failure.value).toBe(PAY_FAILURE);
  });

  it('embeds a still-valid signed spec', async () => {
    expect(report.testFile).toBe(spec.source);
    await expect(readSpecHeader(report.testFile)).resolves.toMatchObject({ failure: PAY_FAILURE });
  });

  it('keeps the events, screenshots and environment', () => {
    expect(report.events.map((event) => event.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(report.screenshots).toEqual([screenshot]);
    expect(report.environment).toEqual(environment);
    expect(report.verification?.result).toBe('reproduced');
  });
});

describe('computeFingerprint', () => {
  const input = { steps: ['Click "Pay now"'], failureAssertion: PAY_FAILURE, url: CHECKOUT_URL };

  it('is stable across whitespace, casing and trailing punctuation', async () => {
    const same = await computeFingerprint({
      steps: ['  click   "Pay now". '],
      failureAssertion: ` ${PAY_FAILURE} `,
      url: `${CHECKOUT_URL}/`,
    });
    await expect(computeFingerprint(input)).resolves.toBe(same);
  });

  it('ignores the query string and fragment, which reorder between runs', async () => {
    const a = await computeFingerprint({ ...input, url: `${CHECKOUT_URL}?step=2#top` });
    await expect(computeFingerprint({ ...input, url: `${CHECKOUT_URL}?step=3` })).resolves.toBe(a);
  });

  it('changes when the steps or the failure change', async () => {
    const fingerprint = await computeFingerprint(input);
    expect(await computeFingerprint({ ...input, steps: ['Click "Pay later"'] })).not.toBe(fingerprint);
    expect(await computeFingerprint({ ...input, failureAssertion: 'GET 404 /api/order' })).not.toBe(fingerprint);
  });

  it('is a sha256 hex digest and matches the stored report fingerprint', async () => {
    expect(report.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    await expect(computeFingerprint({ steps: report.steps, failureAssertion: PAY_FAILURE, url: CHECKOUT_URL })).resolves.toBe(
      report.fingerprint,
    );
  });
});

describe('toJson', () => {
  it('round-trips as a versioned report', () => {
    const parsed: unknown = JSON.parse(toJson(report));
    expect(isReproReport(parsed)).toBe(true);
    expect((parsed as ReproReport).schemaVersion).toBe(REPORT_SCHEMA_VERSION);
    expect((parsed as ReproReport).failureAssertion).toBe(PAY_FAILURE);
  });
});

describe('toMarkdown', () => {
  const markdown = () => toMarkdown(report);

  it('documents every section of the report', () => {
    const text = markdown();
    expect(text).toContain('Steps to Reproduce');
    expect(text).toContain('1. Type "qa@example.com" into "Email"');
    expect(text).toContain('Result: reproduced (3 of 3 runs)');
    expect(text).toContain(`![stop](${SCREENSHOT_DIR}/stop-shot-1.png)`);
    expect(text).toContain(`<!-- reproflow:fingerprint=${report.fingerprint} -->`);
  });

  it('collapses the test in a details block', () => {
    const text = markdown();
    expect(text).toContain(`<details><summary>${SPEC_FILE_NAME}</summary>`);
    expect(text).toContain(report.testFile);
  });
});

describe('toZip', () => {
  it('packages the report, the markdown, the test and the screenshots', async () => {
    const archive = new Uint8Array(await (await toZip(report)).arrayBuffer());
    const files = readZip(archive);

    expect([...files.keys()]).toEqual([
      REPORT_FILE_NAME,
      REPORT_MARKDOWN_FILE_NAME,
      SPEC_FILE_NAME,
      `${SCREENSHOT_DIR}/stop-shot-1.png`,
    ]);

    const decoder = new TextDecoder();
    expect(decoder.decode(files.get(SPEC_FILE_NAME))).toBe(report.testFile);
    expect(JSON.parse(decoder.decode(files.get(REPORT_FILE_NAME)))).toMatchObject({ id: report.id });
    expect([...(files.get(`${SCREENSHOT_DIR}/stop-shot-1.png`) ?? [])].slice(0, 4)).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('is byte-stable for the same report', async () => {
    const first = new Uint8Array(await (await toZip(report)).arrayBuffer());
    const second = new Uint8Array(await (await toZip(report)).arrayBuffer());
    expect(first).toEqual(second);
  });
});
