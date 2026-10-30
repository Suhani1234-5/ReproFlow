import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { chromium, type Browser, type Page } from 'playwright';
import type { SpecHeader } from '../../shared/src/spec.ts';
import { registeredTests, resetRegistry, type RegisteredTest } from './harness.ts';

export type VerifyResult =
  | 'reproduced'
  | 'not_reproduced'
  | 'different_failure'
  | 'infrastructure_error';

export interface VerificationOutcome {
  result: VerifyResult;
  runs: number;
  /** The failing assertion, verbatim, when the replay failed. */
  assertion?: string;
  /** PNG data URL of the last failed run. */
  screenshot?: string;
  message: string;
}

const MAX_RUNS = 3;
const RUN_TIMEOUT_MS = 30_000;
const PLAYWRIGHT_SPECIFIER = "from '@playwright/test'";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The spec is signature verified before it gets here, so the single import rewrite
 * (pointing `@playwright/test` at the in-process harness) cannot be abused.
 */
function toExecutableModule(specSource: string): string {
  if (!specSource.includes(PLAYWRIGHT_SPECIFIER)) {
    throw new Error('the spec does not import @playwright/test');
  }
  const harness = new URL('./harness.ts', import.meta.url).href;
  const rewritten = specSource.replace(PLAYWRIGHT_SPECIFIER, `from ${JSON.stringify(harness)}`);
  return ts.transpileModule(rewritten, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
}

async function withTimeout(run: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`the replay did not finish within ${ms}ms`));
    }, ms);
  });
  try {
    await Promise.race([run, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function screenshotOf(page: Page): Promise<string | undefined> {
  try {
    const buffer = await page.screenshot({ type: 'png' });
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch {
    return undefined;
  }
}

async function replay(
  browser: Browser,
  tests: readonly RegisteredTest[],
  failureToken: string,
): Promise<VerificationOutcome> {
  let runs = 0;
  let assertion: string | undefined;
  let screenshot: string | undefined;
  let sawFailure = false;

  for (let run = 1; run <= MAX_RUNS; run += 1) {
    runs = run;
    // A fresh context per run: cookies, storage and service workers never carry over.
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      for (const current of tests) {
        await withTimeout(Promise.resolve(current.body({ browser, context, page })), RUN_TIMEOUT_MS);
      }
    } catch (error) {
      sawFailure = true;
      assertion = messageOf(error);
      screenshot = await screenshotOf(page);
      if (assertion.includes(failureToken)) {
        return { result: 'reproduced', runs, assertion, screenshot, message: 'the recorded failure reproduced' };
      }
    } finally {
      await context.close();
    }
  }

  if (!sawFailure) {
    return { result: 'not_reproduced', runs, message: 'the replay passed on every run' };
  }
  return {
    result: 'different_failure',
    runs,
    assertion,
    screenshot,
    message: 'the replay failed for a different reason',
  };
}

/** Runs a signed spec in isolated contexts, up to `MAX_RUNS` times. */
export async function verifySpec(specSource: string, header: SpecHeader): Promise<VerificationOutcome> {
  const workspace = await mkdtemp(join(tmpdir(), 'reproflow-'));
  try {
    const file = join(workspace, 'reproduction.spec.mjs');
    await writeFile(file, toExecutableModule(specSource), 'utf8');

    resetRegistry();
    await import(pathToFileURL(file).href);
    const tests = [...registeredTests()];
    if (tests.length === 0) {
      return { result: 'infrastructure_error', runs: 0, message: 'the spec registered no tests' };
    }

    const browser = await chromium.launch();
    try {
      return await replay(browser, tests, header.failure);
    } finally {
      await browser.close();
    }
  } catch (error) {
    return { result: 'infrastructure_error', runs: 0, message: messageOf(error) };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
