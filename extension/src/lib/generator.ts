import * as ts from 'typescript';
import { SPEC_FILE_NAME, writeSpecHeader } from '@shared/spec';
import type { LocatorHints, RecordedEvent } from '@shared/types';

export { SPEC_FILE_NAME };

const ASSERTION_TIMEOUT_MS = 5000;

/** Text that looks like the app telling the user something went wrong. */
const ERROR_TEXT =
  /\b(error|failed|failure|invalid|unable|denied|wrong|not\s+found|something\s+went\s+wrong)\b/i;

export type FailureKind = 'console-error' | 'http-status' | 'visible-text' | 'url';

export interface FailureSignature {
  kind: FailureKind;
  /** Carried in the signed header; the runner matches it against the replay failure. */
  value: string;
}

export interface GeneratorInput {
  /** URL the recording started on. */
  startUrl: string;
  events: RecordedEvent[];
}

export interface GeneratedSpec {
  fileName: string;
  source: string;
  failure: FailureSignature;
}

type ActionEvent = Extract<RecordedEvent, { type: 'click' | 'fill' | 'select' | 'check' | 'submit' }>;

function literal(value: string): string {
  return JSON.stringify(value);
}

function bySeq(a: RecordedEvent, b: RecordedEvent): number {
  if (a.seq !== b.seq) return a.seq - b.seq;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Locator priority: role, label, test id, text, then the CSS path.
 * Uniqueness is asserted at replay time by Playwright's strict mode (a locator matching
 * more than one element throws) rather than here, which keeps generation pure.
 */
function locator(hints: LocatorHints | undefined, css: string): string {
  if (hints?.role && hints.name) {
    return `page.getByRole(${literal(hints.role)}, { name: ${literal(hints.name)} })`;
  }
  if (hints?.label) return `page.getByLabel(${literal(hints.label)})`;
  if (hints?.testId) return `page.getByTestId(${literal(hints.testId)})`;
  if (hints?.text) return `page.getByText(${literal(hints.text)})`;
  return `page.locator(${literal(css)})`;
}

function lastNavigationUrl(events: RecordedEvent[], startUrl: string): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === 'navigation') return event.toUrl;
  }
  return startUrl;
}

/** The strongest recorded failure, most specific first. */
function detectFailure(events: RecordedEvent[], startUrl: string): FailureSignature {
  const exception = events.find((event) => event.type === 'exception');
  if (exception?.type === 'exception') return { kind: 'console-error', value: exception.message };

  const consoleError = events.find((event) => event.type === 'console');
  if (consoleError?.type === 'console') return { kind: 'console-error', value: consoleError.message };

  const requestFailure = events.find(
    (event) => event.type === 'requestfailed' && (event.status === 0 || event.status >= 400),
  );
  if (requestFailure?.type === 'requestfailed') {
    return {
      kind: 'http-status',
      value: `${requestFailure.method} ${requestFailure.status} ${requestFailure.requestUrl}`,
    };
  }

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === 'click' && event.text !== undefined && ERROR_TEXT.test(event.text)) {
      return { kind: 'visible-text', value: event.text };
    }
  }

  return { kind: 'url', value: lastNavigationUrl(events, startUrl) };
}

function isAction(event: RecordedEvent): event is ActionEvent {
  return (
    event.type === 'click' ||
    event.type === 'fill' ||
    event.type === 'select' ||
    event.type === 'check' ||
    event.type === 'submit'
  );
}

function stepFor(event: ActionEvent): string {
  switch (event.type) {
    case 'fill':
      if (event.redacted) {
        return `// ReproFlow: the value typed into ${literal(event.selector)} was redacted during recording.`;
      }
      return `await ${locator(event.locator, event.selector)}.fill(${literal(event.value)});`;
    case 'click':
      return `await ${locator(event.locator, event.selector)}.click();`;
    case 'select':
      return `await ${locator(event.locator, event.selector)}.selectOption(${literal(event.value)});`;
    case 'check':
      return `await ${locator(event.locator, event.selector)}.${event.checked ? 'check' : 'uncheck'}();`;
    case 'submit':
      return `await ${locator(event.locator, event.selector)}.evaluate((form) => (form as HTMLFormElement).requestSubmit());`;
  }
}

