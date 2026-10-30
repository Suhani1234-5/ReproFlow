import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReport, type ReproReport, type Verification } from '@shared/report';
import { SPEC_FILE_NAME, SPEC_HEADER_PREFIX } from '@shared/spec';
import type { Screenshot } from '@shared/types';
import {
  BASE_LABELS,
  branchFor,
  buildIssueBody,
  clearDeviceCode,
  commentExistingReport,
  createClient,
  createIssue,
  disconnect,
  findIssueByFingerprint,
  fingerprintMarker,
  getSettings,
  isConnected,
  labelsFor,
  listRepos,
  loadDeviceCode,
  loadToken,
  projectedPlan,
  previewIssue,
  publishAttachments,
  requestAccessToken,
  awaitAccessToken,
  saveDeviceCode,
  saveSettings,
  saveToken,
  shouldAutoCreate,
  startDeviceFlow,
  submitReport,
  type DeviceCode,
  type GitHubClient,
  type GitHubRepo,
} from './github';

/** One mocked Octokit: every route answers from `responses`, and `failures` throw once. */
const harness = vi.hoisted(() => {
  const calls: Array<{ route: string; params: Record<string, unknown> }> = [];
  const responses = new Map<string, unknown>();
  const failures = new Map<string, unknown>();
  class FakeOctokit {
    readonly options: Record<string, unknown>;
    constructor(options: Record<string, unknown> = {}) {
      this.options = options;
    }
    request = async (route: string, params: Record<string, unknown> = {}): Promise<{ data: unknown }> => {
      calls.push({ route, params });
      const failure = failures.get(route);
      if (failure !== undefined) {
        failures.delete(route);
        throw failure;
      }
      if (!responses.has(route)) throw Object.assign(new Error(`unstubbed route ${route}`), { status: 404 });
      return { data: responses.get(route) };
    };
  }
  return { calls, responses, failures, FakeOctokit };
});

vi.mock('octokit', () => ({ Octokit: harness.FakeOctokit }));

const sessionStore = new Map<string, unknown>();
const localStore = new Map<string, unknown>();

function area(store: Map<string, unknown>) {
  return {
    set: async (items: Record<string, unknown>): Promise<void> => {
      for (const [key, value] of Object.entries(items)) store.set(key, value);
    },
    get: async (key: string): Promise<Record<string, unknown>> => (store.has(key) ? { [key]: store.get(key) } : {}),
    remove: async (keys: string | string[]): Promise<void> => {
      for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
    },
  };
}

const REPO: GitHubRepo = {
  owner: 'acme',
  name: 'shop',
  fullName: 'acme/shop',
  isPrivate: true,
  defaultBranch: 'main',
};

const PUBLIC_REPO: GitHubRepo = { ...REPO, name: 'docs', fullName: 'acme/docs', isPrivate: false };
const FINGERPRINT = 'f'.repeat(64);

const screenshot: Screenshot = {
  id: 'shot-1',
  sessionId: 'session-1',
  label: 'stop',
  url: 'https://shop.example.com/checkout',
  ts: 1_700_000_010_000,
  dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
};

function reportFixture(overrides: { verification?: Verification; screenshots?: Screenshot[] } = {}): ReproReport {
  return createReport({
    id: 'report-1',
    sessionId: 'session-1',
    title: 'Checkout fails with a 500',
    summary: 'Paying with a saved card returns a 500.',
    expected: 'The order is placed.',
    actual: 'POST /api/pay returns 500.',
    steps: ['Type "qa@example.com" into "Email"', 'Click "Pay now"'],
    failureAssertion: 'POST 500 https://shop.example.com/api/pay',
    environment: {
      browser: 'Chrome 131',
      os: 'Windows 11',
      viewport: '1280x720',
      url: 'https://shop.example.com/checkout',
      extensionVersion: '0.1.0',
    },
    // An explicit `verification: undefined` must stay undefined so the unverified case is testable.
    verification:
      'verification' in overrides
        ? overrides.verification
        : { result: 'reproduced', runs: 3, failures: 3, message: 'the recorded failure reproduced' },
    screenshots: overrides.screenshots ?? [screenshot],
    events: [],
    testFile: `${SPEC_HEADER_PREFIX} v1 sha256=${'0'.repeat(64)} failure=x\nimport { test } from '@playwright/test';\n`,
    fingerprint: FINGERPRINT,
  });
}

