import type { RawEvent, Screenshot, ScreenshotLabel, Session } from '@shared/types';
import type { ReproReport } from '@shared/report';
import contentScript from '../content/index?script';
import { pageHook } from '../content/pageHook';
import { db, deleteSession, findRecordingSession, getReport, listSessions, saveReport } from '../lib/db';
import { recoverNextSeq, withSeq } from '../lib/events';
import {
  clearDeviceCode,
  commentExistingReport,
  createClient,
  disconnect,
  findIssueByFingerprint,
  getSettings,
  isConnected,
  listRepos,
  loadDeviceCode,
  loadToken,
  previewIssue,
  requestAccessToken,
  saveDeviceCode,
  saveSettings,
  saveToken,
  shouldAutoCreate,
  startDeviceFlow,
  submitReport,
  type GitHubRepo,
} from '../lib/github';
import {
  CHANNEL,
  type CaptureMessage,
  type GitHubStatusPayload,
  type PopupRequest,
  type PopupResponse,
  type StopCaptureMessage,
} from '../lib/messages';
import { buildReportForSession } from '../lib/pipeline';

/** Per-session sequence counters, rebuilt from IndexedDB after a worker restart. */
const nextSeq = new Map<string, number>();

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function nextSeqFor(sessionId: string): Promise<number> {
  const cached = nextSeq.get(sessionId);
  if (cached !== undefined) return cached;
  const stored = await db.events.where('sessionId').equals(sessionId).toArray();
  const next = recoverNextSeq(stored);
  nextSeq.set(sessionId, next);
  return next;
}

async function persistEvents(sessionId: string, events: RawEvent[]): Promise<void> {
  if (events.length === 0) return;
  const start = await nextSeqFor(sessionId);
  const rows = withSeq(sessionId, events, start);
  await db.events.bulkAdd(rows);
  nextSeq.set(sessionId, start + rows.length);
  await db.sessions.update(sessionId, { eventCount: start + rows.length });
}

async function takeScreenshot(sessionId: string, tabId: number, label: ScreenshotLabel): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    const screenshot: Screenshot = {
      id: crypto.randomUUID(),
      sessionId,
      label,
      url: tab.url ?? '',
      ts: Date.now(),
      dataUrl,
    };
    await db.screenshots.add(screenshot);
  } catch {
    // captureVisibleTab only works on the visible tab; evidence is best effort.
  }
}

async function injectRecorder(tabId: number): Promise<void> {
  const target = { tabId };
  // Recorder first so the page-world hook always has a listener for its signals.
  await chrome.scripting.executeScript({ target, files: [contentScript] });
  await chrome.scripting.executeScript({ target, world: 'MAIN', func: pageHook });
}

/** The report's Environment needs the viewport of the recorded tab, not of the popup. */
async function tabViewport(tabId: number): Promise<string | undefined> {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => `${window.innerWidth}x${window.innerHeight}`,
    });
    return injection?.result;
  } catch {
    return undefined;
  }
}

async function startRecording(tabId: number): Promise<Session> {
  const existing = await findRecordingSession(tabId);
  if (existing) return existing;

  const tab = await chrome.tabs.get(tabId);
  const session: Session = {
    id: crypto.randomUUID(),
    status: 'recording',
    startedAt: Date.now(),
    tabId,
    startUrl: tab.url ?? '',
    eventCount: 0,
    viewport: await tabViewport(tabId),
  };
  await db.sessions.add(session);
  await injectRecorder(tabId);
  await takeScreenshot(session.id, tabId, 'start');
  return session;
}

async function stopRecording(sessionId: string): Promise<Session | undefined> {
  const session = await db.sessions.get(sessionId);
  if (!session || session.status === 'stopped') return session;

  const message: StopCaptureMessage = { channel: CHANNEL, type: 'STOP_CAPTURE' };
  try {
    await chrome.tabs.sendMessage(session.tabId, message);
  } catch {
    // The tab navigated or closed; already-persisted events are unaffected.
  }

  await db.sessions.update(sessionId, { status: 'stopped', endedAt: Date.now() });
  await takeScreenshot(sessionId, session.tabId, 'stop');
  nextSeq.delete(sessionId);
  return db.sessions.get(sessionId);
}

/** Re-arms the recorder after a page load, since an injected script does not survive navigation. */
async function rearm(tabId: number): Promise<void> {
  const session = await findRecordingSession(tabId);
  if (!session) return;
  try {
    await injectRecorder(tabId);
    await takeScreenshot(session.id, tabId, 'navigation');
  } catch {
    // activeTab is revoked by a cross-origin navigation; re-injection is best effort.
  }
}

/* --------------------------------------------------------------- github */

async function requireToken(): Promise<string> {
  const token = await loadToken();
  if (token === undefined) throw new Error('Connect a GitHub account first.');
  return token;
}

