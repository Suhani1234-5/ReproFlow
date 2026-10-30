import { Octokit } from 'octokit';
import type { ReproReport, VerificationResult } from '@shared/report';
import { SPEC_FILE_NAME } from '@shared/spec';
import { SCREENSHOT_DIR, screenshotFileName } from './report';

/** GH-1: OAuth device flow. A GitHub App is the preferred long-term connection. */
export const GITHUB_HOST = 'https://github.com';
export const DEVICE_CODE_PATH = '/login/device/code';
export const ACCESS_TOKEN_PATH = '/login/oauth/access_token';
/** Device flow cannot scope to a repository, so `repo` is needed for private repositories. */
export const GITHUB_SCOPES = ['repo'];
export const GITHUB_ORIGINS = ['https://api.github.com/*', 'https://github.com/*'];

export const BRANCH_PREFIX = 'reproflow/';
export const ATTACHMENT_DIR = '.reproflow';

export const BASE_LABELS = ['bug', 'reproflow'];
const LABEL_COLORS: Record<string, string> = {
  bug: 'd73a4a',
  reproflow: '1d76db',
  reproduced: '0e8a16',
  'needs-triage': 'fbca04',
};

const RESULT_LABELS: Record<VerificationResult, string> = {
  reproduced: 'Reproduced',
  'not-reproduced': 'Not reproduced',
  'different-failure': 'Different failure',
  'infrastructure-error': 'Infrastructure error',
};

const TOKEN_KEY = 'reproflow:github-token';
const DEVICE_KEY = 'reproflow:github-device';
const SETTINGS_KEY = 'reproflow:github-settings';

export const FINGERPRINT_PATTERN = /<!--\s*reproflow:fingerprint=([0-9a-f]{64})\s*-->/;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/* ------------------------------------------------------------------ client */

/**
 * GH-*: every call below goes through `GitHubClient`, so tests can drive the flow
 * without a network and the routes stay explicit.
 */
export interface GitHubClient {
  request: (route: string, parameters?: Record<string, unknown>) => Promise<{ data: unknown }>;
}

export function createClient(token: string): GitHubClient {
  // Octokit's `request` is overloaded per route; the narrow shape is all this module uses.
  return new Octokit({ auth: token }) as unknown as GitHubClient;
}

/* ------------------------------------------------------------------- auth */

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** Seconds until the code expires. */
  expiresIn: number;
  /** Seconds the caller must wait between polls. */
  interval: number;
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

function clientId(): string {
  const id = import.meta.env.VITE_GITHUB_CLIENT_ID as string | undefined;
  if (!id) throw new Error('ReproFlow has no GitHub client id. Set VITE_GITHUB_CLIENT_ID.');
  return id;
}

export async function startDeviceFlow(fetchImpl: typeof fetch = fetch): Promise<DeviceCode> {
  const response = await fetchImpl(`${GITHUB_HOST}${DEVICE_CODE_PATH}`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId(), scope: GITHUB_SCOPES.join(' ') }),
  });
  if (!response.ok) throw new Error(`GitHub refused the device flow (${response.status}).`);
  const data = (await response.json()) as DeviceCodeResponse;
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in,
    interval: data.interval,
  };
}

export type DeviceFlowStatus = 'pending' | 'slow_down' | 'granted' | 'denied' | 'expired';

export interface DeviceFlowPoll {
  status: DeviceFlowStatus;
  token?: string;
}

/** One poll. The service worker is restarted freely, so polling is a single round trip. */
export async function requestAccessToken(
  deviceCode: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DeviceFlowPoll> {
  const response = await fetchImpl(`${GITHUB_HOST}${ACCESS_TOKEN_PATH}`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId(),
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  });
  if (!response.ok) throw new Error(`GitHub refused the token request (${response.status}).`);
  const data = (await response.json()) as TokenResponse;
  if (typeof data.access_token === 'string') return { status: 'granted', token: data.access_token };
  switch (data.error) {
    case 'slow_down':
      return { status: 'slow_down' };
    case 'access_denied':
      return { status: 'denied' };
    case 'expired_token':
      return { status: 'expired' };
    default:
      return { status: 'pending' };
  }
}

export interface PollOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export async function awaitAccessToken(device: DeviceCode, options: PollOptions = {}): Promise<string> {
  const wait = options.sleep ?? sleep;
  const deadline = Date.now() + device.expiresIn * 1000;
  let interval = device.interval;