function stubFetch(...payloads: unknown[]): { fetchImpl: typeof fetch; calls: Array<{ url: string; body: URLSearchParams }> } {
  const calls: Array<{ url: string; body: URLSearchParams }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body as URLSearchParams });
    const payload = payloads.length > 1 ? payloads.shift() : payloads[0];
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function client(): GitHubClient {
  return createClient('token-1');
}

function noSleep(): { sleep: (ms: number) => Promise<void>; waits: number[] } {
  const waits: number[] = [];
  return {
    waits,
    sleep: async (ms: number): Promise<void> => {
      waits.push(ms);
    },
  };
}

function route(routeName: string): Array<{ route: string; params: Record<string, unknown> }> {
  return harness.calls.filter((call) => call.route === routeName);
}

const DEVICE: DeviceCode = {
  deviceCode: 'device-1',
  userCode: 'ABCD-1234',
  verificationUri: 'https://github.com/login/device',
  expiresIn: 900,
  interval: 5,
};

beforeEach(() => {
  harness.calls.length = 0;
  harness.responses.clear();
  harness.failures.clear();
  sessionStore.clear();
  localStore.clear();
  vi.stubGlobal('chrome', {
    storage: { session: area(sessionStore), local: area(localStore) },
    permissions: { request: async (): Promise<boolean> => true },
  });
  vi.stubEnv('VITE_GITHUB_CLIENT_ID', 'client-id');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('device flow', () => {
  it('starts the flow with the client id and the least privilege scope', async () => {
    const { fetchImpl, calls } = stubFetch({
      device_code: 'device-1',
      user_code: 'ABCD-1234',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900,
      interval: 5,
    });

    await expect(startDeviceFlow(fetchImpl)).resolves.toEqual(DEVICE);
    expect(calls[0]?.url).toBe('https://github.com/login/device/code');
    expect(calls[0]?.body.get('client_id')).toBe('client-id');
    expect(calls[0]?.body.get('scope')).toBe('repo');
  });

  it('maps every polling answer GitHub can give', async () => {
    await expect(requestAccessToken('device-1', stubFetch({ access_token: 'tok' }).fetchImpl)).resolves.toEqual({
      status: 'granted',
      token: 'tok',
    });
    await expect(requestAccessToken('device-1', stubFetch({ error: 'authorization_pending' }).fetchImpl)).resolves.toEqual({
      status: 'pending',
    });
    await expect(requestAccessToken('device-1', stubFetch({ error: 'access_denied' }).fetchImpl)).resolves.toEqual({
      status: 'denied',
    });
    await expect(requestAccessToken('device-1', stubFetch({ error: 'expired_token' }).fetchImpl)).resolves.toEqual({
      status: 'expired',
    });
  });

  it('waits out pending polls and honours slow_down', async () => {
    const { fetchImpl } = stubFetch({ error: 'authorization_pending' }, { access_token: 'tok' });
    const { sleep, waits } = noSleep();

    await expect(awaitAccessToken(DEVICE, { fetchImpl, sleep })).resolves.toBe('tok');
    expect(waits).toEqual([5000, 5000]);
  });

  it('backs off by five seconds when GitHub asks for it', async () => {
    const { fetchImpl } = stubFetch({ error: 'slow_down' }, { access_token: 'tok' });
    const { sleep, waits } = noSleep();

    await awaitAccessToken(DEVICE, { fetchImpl, sleep });
    expect(waits).toEqual([5000, 10000]);
  });

  it('fails when authorization is denied or the code expires', async () => {
    const { sleep } = noSleep();
    await expect(
      awaitAccessToken(DEVICE, { fetchImpl: stubFetch({ error: 'access_denied' }).fetchImpl, sleep }),
    ).rejects.toThrow('denied');
    await expect(
      awaitAccessToken(DEVICE, { fetchImpl: stubFetch({ error: 'expired_token' }).fetchImpl, sleep }),
    ).rejects.toThrow('expired');
  });
});

describe('credentials', () => {
  it('keeps the token in session storage and forgets it on disconnect', async () => {
    await expect(isConnected()).resolves.toBe(false);

    await saveToken('token-1');
    await expect(loadToken()).resolves.toBe('token-1');
    await expect(isConnected()).resolves.toBe(true);
    // The token lives in session storage, never in local storage or a report.
    expect(sessionStore.get('reproflow:github-token')).toBe('token-1');
    expect(localStore.size).toBe(0);

    await disconnect();
    await expect(loadToken()).resolves.toBeUndefined();
    await expect(isConnected()).resolves.toBe(false);
  });

  it('remembers the default repository but defaults auto-create to off', async () => {
    await expect(getSettings()).resolves.toEqual({ autoCreate: false });

    const settings = await saveSettings({ defaultRepo: REPO, autoCreate: true });
    expect(settings.defaultRepo).toEqual(REPO);
    await expect(getSettings()).resolves.toMatchObject({ autoCreate: true });
  });

  it('survives a closed popup by remembering the pending device code', async () => {
    const device: DeviceCode = {
      deviceCode: 'device-1',
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
      expiresIn: 900,
      interval: 5,
    };
    await expect(loadDeviceCode()).resolves.toBeUndefined();

    await saveDeviceCode(device);
    await expect(loadDeviceCode()).resolves.toEqual(device);

    await clearDeviceCode();
    await expect(loadDeviceCode()).resolves.toBeUndefined();

    // Disconnecting abandons a half-finished attempt as well as the credential.
    await saveDeviceCode(device);
    await saveToken('token-1');
    await disconnect();
    await expect(loadDeviceCode()).resolves.toBeUndefined();
    await expect(loadToken()).resolves.toBeUndefined();
  });
});

describe('repository picker', () => {
  it('maps the repositories a token can reach', async () => {
    harness.responses.set('GET /user/repos', [
      { name: 'shop', full_name: 'acme/shop', private: true, default_branch: 'main', owner: { login: 'acme' } },
    ]);

    await expect(listRepos(client())).resolves.toEqual([REPO]);
  });
});

describe('duplicate detection', () => {
  it('finds an open issue carrying the fingerprint and ignores the rest', async () => {
    harness.responses.set('GET /repos/{owner}/{repo}/issues', [
      { number: 4, html_url: 'https://github.com/acme/shop/issues/4', body: 'unrelated' },
      { number: 5, html_url: 'https://github.com/acme/shop/pull/5', body: fingerprintMarker(FINGERPRINT), pull_request: {} },
      { number: 7, html_url: 'https://github.com/acme/shop/issues/7', body: `Reported by ReproFlow.\n\n${fingerprintMarker(FINGERPRINT)}` },
    ]);

    await expect(findIssueByFingerprint(client(), REPO, FINGERPRINT)).resolves.toEqual({
      number: 7,
      url: 'https://github.com/acme/shop/issues/7',
    });
    await expect(findIssueByFingerprint(client(), REPO, 'a'.repeat(64))).resolves.toBeUndefined();
  });

  it('scopes the lookup to open issues of that repository', async () => {
    harness.responses.set('GET /repos/{owner}/{repo}/issues', []);
    await findIssueByFingerprint(client(), REPO, FINGERPRINT);
    expect(route('GET /repos/{owner}/{repo}/issues')[0]?.params).toMatchObject({
      owner: 'acme',
      repo: 'shop',
      state: 'open',
      labels: 'reproflow',
    });
  });
});

describe('issue preview', () => {
  it('renders every section the template requires', () => {
    const preview = previewIssue(reportFixture(), REPO);
    expect(preview.title).toBe('Checkout fails with a 500');
    expect(preview.body).toContain('## Summary');
    expect(preview.body).toContain('## Expected / Actual');
    expect(preview.body).toContain('- Expected: The order is placed.');
    expect(preview.body).toContain('## Steps to Reproduce');
    expect(preview.body).toContain('1. Type "qa@example.com" into "Email"');
    expect(preview.body).toContain('## Verification');
    expect(preview.body).toContain('Result: Reproduced (3 of 3 runs)');
    expect(preview.body).toContain('## Evidence');
    expect(preview.body).toContain('## Reproduction Test');
    expect(preview.body).toContain('## Environment');
    expect(preview.body).toContain(fingerprintMarker(FINGERPRINT));
  });

  it('labels a verified reproduction differently from anything else', () => {
    expect(previewIssue(reportFixture(), REPO).labels).toEqual([...BASE_LABELS, 'reproduced']);
    expect(
      labelsFor(reportFixture({ verification: { result: 'not-reproduced', runs: 3, failures: 0, message: 'passed' } })),
    ).toEqual([...BASE_LABELS, 'needs-triage']);
    expect(labelsFor(reportFixture({ verification: undefined }))).toEqual([...BASE_LABELS, 'needs-triage']);
  });

  it('warns before anything reaches a public repository', () => {
    expect(previewIssue(reportFixture(), PUBLIC_REPO).publicWarning).toBe(true);
    expect(previewIssue(reportFixture(), REPO).publicWarning).toBe(false);
  });

  it('links the test on the branch, and drops the link without Contents write', () => {
    const withContents = previewIssue(reportFixture(), REPO, 'contents');
    expect(withContents.body).toContain(
      `[${SPEC_FILE_NAME}](https://github.com/acme/shop/blob/reproflow/report-1/.reproflow/report-1/${SPEC_FILE_NAME})`,
    );

    const inline = previewIssue(reportFixture(), REPO, 'details');
    expect(inline.body).not.toContain('](');
    expect(inline.body).toContain('<details><summary>reproduction.spec.ts</summary>');
    expect(inline.body).toContain('Attach the exported ZIP');
  });

  it('only creates issues automatically when asked to and only for a reproduction', () => {
    const report = reportFixture();
    expect(shouldAutoCreate(report, { autoCreate: false })).toBe(false);
    expect(shouldAutoCreate(report, { autoCreate: true })).toBe(true);
    expect(
      shouldAutoCreate(reportFixture({ verification: { result: 'different-failure', runs: 3, failures: 1, message: 'x' } }), {
        autoCreate: true,
      }),
    ).toBe(false);
  });
});

describe('attachments', () => {
  function stubContentsWrite(): void {
    harness.responses.set('GET /repos/{owner}/{repo}/branches/{branch}', { commit: { sha: 'base-sha' } });
    harness.responses.set('POST /repos/{owner}/{repo}/git/refs', { ref: 'refs/heads/reproflow/report-1' });
    harness.responses.set('PUT /repos/{owner}/{repo}/contents/{path}', { content: {} });
  }

  it('commits the test and the screenshots to a dedicated branch', async () => {
    stubContentsWrite();
    const plan = await publishAttachments(client(), reportFixture(), REPO);

    expect(plan.mode).toBe('contents');
    expect(plan.branch).toBe('reproflow/report-1');
    expect(plan.spec?.path).toBe(`.reproflow/report-1/${SPEC_FILE_NAME}`);
    expect(plan.spec?.url).toBe(`https://github.com/acme/shop/blob/reproflow/report-1/.reproflow/report-1/${SPEC_FILE_NAME}`);
    expect(plan.screenshots).toEqual([
      {
        path: '.reproflow/report-1/screenshots/stop-shot-1.png',
        url: 'https://raw.githubusercontent.com/acme/shop/reproflow/report-1/.reproflow/report-1/screenshots/stop-shot-1.png',
      },
    ]);

    expect(route('POST /repos/{owner}/{repo}/git/refs')[0]?.params).toMatchObject({
      ref: 'refs/heads/reproflow/report-1',
      sha: 'base-sha',
    });

    const uploads = route('PUT /repos/{owner}/{repo}/contents/{path}');
    expect(uploads.map((call) => call.params.path)).toEqual([
      `.reproflow/report-1/${SPEC_FILE_NAME}`,
      '.reproflow/report-1/screenshots/stop-shot-1.png',
    ]);
    expect(Buffer.from(uploads[0]?.params.content as string, 'base64').toString('utf8')).toBe(reportFixture().testFile);
    expect(uploads[1]?.params.content).toBe('iVBORw0KGgo=');
    // A fresh file has no sha, so the Contents API creates rather than updates it.
    expect(uploads[0]?.params.sha).toBeUndefined();
  });

  it('reuses the branch and updates files that already exist', async () => {
    stubContentsWrite();
    harness.failures.set('POST /repos/{owner}/{repo}/git/refs', Object.assign(new Error('already exists'), { status: 422 }));
    harness.responses.set('GET /repos/{owner}/{repo}/contents/{path}', { sha: 'old-sha' });

    const plan = await publishAttachments(client(), reportFixture(), REPO);
    expect(plan.mode).toBe('contents');
    expect(route('PUT /repos/{owner}/{repo}/contents/{path}').every((call) => call.params.sha === 'old-sha')).toBe(true);
  });

  it('falls back to the issue body when Contents write is not granted', async () => {
    stubContentsWrite();
    harness.failures.set(
      'PUT /repos/{owner}/{repo}/contents/{path}',
      Object.assign(new Error('Resource not accessible by integration'), { status: 403 }),
    );

    const plan = await publishAttachments(client(), reportFixture(), REPO);
    expect(plan.mode).toBe('details');
    expect(plan.spec).toBeUndefined();
    expect(plan.screenshots).toEqual([]);
    expect(plan.error).toContain('not accessible');

    // The test still travels: inline, in the body.
    const body = buildIssueBody(reportFixture(), plan);
    expect(body).toContain('Contents write was not granted');
    expect(body).toContain(reportFixture().testFile);
  });

  it('never uploads a screenshot it has no bytes for', async () => {
    stubContentsWrite();
    const plan = await publishAttachments(client(), reportFixture({ screenshots: [] }), REPO);
    expect(plan.screenshots).toEqual([]);
    expect(route('PUT /repos/{owner}/{repo}/contents/{path}')).toHaveLength(1);
  });

  it('describes the plan before anything is uploaded', () => {
    const plan = projectedPlan(reportFixture(), REPO, 'contents');
    expect(plan.spec?.path).toBe(branchFor('report-1').replace('reproflow/', '.reproflow/') + `/${SPEC_FILE_NAME}`);
  });
});

describe('issue creation', () => {
  it('returns the existing issue instead of opening a duplicate', async () => {
    harness.responses.set('GET /repos/{owner}/{repo}/issues', [
      { number: 7, html_url: 'https://github.com/acme/shop/issues/7', body: fingerprintMarker(FINGERPRINT) },
    ]);

    const issue = await createIssue(
      client(),
      { repo: REPO, title: 't', body: 'b', labels: [] },
      { fingerprint: FINGERPRINT },
    );
    expect(issue.number).toBe(7);
    expect(route('POST /repos/{owner}/{repo}/issues')).toHaveLength(0);
  });

  it('retries with exponential backoff while rate limited', async () => {
    harness.responses.set('POST /repos/{owner}/{repo}/issues', { number: 9, html_url: 'https://github.com/acme/shop/issues/9' });
    harness.failures.set(
      'POST /repos/{owner}/{repo}/issues',
      Object.assign(new Error('API rate limit exceeded'), {
        status: 403,
        response: { headers: { 'x-ratelimit-remaining': '0', 'retry-after': '1' } },
      }),
    );
    const { sleep, waits } = noSleep();

    const issue = await createIssue(client(), { repo: REPO, title: 't', body: 'b', labels: [] }, { attempts: 3, sleep });
    expect(issue.number).toBe(9);
    expect(waits).toEqual([1000]);
    expect(route('POST /repos/{owner}/{repo}/issues')).toHaveLength(2);
  });

  it('does not retry a permission error', async () => {
    harness.failures.set(
      'POST /repos/{owner}/{repo}/issues',
      Object.assign(new Error('Issues are disabled for this repository'), { status: 403 }),
    );
    const { sleep, waits } = noSleep();

    await expect(
      createIssue(client(), { repo: REPO, title: 't', body: 'b', labels: [] }, { attempts: 3, sleep }),
    ).rejects.toThrow('Issues are disabled');
    expect(waits).toEqual([]);
    expect(route('POST /repos/{owner}/{repo}/issues')).toHaveLength(1);
  });

  it('creates the issue with labels, body and the fingerprint, creating missing labels first', async () => {
    harness.responses.set('GET /repos/{owner}/{repo}/branches/{branch}', { commit: { sha: 'base-sha' } });
    harness.responses.set('POST /repos/{owner}/{repo}/git/refs', {});
    harness.responses.set('PUT /repos/{owner}/{repo}/contents/{path}', {});
    harness.responses.set('GET /repos/{owner}/{repo}/issues', []);
    harness.responses.set('POST /repos/{owner}/{repo}/issues', { number: 12, html_url: 'https://github.com/acme/shop/issues/12' });

    const result = await submitReport(client(), reportFixture(), REPO);

    expect(result.kind).toBe('created');
    if (result.kind !== 'created') return;
    expect(result.issue).toEqual({ number: 12, url: 'https://github.com/acme/shop/issues/12' });
    expect(result.attachments.mode).toBe('contents');
    expect(result.preview.labels).toEqual([...BASE_LABELS, 'reproduced']);
    expect(route('POST /repos/{owner}/{repo}/labels').map((call) => call.params.name)).toEqual([...BASE_LABELS, 'reproduced']);

    const created = route('POST /repos/{owner}/{repo}/issues')[0]?.params;
    expect(created).toMatchObject({ owner: 'acme', repo: 'shop', labels: [...BASE_LABELS, 'reproduced'] });
    expect(created?.body as string).toContain(fingerprintMarker(FINGERPRINT));
  });

  it('offers the existing issue instead of creating anything', async () => {
    harness.responses.set('GET /repos/{owner}/{repo}/issues', [
      { number: 7, html_url: 'https://github.com/acme/shop/issues/7', body: fingerprintMarker(FINGERPRINT) },
    ]);

    await expect(submitReport(client(), reportFixture(), REPO)).resolves.toEqual({
      kind: 'duplicate',
      issue: { number: 7, url: 'https://github.com/acme/shop/issues/7' },
    });
    expect(route('PUT /repos/{owner}/{repo}/contents/{path}')).toHaveLength(0);
    expect(route('POST /repos/{owner}/{repo}/issues')).toHaveLength(0);
  });

  it('comments on the existing issue as the alternative', async () => {
    harness.responses.set('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', { id: 1 });

    await expect(commentExistingReport(client(), reportFixture(), REPO, 7)).resolves.toEqual({
      number: 7,
      url: 'https://github.com/acme/shop/issues/7',
    });
    const comment = route('POST /repos/{owner}/{repo}/issues/{issue_number}/comments')[0]?.params;
    expect(comment).toMatchObject({ owner: 'acme', repo: 'shop', issue_number: 7 });
    expect(comment?.body as string).toContain(fingerprintMarker(FINGERPRINT));
  });
});
