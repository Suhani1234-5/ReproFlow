import { createReport, type Environment, type ReproReport, type Verification } from '@shared/report';
import { SPEC_FILE_NAME, sha256Hex } from '@shared/spec';
import type { LocatorHints, RecordedEvent, Screenshot, Session } from '@shared/types';
import type { GeneratedSpec } from './generator';

export const REPORT_FILE_NAME = 'report.json';
export const REPORT_MARKDOWN_FILE_NAME = 'report.md';
export const SCREENSHOT_DIR = 'screenshots';

export interface ReportInput {
  session: Session;
  events: RecordedEvent[];
  screenshots: Screenshot[];
  spec: GeneratedSpec;
  environment: Environment;
  verification?: Verification;
  title?: string;
  summary?: string;
  expected?: string;
  actual?: string;
}

type ActionEvent = Extract<RecordedEvent, { type: 'click' | 'fill' | 'select' | 'check' | 'submit' }>;

const DEFAULT_EXPECTED = 'The flow completes without errors.';

function isAction(event: RecordedEvent): event is ActionEvent {
  return (
    event.type === 'click' ||
    event.type === 'fill' ||
    event.type === 'select' ||
    event.type === 'check' ||
    event.type === 'submit'
  );
}

/** Mirrors the generator's locator priority, expressed the way a person would name the element. */
function elementName(locator: LocatorHints | undefined, fallback: string): string {
  return locator?.name ?? locator?.label ?? locator?.testId ?? locator?.text ?? fallback;
}

function quoted(value: string): string {
  return `"${value}"`;
}

function describeAction(event: ActionEvent): string {
  const name = quoted(elementName(event.locator, event.selector));
  switch (event.type) {
    case 'click':
      return `Click ${name}`;
    case 'fill':
      return event.redacted
        ? `Type a redacted value into ${name}`
        : `Type ${quoted(event.value)} into ${name}`;
    case 'select':
      return `Select ${quoted(event.value)} in ${name}`;
    case 'check':
      return `${event.checked ? 'Check' : 'Uncheck'} ${name}`;
    case 'submit':
      return `Submit ${name}`;
  }
}

/** Human-readable steps, in replay order, with repeated typing collapsed (as the generator does). */
export function describeSteps(events: RecordedEvent[]): string[] {
  const actions = [...events].sort((a, b) => a.seq - b.seq).filter(isAction);
  const steps: string[] = [];
  for (let index = 0; index < actions.length; index += 1) {
    const event = actions[index];
    const next = actions[index + 1];
    if (event.type === 'fill' && next?.type === 'fill' && next.selector === event.selector) continue;
    steps.push(describeAction(event));
  }
  return steps;
}

function normalize(part: string): string {
  return part.trim().replace(/\s+/g, ' ').toLowerCase().replace(/[.,;:!?]+$/, '');
}

/** Query strings and fragments reorder between runs; the fingerprint should not. */
function normalizeUrl(url: string): string {
  return normalize(url.split('#')[0]!.split('?')[0]!.replace(/\/+$/, ''));
}

export interface FingerprintInput {
  steps: readonly string[];
  failureAssertion: string;
  url: string;
}

/**
 * GH-8: the same reproduction always hashes to the same value, so a second report
 * for one bug can be recognised before a duplicate issue is opened.
 */
export async function computeFingerprint(input: FingerprintInput): Promise<string> {
  const parts = [input.steps.map(normalize).join('\n'), normalize(input.failureAssertion), normalizeUrl(input.url)];
  return sha256Hex(parts.join('\n'));
}

function failureDescription(spec: GeneratedSpec): string {
  return `${spec.failure.kind.replace('-', ' ')} at replay: ${spec.failure.value}`;
}

/** The report is a plain value: everything downstream (exports, issues) reads it, nothing mutates it. */
export async function buildReport(input: ReportInput): Promise<ReproReport> {
  const events = [...input.events].sort((a, b) => a.seq - b.seq);
  const steps = describeSteps(events);
  const url = input.environment.url;
  const failureAssertion = input.spec.failure.value;
  const fingerprint = await computeFingerprint({ steps, failureAssertion, url });

  return createReport({
    id: crypto.randomUUID(),
    sessionId: input.session.id,
    title: input.title ?? `Bug on ${url}`,
    summary: input.summary ?? `ReproFlow recorded a ${failureDescription(input.spec)}.`,
    expected: input.expected ?? DEFAULT_EXPECTED,
    actual: input.actual ?? failureDescription(input.spec),
    steps,
    failureAssertion,
    environment: input.environment,
    verification: input.verification,
    screenshots: input.screenshots,
    events,
    // The full signed file, so exports and issues carry a spec the runner will accept.
    testFile: input.spec.source,
    fingerprint,
  });
}

export function toJson(report: ReproReport): string {
  return JSON.stringify(report, null, 2);
}