  while (Date.now() < deadline) {
    await wait(interval * 1000);
    const poll = await requestAccessToken(device.deviceCode, options.fetchImpl);
    if (poll.status === 'granted' && poll.token !== undefined) return poll.token;
    if (poll.status === 'denied') throw new Error('The GitHub authorization was denied.');
    if (poll.status === 'expired') break;
    if (poll.status === 'slow_down') interval += 5;
  }
  throw new Error('The GitHub device code expired before it was authorized.');
}

/* ---------------------------------------------------------------- storage */

export async function saveToken(token: string): Promise<void> {
  await chrome.storage.session.set({ [TOKEN_KEY]: token });
}

export async function loadToken(): Promise<string | undefined> {
  const stored = (await chrome.storage.session.get(TOKEN_KEY))[TOKEN_KEY];
  return typeof stored === 'string' ? stored : undefined;
}

export async function isConnected(): Promise<boolean> {
  return (await loadToken()) !== undefined;
}

/** The popup can close while the user authorizes, so the pending code survives a restart. */
export async function saveDeviceCode(device: DeviceCode): Promise<void> {
  await chrome.storage.session.set({ [DEVICE_KEY]: device });
}

export async function loadDeviceCode(): Promise<DeviceCode | undefined> {
  const stored = (await chrome.storage.session.get(DEVICE_KEY))[DEVICE_KEY];
  return typeof stored === 'object' && stored !== null ? (stored as DeviceCode) : undefined;
}

export async function clearDeviceCode(): Promise<void> {
  await chrome.storage.session.remove(DEVICE_KEY);
}

/** GH: disconnecting deletes the credential; nothing else is touched. */
export async function disconnect(): Promise<void> {
  await chrome.storage.session.remove([TOKEN_KEY, DEVICE_KEY]);
}

export interface GitHubRepo {
  owner: string;
  name: string;
  fullName: string;
  isPrivate: boolean;
  defaultBranch: string;
}

export interface GitHubSettings {
  /** GH-3: the picker's default, overridable per report. */
  defaultRepo?: GitHubRepo;
  /** GH-4: off unless the user turns it on. */
  autoCreate: boolean;
}

export const DEFAULT_SETTINGS: GitHubSettings = { autoCreate: false };

export async function getSettings(): Promise<GitHubSettings> {
  const stored = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
  if (typeof stored !== 'object' || stored === null) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...(stored as Partial<GitHubSettings>) };
}

export async function saveSettings(patch: Partial<GitHubSettings>): Promise<GitHubSettings> {
  const settings = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  return settings;
}

/** Requested from a user gesture in the popup, never in the background. */
export async function requestGitHubAccess(): Promise<boolean> {
  return chrome.permissions.request({ origins: GITHUB_ORIGINS });
}

/* ------------------------------------------------------------------ repos */

interface RepoResponse {
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  owner: { login: string };
}

function toRepo(response: RepoResponse): GitHubRepo {
  return {
    owner: response.owner.login,
    name: response.name,
    fullName: response.full_name,
    isPrivate: response.private,
    defaultBranch: response.default_branch,
  };
}

export async function listRepos(client: GitHubClient): Promise<GitHubRepo[]> {
  const { data } = await client.request('GET /user/repos', {
    per_page: 100,
    sort: 'pushed',
    affiliation: 'owner,collaborator,organization_member',
  });
  return (data as RepoResponse[]).map(toRepo);
}

/* ----------------------------------------------------------- duplicates */

interface IssueResponse {
  number: number;
  html_url: string;
  body?: string | null;
  pull_request?: unknown;
}

export interface ExistingIssue {
  number: number;
  url: string;
}

export function fingerprintMarker(fingerprint: string): string {
  return `<!-- reproflow:fingerprint=${fingerprint} -->`;
}

export function issueUrl(repo: GitHubRepo, issueNumber: number): string {
  return `${GITHUB_HOST}/${repo.fullName}/issues/${issueNumber}`;
}

/** GH-8: an open issue that already carries this fingerprint makes the report a duplicate. */
export async function findIssueByFingerprint(
  client: GitHubClient,
  repo: GitHubRepo,
  fingerprint: string,
): Promise<ExistingIssue | undefined> {
  const { data } = await client.request('GET /repos/{owner}/{repo}/issues', {
    owner: repo.owner,
    repo: repo.name,
    state: 'open',
    labels: 'reproflow',
    per_page: 100,
  });
  const issues = (data as IssueResponse[]).filter((issue) => issue.pull_request === undefined);
  const match = issues.find((issue) => FINGERPRINT_PATTERN.exec(issue.body ?? '')?.[1] === fingerprint);
  return match ? { number: match.number, url: match.html_url } : undefined;
}