function buildSteps(events: RecordedEvent[]): string[] {
  const actions = events.filter(isAction);
  const steps: string[] = [];
  for (let index = 0; index < actions.length; index += 1) {
    const event = actions[index];
    // GEN-7: a run of fills on one element collapses to its final value.
    const next = actions[index + 1];
    if (event.type === 'fill' && next?.type === 'fill' && next.selector === event.selector) continue;
    steps.push(stepFor(event));
  }
  return steps;
}

/** The assertion encodes the behaviour the bug broke, so it fails when the bug reproduces. */
function buildAssertion(failure: FailureSignature): string[] {
  const poll = `{ timeout: ${ASSERTION_TIMEOUT_MS} }`;
  switch (failure.kind) {
    case 'console-error':
      return [
        '// The recorded failure was an uncaught page error.',
        `await expect.poll(() => reproflowConsoleErrors, ${poll}).not.toContain(${literal(failure.value)});`,
      ];
    case 'http-status':
      return [
        '// The recorded failure was a failed HTTP response.',
        `await expect.poll(() => reproflowHttpFailures, ${poll}).not.toContain(${literal(failure.value)});`,
      ];
    case 'visible-text':
      return [
        '// The recorded failure was error text the app showed the user.',
        `await expect(page.getByText(${literal(failure.value)})).toBeHidden({ timeout: ${ASSERTION_TIMEOUT_MS} });`,
      ];
    case 'url':
      return [
        '// The recorded failure was the URL the app ended up on.',
        `await expect(page).not.toHaveURL(${literal(failure.value)});`,
      ];
  }
}

function buildBody(input: GeneratorInput, failure: FailureSignature, steps: readonly string[]): string {
  const lines: string[] = [
    "import { expect, test } from '@playwright/test';",
    '',
    `test(${literal(`ReproFlow: recorded bug on ${input.startUrl}`)}, async ({ page }) => {`,
    '  const reproflowConsoleErrors: string[] = [];',
    '  const reproflowHttpFailures: string[] = [];',
    '',
    "  page.on('console', (message) => {",
    "    if (message.type() === 'error') reproflowConsoleErrors.push(message.text());",
    '  });',
    "  page.on('pageerror', (error) => {",
    '    reproflowConsoleErrors.push(error.message);',
    '  });',
    "  page.on('requestfailed', (request) => {",
    '    reproflowHttpFailures.push(`${request.method()} 0 ${request.url()}`);',
    '  });',
    "  page.on('response', (response) => {",
    '    if (response.status() >= 400) reproflowHttpFailures.push(`${response.request().method()} ${response.status()} ${response.url()}`);',
    '  });',
    '',
    `  await page.goto(${literal(input.startUrl)});`,
    '',
  ];
  for (const step of steps) lines.push(`  ${step}`);
  if (steps.length > 0) lines.push('');
  for (const assertion of buildAssertion(failure)) lines.push(`  ${assertion}`);
  lines.push('});', '');
  return lines.join('\n');
}

const COMPILER_OPTIONS: ts.CompilerOptions = {
  noEmit: true,
  noResolve: true,
  skipLibCheck: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
};

/** GEN-5: every generated file must parse cleanly before it reaches the runner. */
export function validateSpecSource(source: string, fileName: string = SPEC_FILE_NAME): string[] {
  const files = new Map<string, string>([[fileName, source]]);
  const host: ts.CompilerHost = {
    fileExists: (name) => files.has(name),
    readFile: (name) => files.get(name),
    getSourceFile: (name) => {
      const text = files.get(name);
      if (text === undefined) return undefined;
      return ts.createSourceFile(name, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    },
    getDefaultLibFileName: () => 'lib.es2022.d.ts',
    writeFile: () => undefined,
    getCurrentDirectory: () => '/',
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  };
  const program = ts.createProgram([fileName], COMPILER_OPTIONS, host);
  return program
    .getSyntacticDiagnostics()
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '));
}

/** Deterministic: the same session always produces the same bytes. */
export async function generateSpec(input: GeneratorInput): Promise<GeneratedSpec> {
  const events = [...input.events].sort(bySeq);
  const failure = detectFailure(events, input.startUrl);
  const body = buildBody(input, failure, buildSteps(events));

  const diagnostics = validateSpecSource(body);
  if (diagnostics.length > 0) {
    throw new Error(`ReproFlow generated an invalid spec: ${diagnostics.join('; ')}`);
  }

  const header = await writeSpecHeader(body, failure.value);
  return { fileName: SPEC_FILE_NAME, source: `${header}\n${body}`, failure };
}