export function screenshotFileName(screenshot: Screenshot): string {
  return `${screenshot.label}-${screenshot.id}.png`;
}

export function toMarkdown(report: ReproReport): string {
  const lines: string[] = [report.title, '='.repeat(report.title.length), '', report.summary, ''];

  lines.push('Expected / Actual', '-'.repeat(16), `- Expected: ${report.expected}`, `- Actual: ${report.actual}`, '');

  lines.push('Steps to Reproduce', '-'.repeat(17));
  report.steps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
  if (report.steps.length === 0) lines.push('No interactions were recorded.');
  lines.push('');

  const verification = report.verification;
  lines.push('Verification', '-'.repeat(12));
  lines.push(
    verification
      ? `Result: ${verification.result} (${verification.failures} of ${verification.runs} runs) — ${verification.message}`
      : 'Result: not verified',
  );
  lines.push(`Failure: ${report.failureAssertion || 'unknown'}`, '');

  lines.push('Evidence', '-'.repeat(8));
  if (report.screenshots.length === 0) lines.push('No screenshots were captured.');
  for (const screenshot of report.screenshots) {
    lines.push(`### ${screenshot.label} — ${screenshot.url}`, '', `![${screenshot.label}](${SCREENSHOT_DIR}/${screenshotFileName(screenshot)})`, '');
  }

  lines.push('Reproduction Test', '-'.repeat(17), '', `<details><summary>${SPEC_FILE_NAME}</summary>`, '', '```ts', report.testFile, '```', '', '</details>', '');

  const environment = report.environment;
  lines.push(
    'Environment',
    '-'.repeat(11),
    `- Browser: ${environment.browser}`,
    `- OS: ${environment.os}`,
    `- Viewport: ${environment.viewport}`,
    `- URL: ${environment.url}`,
    `- ReproFlow: ${environment.extensionVersion}`,
    '',
    `<!-- reproflow:fingerprint=${report.fingerprint} -->`,
    '',
  );

  return lines.join('\n');
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(epochMs: number): { time: number; date: number } {
  const when = new Date(epochMs);
  return {
    time: (when.getHours() << 11) | (when.getMinutes() << 5) | Math.floor(when.getSeconds() / 2),
    date: ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
  };
}

/** Store-only ZIP: no compression, so the archive is byte-stable and needs no dependency. */
function zipStore(entries: ZipEntry[], modifiedAt: number): Uint8Array {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(modifiedAt);
  const locals: Uint8Array[] = [];
  const directories: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);

    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, time, true);
    localView.setUint16(12, date, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, entry.data.length, true);
    localView.setUint32(22, entry.data.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    locals.push(local, entry.data);

    const directory = new Uint8Array(46 + name.length);
    const directoryView = new DataView(directory.buffer);
    directoryView.setUint32(0, 0x02014b50, true);
    directoryView.setUint16(4, 20, true);
    directoryView.setUint16(6, 20, true);
    directoryView.setUint16(10, 0, true);
    directoryView.setUint16(12, time, true);
    directoryView.setUint16(14, date, true);
    directoryView.setUint32(16, crc, true);
    directoryView.setUint32(20, entry.data.length, true);
    directoryView.setUint32(24, entry.data.length, true);
    directoryView.setUint16(28, name.length, true);
    directoryView.setUint32(42, offset, true);
    directory.set(name, 46);
    directories.push(directory);

    offset += local.length + entry.data.length;
  }

  const directorySize = directories.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, directorySize, true);
  endView.setUint32(16, offset, true);

  const archive = new Uint8Array(offset + directorySize + end.length);
  let cursor = 0;
  for (const part of [...locals, ...directories, end]) {
    archive.set(part, cursor);
    cursor += part.length;
  }
  return archive;
}

/** Screenshots are stored as data URLs, which are already base64. */
function decodeBase64(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  const base64 = comma === -1 ? '' : dataUrl.slice(comma + 1);
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

/** Everything a reviewer needs, in one file they can attach to an issue by hand. */
export async function toZip(report: ReproReport): Promise<Blob> {
  const encoder = new TextEncoder();
  const entries: ZipEntry[] = [
    { name: REPORT_FILE_NAME, data: encoder.encode(toJson(report)) },
    { name: REPORT_MARKDOWN_FILE_NAME, data: encoder.encode(toMarkdown(report)) },
    { name: SPEC_FILE_NAME, data: encoder.encode(report.testFile) },
  ];
  for (const screenshot of report.screenshots) {
    entries.push({ name: `${SCREENSHOT_DIR}/${screenshotFileName(screenshot)}`, data: decodeBase64(screenshot.dataUrl) });
  }
  const archive = zipStore(entries, report.createdAt);
  // `Blob` in the DOM lib wants an `ArrayBuffer`-backed view, not `ArrayBufferLike`.
  return new Blob([archive.buffer as ArrayBuffer], { type: 'application/zip' });
}