/** GH-3: the per-report override wins, otherwise the configured default repository is used. */
async function reportAndRepo(reportId: string, override?: GitHubRepo): Promise<{ report: ReproReport; repo: GitHubRepo }> {
  const report = await getReport(reportId);
  if (report === undefined) throw new Error('Unknown report.');
  const repo = override ?? (await getSettings()).defaultRepo;
  if (repo === undefined) throw new Error('Choose a repository first.');
  return { report, repo };
}

async function githubStatus(): Promise<GitHubStatusPayload> {
  const settings = await getSettings();
  const token = await loadToken();
  if (token === undefined) return { connected: false, settings, repos: [] };
  try {
    return { connected: true, settings, repos: await listRepos(createClient(token)) };
  } catch (error) {
    // The credential is present but unusable; the popup must still be able to disconnect.
    return { connected: true, settings, repos: [], error: messageOf(error) };
  }
}

/** GH-4: opt-in, and only a verified reproduction is filed without the user asking. */
async function autoCreateReport(sessionId: string): Promise<void> {
  const settings = await getSettings();
  const token = await loadToken();
  if (!settings.autoCreate || settings.defaultRepo === undefined || token === undefined) return;
  const report = await buildReportForSession(sessionId);
  if (!shouldAutoCreate(report, settings)) return;
  await submitReport(createClient(token), report, settings.defaultRepo);
}

async function handle(
  message: PopupRequest | CaptureMessage,
  sender: chrome.runtime.MessageSender,
): Promise<PopupResponse> {
  switch (message.type) {
    case 'EVENT': {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return { ok: false, error: 'Event received without a tab.' };
      const session = await findRecordingSession(tabId);
      if (!session) return { ok: false, error: 'No recording for this tab.' };
      await persistEvents(session.id, [message.event]);
      if (message.event.type === 'navigation') await takeScreenshot(session.id, tabId, 'navigation');
      return { ok: true };
    }
    case 'START_RECORDING':
      return { ok: true, session: await startRecording(message.tabId) };
    case 'STOP_RECORDING': {
      const session = await stopRecording(message.sessionId);
      if (!session) return { ok: false, error: 'Unknown session.' };
      void autoCreateReport(session.id).catch(() => undefined);
      return { ok: true, session };
    }
    case 'LIST_SESSIONS':
      return { ok: true, sessions: await listSessions() };
    case 'DELETE_SESSION':
      nextSeq.delete(message.sessionId);
      await deleteSession(message.sessionId);
      return { ok: true };

    case 'GITHUB_STATUS': {
      const [github, device] = await Promise.all([githubStatus(), loadDeviceCode()]);
      return { ok: true, github, device };
    }
    case 'GITHUB_CONNECT_START': {
      const device = await startDeviceFlow();
      await saveDeviceCode(device);
      return { ok: true, device };
    }
    case 'GITHUB_CONNECT_POLL': {
      const device = await loadDeviceCode();
      if (device === undefined) return { ok: false, error: 'No GitHub authorization is pending.' };
      const poll = await requestAccessToken(device.deviceCode);
      if (poll.status === 'granted' && poll.token !== undefined) {
        await saveToken(poll.token);
        await clearDeviceCode();
        return { ok: true, status: 'granted', connected: true };
      }
      // An expired or denied code is dead; a `slow_down` keeps polling at a longer interval.
      if (poll.status === 'expired' || poll.status === 'denied') await clearDeviceCode();
      return { ok: true, status: poll.status, connected: await isConnected() };
    }
    case 'GITHUB_DISCONNECT':
      await disconnect();
      return { ok: true, connected: false };
    case 'GITHUB_SAVE_SETTINGS':
      return { ok: true, settings: await saveSettings(message.patch) };

    case 'BUILD_REPORT':
      return { ok: true, report: await buildReportForSession(message.sessionId) };
    case 'PREVIEW_ISSUE': {
      const { report, repo } = await reportAndRepo(message.reportId, message.repo);
      // Nothing is written here: the projected links are derived from the report, not the upload.
      const duplicate = await findIssueByFingerprint(createClient(await requireToken()), repo, report.fingerprint);
      return { ok: true, preview: { preview: previewIssue(report, repo), duplicate } };
    }
    case 'SUBMIT_ISSUE': {
      const { report, repo } = await reportAndRepo(message.reportId, message.repo);
      const submission = await submitReport(createClient(await requireToken()), report, repo);
      // GH-7: remember where the issue lives so the popup can link to it later.
      if (submission.kind === 'created') await saveReport({ ...report, issue: submission.issue });
      return { ok: true, submission, report };
    }
    case 'COMMENT_ISSUE': {
      const { report, repo } = await reportAndRepo(message.reportId, message.repo);
      const issue = await commentExistingReport(
        createClient(await requireToken()),
        report,
        repo,
        message.issueNumber,
      );
      await saveReport({ ...report, issue });
      return { ok: true, issue, report };
    }
  }
}

chrome.runtime.onMessage.addListener((message: PopupRequest | CaptureMessage, sender, sendResponse) => {
  void handle(message, sender)
    .then(sendResponse)
    .catch((error: unknown) => sendResponse({ ok: false, error: messageOf(error) } satisfies PopupResponse));
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return;
  void rearm(tabId);
});