/* --------------------------------------------------------- attachments */

export function branchFor(reportId: string): string {
  return `${BRANCH_PREFIX}${reportId}`;
}

export function attachmentPath(reportId: string, name: string): string {
  return `${ATTACHMENT_DIR}/${reportId}/${name}`;
}

/** Branch names may contain slashes; GitHub resolves the ref from the left. */
export function blobUrl(repo: GitHubRepo, branch: string, path: string): string {
  return `${GITHUB_HOST}/${repo.fullName}/blob/${branch}/${path}`;
}

export function rawUrl(repo: GitHubRepo, branch: string, path: string): string {
  return `https://raw.githubusercontent.com/${repo.fullName}/${branch}/${path}`;
}

export interface AttachedFile {
  path: string;
  url: string;
}

export interface AttachmentPlan {
  /** `details` means Contents write was unavailable and the test travels in the body. */
  mode: 'contents' | 'details';
  branch: string;
  spec?: AttachedFile;
  screenshots: AttachedFile[];
  error?: string;
}

/** The links the issue body will use, known before anything is uploaded (GH-5 preview). */
export function projectedPlan(report: ReproReport, repo: GitHubRepo, mode: 'contents' | 'details'): AttachmentPlan {
  const branch = branchFor(report.id);
  if (mode === 'details') return { mode, branch, screenshots: [] };
  const specPath = attachmentPath(report.id, SPEC_FILE_NAME);
  return {
    mode,
    branch,
    spec: { path: specPath, url: blobUrl(repo, branch, specPath) },
    screenshots: report.screenshots.map((screenshot) => {
      const path = attachmentPath(report.id, `${SCREENSHOT_DIR}/${screenshotFileName(screenshot)}`);
      return { path, url: rawUrl(repo, branch, path) };
    }),
  };
}

interface AttachmentUpload {
  path: string;
  /** The Contents API takes base64. */
  content: string;
}

/** Screenshots arrive as data URLs, which are already base64. */
function base64Of(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma === -1 ? '' : dataUrl.slice(comma + 1);
}

function encodeBase64(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function uploadsFor(report: ReproReport): AttachmentUpload[] {
  const uploads: AttachmentUpload[] = [
    { path: attachmentPath(report.id, SPEC_FILE_NAME), content: encodeBase64(report.testFile) },
  ];
  for (const screenshot of report.screenshots) {
    uploads.push({
      path: attachmentPath(report.id, `${SCREENSHOT_DIR}/${screenshotFileName(screenshot)}`),
      content: base64Of(screenshot.dataUrl),
    });
  }
  return uploads;
}

const PERMISSION_STATUS = new Set([403, 404]);

async function baseBranchSha(client: GitHubClient, repo: GitHubRepo): Promise<string> {
  const { data } = await client.request('GET /repos/{owner}/{repo}/branches/{branch}', {
    owner: repo.owner,
    repo: repo.name,
    branch: repo.defaultBranch,
  });
  return (data as { commit: { sha: string } }).commit.sha;
}

async function ensureBranch(client: GitHubClient, repo: GitHubRepo, branch: string, sha: string): Promise<void> {
  try {
    await client.request('POST /repos/{owner}/{repo}/git/refs', {
      owner: repo.owner,
      repo: repo.name,
      ref: `refs/heads/${branch}`,
      sha,
    });
  } catch (error) {
    // Re-sending a report reuses its branch rather than failing (GH-10).
    if (statusOf(error) !== 422) throw error;
  }
}

async function existingFileSha(
  client: GitHubClient,
  repo: GitHubRepo,
  branch: string,
  path: string,
): Promise<string | undefined> {
  try {
    const { data } = await client.request('GET /repos/{owner}/{repo}/contents/{path}', {
      owner: repo.owner,
      repo: repo.name,
      path,
      ref: branch,
    });
    if (Array.isArray(data)) return undefined;
    return (data as { sha?: string }).sha;
  } catch (error) {
    if (statusOf(error) === 404) return undefined;
    throw error;
  }
}

/**
 * GH-2: commit the test and screenshots to a dedicated branch.
 * Without Contents write the plan degrades to `details` and the body carries the test.
 */
export async function publishAttachments(
  client: GitHubClient,
  report: ReproReport,
  repo: GitHubRepo,
): Promise<AttachmentPlan> {
  const plan = projectedPlan(report, repo, 'contents');
  const branch = plan.branch;
  try {
    await ensureBranch(client, repo, branch, await baseBranchSha(client, repo));
    for (const upload of uploadsFor(report)) {
      const sha = await existingFileSha(client, repo, branch, upload.path);
      await client.request('PUT /repos/{owner}/{repo}/contents/{path}', {
        owner: repo.owner,
        repo: repo.name,
        path: upload.path,
        branch,
        message: `ReproFlow: add reproduction for ${report.id}`,
        content: upload.content,
        ...(sha === undefined ? {} : { sha }),
      });
    }
    return plan;
  } catch (error) {
    if (!PERMISSION_STATUS.has(statusOf(error) ?? 0)) throw error;
    return { ...projectedPlan(report, repo, 'details'), error: messageOf(error) };
  }
}

/* ------------------------------------------------------------- issue body */

function bullets(lines: string[], values: string[]): void {
  for (const value of values) lines.push(`- ${value}`);
}

/** GH-5/PRD 7.3: the exact body that will be posted, built from the redacted report only. */
export function buildIssueBody(report: ReproReport, plan: AttachmentPlan): string {
  const lines: string[] = ['## Summary', report.summary, '', '## Expected / Actual'];
  bullets(lines, [`Expected: ${report.expected}`, `Actual: ${report.actual}`]);

  lines.push('', '## Steps to Reproduce');
  report.steps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
  if (report.steps.length === 0) lines.push('1. No interactions were recorded.');

  const verification = report.verification;
  lines.push(
    '',
    '## Verification',
    verification
      ? `Result: ${RESULT_LABELS[verification.result]} (${verification.failures} of ${verification.runs} runs)`
      : 'Result: not verified',
    `Failure: \`${report.failureAssertion || verification?.message || 'unknown'}\``,
  );

  lines.push('', '## Evidence');
  if (plan.screenshots.length === 0) {
    lines.push('Screenshots could not be attached to the repository. Attach the exported ZIP to this issue.');
  } else {
    for (const screenshot of plan.screenshots) lines.push(`### ${screenshot.path}`, '', `![${screenshot.path}](${screenshot.url})`, '');
  }

  lines.push('', '## Reproduction Test');
  if (plan.spec === undefined) {
    lines.push('Contents write was not granted, so the test is inline below. Attach the exported ZIP for screenshots.');
  } else {
    lines.push(`[${SPEC_FILE_NAME}](${plan.spec.url})`);
  }
  lines.push('', '<details><summary>reproduction.spec.ts</summary>', '', '```ts', report.testFile, '```', '', '</details>');

  const environment = report.environment;
  lines.push(
    '',
    '## Environment',
    `Browser: ${environment.browser}`,
    `OS: ${environment.os}`,
    `Viewport: ${environment.viewport}`,
    `URL: ${environment.url}`,
    `ReproFlow: ${environment.extensionVersion}`,
    '',
    fingerprintMarker(report.fingerprint),
  );

  return lines.join('\n');
}

export interface IssuePreview {
  repository: string;
  title: string;
  body: string;
  labels: string[];
  fingerprint: string;
  /** GH-4.4: public repositories expose screenshots, URLs and stack traces to everyone. */
  publicWarning: boolean;
}

export function labelsFor(report: ReproReport): string[] {
  return [...BASE_LABELS, report.verification?.result === 'reproduced' ? 'reproduced' : 'needs-triage'];
}

export function previewIssue(
  report: ReproReport,
  repo: GitHubRepo,
  mode: 'contents' | 'details' = 'contents',
): IssuePreview {
  return {
    repository: repo.fullName,
    title: report.title,
    body: buildIssueBody(report, projectedPlan(report, repo, mode)),
    labels: labelsFor(report),
    fingerprint: report.fingerprint,
    publicWarning: !repo.isPrivate,
  };
}

/** GH-4: automatic creation is opt-in and only for a verified reproduction. */
export function shouldAutoCreate(report: ReproReport, settings: GitHubSettings): boolean {
  return settings.autoCreate && report.verification?.result === 'reproduced';
}

/* ---------------------------------------------------------------- retries */

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_DELAY_MS = 60_000;

/** A 403 is a rate limit only when the budget is gone; otherwise it is a permission error. */
function retryDelayMs(error: unknown, fallbackMs: number): number | undefined {
  const status = statusOf(error);
  if (status === undefined) return undefined;
  const headers = ((error as { response?: { headers?: Record<string, string> } }).response?.headers ?? {}) as Record<
    string,
    string
  >;
  if (status === 403) {
    if (headers['x-ratelimit-remaining'] !== '0' && headers['retry-after'] === undefined) return undefined;
  } else if (!RETRYABLE_STATUS.has(status)) {
    return undefined;
  }
  const retryAfter = Number(headers['retry-after']);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, MAX_DELAY_MS);
  const reset = Number(headers['x-ratelimit-reset']);
  if (Number.isFinite(reset) && reset > 0) return Math.min(Math.max(reset * 1000 - Date.now(), 0), MAX_DELAY_MS);
  return fallbackMs;
}

/** GH-10: exponential backoff while rate limited, never on a permission error. */
export async function withRateLimitRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const wait = options.sleep ?? sleep;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const delay = retryDelayMs(error, baseDelayMs * 2 ** (attempt - 1));
      if (delay === undefined || attempt === attempts) throw error;
      await wait(delay);
    }
  }
  throw lastError;
}

/* ------------------------------------------------------------- submission */

export async function ensureLabels(client: GitHubClient, repo: GitHubRepo, labels: string[]): Promise<void> {
  for (const label of labels) {
    try {
      await client.request('POST /repos/{owner}/{repo}/labels', {
        owner: repo.owner,
        repo: repo.name,
        name: label,
        color: LABEL_COLORS[label] ?? 'ededed',
      });
    } catch {
      // GH-6: the label already exists, or creating labels is not permitted. Either is fine.
    }
  }
}

export interface IssueRequest {
  repo: GitHubRepo;
  title: string;
  body: string;
  labels: string[];
}

export async function createIssue(
  client: GitHubClient,
  request: IssueRequest,
  options: RetryOptions & { fingerprint?: string } = {},
): Promise<ExistingIssue> {
  if (options.fingerprint !== undefined) {
    // GH-10: a retry after a partial failure must not open a second issue.
    const existing = await findIssueByFingerprint(client, request.repo, options.fingerprint);
    if (existing !== undefined) return existing;
  }
  const { data } = await withRateLimitRetry(
    () =>
      client.request('POST /repos/{owner}/{repo}/issues', {
        owner: request.repo.owner,
        repo: request.repo.name,
        title: request.title,
        body: request.body,
        labels: request.labels,
      }),
    options,
  );
  const issue = data as IssueResponse;
  return { number: issue.number, url: issue.html_url };
}

export type SubmissionResult =
  | { kind: 'duplicate'; issue: ExistingIssue }
  | { kind: 'created'; issue: ExistingIssue; attachments: AttachmentPlan; preview: IssuePreview };

/** GH-8/GH-10: duplicate first, then attachments, then at most one issue. */
export async function submitReport(
  client: GitHubClient,
  report: ReproReport,
  repo: GitHubRepo,
  options: RetryOptions = {},
): Promise<SubmissionResult> {
  const existing = await findIssueByFingerprint(client, repo, report.fingerprint);
  if (existing !== undefined) return { kind: 'duplicate', issue: existing };

  const attachments = await publishAttachments(client, report, repo);
  const preview = previewIssue(report, repo, attachments.mode);
  await ensureLabels(client, repo, preview.labels);

  const issue = await createIssue(
    client,
    { repo, title: preview.title, body: buildIssueBody(report, attachments), labels: preview.labels },
    { ...options, fingerprint: report.fingerprint },
  );
  return { kind: 'created', issue, attachments, preview };
}

/** GH-8: the alternative to opening a second issue. */
export async function commentExistingReport(
  client: GitHubClient,
  report: ReproReport,
  repo: GitHubRepo,
  issueNumber: number,
  options: RetryOptions = {},
): Promise<ExistingIssue> {
  const body = buildIssueBody(report, projectedPlan(report, repo, 'details'));
  await withRateLimitRetry(
    () =>
      client.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
        owner: repo.owner,
        repo: repo.name,
        issue_number: issueNumber,
        body,
      }),
    options,
  );
  return { number: issueNumber, url: issueUrl(repo, issueNumber) };
}
