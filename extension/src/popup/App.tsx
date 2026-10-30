import { useCallback, useEffect, useState } from 'react';
import type { ReproReport } from '@shared/report';
import type { Session } from '@shared/types';
import { requestGitHubAccess, type DeviceCode, type ExistingIssue } from '../lib/github';
import type { GitHubStatusPayload, PopupRequest, PopupResponse, PreviewPayload } from '../lib/messages';
import { toZip } from '../lib/report';

const panel: React.CSSProperties = { border: '1px solid #232733', borderRadius: 6, padding: 8, marginBottom: 12 };
const buttonRow: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' };
const muted: React.CSSProperties = { color: '#8b9bb4', margin: '0 0 8px' };

/** A failed request is reported in the status line, so callers only ever see the success shape. */
type OkResponse = Extract<PopupResponse, { ok: true }>;

export function App(): JSX.Element {
  const [tabId, setTabId] = useState<number>();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [status, setStatus] = useState('Ready');
  const [busy, setBusy] = useState(false);
  const [github, setGithub] = useState<GitHubStatusPayload>();
  const [pending, setPending] = useState<{ device: DeviceCode; interval: number }>();
  const [report, setReport] = useState<ReproReport>();
  const [preview, setPreview] = useState<PreviewPayload>();
  const [issue, setIssue] = useState<ExistingIssue>();

  /** `quiet` keeps the periodic authorization polls from flickering the action buttons. */
  const call = useCallback(async (message: PopupRequest, quiet = false): Promise<OkResponse | undefined> => {
    if (!quiet) setBusy(true);
    try {
      const response = (await chrome.runtime.sendMessage(message)) as PopupResponse;
      if (!response.ok) {
        setStatus(response.error);
        return undefined;
      }
      return response;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      return undefined;
    } finally {
      if (!quiet) setBusy(false);
    }
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    const response = await call({ type: 'GITHUB_STATUS' }, true);
    if (response?.github) setGithub(response.github);
    if (response?.device) {
      const device = response.device;
      setPending((current) => current ?? { device, interval: device.interval });
    }
    const list = await call({ type: 'LIST_SESSIONS' });
    if (list?.sessions) setSessions(list.sessions);
  }, [call]);

  useEffect(() => {
    void (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      setTabId(tab?.id);
      await refresh();
    })();
  }, [refresh]);

  /** GH-1: the pending code is stored, so closing the popup and reopening resumes the poll. */
  useEffect(() => {
    if (pending === undefined) return;
    let active = true;
    const timer = window.setInterval(() => {
      void (async () => {
        const response = await call({ type: 'GITHUB_CONNECT_POLL' }, true);
        if (!active || response === undefined) return;
        if (response.connected) {
          setPending(undefined);
          setStatus('GitHub connected');
          await refresh();
          return;
        }
        if (response.status === 'slow_down') {
          setPending((current) => (current ? { ...current, interval: current.interval + 5 } : current));
          return;
        }
        if (response.status === 'expired' || response.status === 'denied') {
          setPending(undefined);
          setStatus(response.status === 'denied' ? 'Authorization denied.' : 'The device code expired.');
        }
      })();
    }, pending.interval * 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [pending, call, refresh]);

  const recording = sessions.find((session) => session.status === 'recording');
  const repos = github?.repos ?? [];
  const defaultRepo = github?.settings.defaultRepo;

  const start = async (): Promise<void> => {
    if (tabId === undefined) return;
    const response = await call({ type: 'START_RECORDING', tabId });
    if (response !== undefined) setStatus('Recording');
    await refresh();
  };

  const stop = async (): Promise<void> => {
    if (!recording) return;
    const response = await call({ type: 'STOP_RECORDING', sessionId: recording.id });
    if (response !== undefined) setStatus('Stopped');
    await refresh();
  };

  const remove = async (sessionId: string): Promise<void> => {
    await call({ type: 'DELETE_SESSION', sessionId });
    if (report?.sessionId === sessionId) {
      setReport(undefined);
      setPreview(undefined);
      setIssue(undefined);
    }
    await refresh();
  };

  const connect = async (): Promise<void> => {
    // The origin permission must be requested from this gesture, not from the service worker.
    if (!(await requestGitHubAccess())) {
      setStatus('GitHub access was not granted.');
      return;
    }
    const response = await call({ type: 'GITHUB_CONNECT_START' });
    if (response?.device) {
      setPending({ device: response.device, interval: response.device.interval });
      setStatus('Enter the code on GitHub to finish connecting.');
    }
  };

  const disconnectAccount = async (): Promise<void> => {
    await call({ type: 'GITHUB_DISCONNECT' });
    setPending(undefined);
    setReport(undefined);
    setPreview(undefined);
    setIssue(undefined);
    await refresh();
    setStatus('Disconnected.');
  };

  const chooseRepo = async (fullName: string): Promise<void> => {
    const repo = repos.find((candidate) => candidate.fullName === fullName);
    if (repo === undefined) return;
    const response = await call({ type: 'GITHUB_SAVE_SETTINGS', patch: { defaultRepo: repo } });
    const settings = response?.settings;
    if (settings) setGithub((current) => (current ? { ...current, settings } : current));
  };

  const toggleAutoCreate = async (autoCreate: boolean): Promise<void> => {
    const response = await call({ type: 'GITHUB_SAVE_SETTINGS', patch: { autoCreate } });
    const settings = response?.settings;
    if (settings) setGithub((current) => (current ? { ...current, settings } : current));
  };

  const openReport = async (sessionId: string): Promise<void> => {
    const built = await call({ type: 'BUILD_REPORT', sessionId });
    if (built?.report === undefined) return;
    setReport(built.report);
    setIssue(built.report.issue);
    const previewed = await call({ type: 'PREVIEW_ISSUE', reportId: built.report.id });
    if (previewed?.preview) setPreview(previewed.preview);
  };

  const publish = async (): Promise<void> => {
    if (report === undefined) return;
    const response = await call({ type: 'SUBMIT_ISSUE', reportId: report.id });
    const submission = response?.submission;
    if (submission === undefined) return;
    setIssue(submission.issue);
    if (submission.kind === 'duplicate') {
      setStatus(`Already reported as #${submission.issue.number}. Comment on it instead.`);
      return;
    }
    setPreview(undefined);
    if (response?.report) setReport(response.report);
    const inlined = submission.attachments.mode === 'details' ? ' (test inlined in the body)' : '';
    setStatus(`Created #${submission.issue.number}${inlined}.`);
  };

  const comment = async (issueNumber: number): Promise<void> => {
    if (report === undefined) return;
    const response = await call({ type: 'COMMENT_ISSUE', reportId: report.id, issueNumber });
    if (response?.issue === undefined) return;
    setPreview(undefined);
    setIssue(response.issue);
    setStatus(`Commented on #${response.issue.number}.`);
  };

  const exportZip = async (): Promise<void> => {
    if (report === undefined) return;
    const url = URL.createObjectURL(await toZip(report));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `reproflow-${report.id}.zip`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main style={{ width: 360, padding: 12, font: '13px system-ui', color: '#e6e6e6', background: '#12141a' }}>
      <h1 style={{ margin: '0 0 8px', fontSize: 15 }}>ReproFlow</h1>
      <p role="status" style={muted}>
        {busy ? 'Working…' : status}
      </p>

      <div style={{ ...buttonRow, marginBottom: 12 }}>
        <button type="button" onClick={() => void start()} disabled={Boolean(recording) || tabId === undefined}>
          Record
        </button>
        <button type="button" onClick={() => void stop()} disabled={!recording}>
          Stop
        </button>
      </div>

      <section style={panel}>
        <h2 style={{ margin: '0 0 8px', fontSize: 13 }}>GitHub</h2>
        {github?.connected ? (
          <>
            <div style={{ display: 'grid', gap: 6 }}>
              <label style={muted}>
                Repository
                <select
                  style={{ width: '100%' }}
                  value={defaultRepo?.fullName ?? ''}
                  onChange={(event) => void chooseRepo(event.target.value)}
                  disabled={repos.length === 0}
                >
                  <option value="">{repos.length === 0 ? 'No repositories' : 'Select a repository'}</option>
                  {repos.map((repo) => (
                    <option key={repo.fullName} value={repo.fullName}>
                      {repo.fullName}
                      {repo.isPrivate ? '' : ' (public)'}
                    </option>
                  ))}
                </select>
              </label>
              <label style={muted}>
                <input
                  type="checkbox"
                  checked={github.settings.autoCreate}
                  onChange={(event) => void toggleAutoCreate(event.target.checked)}
                />
                Open an issue automatically for a verified reproduction
              </label>
              {github.error ? <span style={{ color: '#ffa94d' }}>{github.error}</span> : null}
              {defaultRepo !== undefined && !defaultRepo.isPrivate ? (
                <span style={{ color: '#ffa94d' }}>
                  {`${defaultRepo.fullName} is public: the report, test and screenshots will be visible to everyone.`}
                </span>
              ) : null}
            </div>
            <div style={{ ...buttonRow, marginTop: 8 }}>
              <button type="button" onClick={() => void disconnectAccount()}>
                Disconnect
              </button>
            </div>
          </>
        ) : pending === undefined ? (
          <button type="button" onClick={() => void connect()}>
            Connect GitHub
          </button>
        ) : (
          <div>
            <p style={muted}>Enter this code at GitHub to authorize ReproFlow:</p>
            <p style={{ margin: '0 0 8px', fontSize: 18, letterSpacing: 2 }}>{pending.device.userCode}</p>
            <a href={pending.device.verificationUri} target="_blank" rel="noreferrer">
              {pending.device.verificationUri}
            </a>
          </div>
        )}
      </section>

      <ul style={{ display: 'grid', gap: 6, margin: '0 0 12px', padding: 0, listStyle: 'none' }}>
        {sessions.map((session) => (
          <li
            key={session.id}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              alignItems: 'center',
              gap: 8,
              padding: 8,
              border: '1px solid #232733',
              borderRadius: 6,
            }}
          >
            <span>
              {new Date(session.startedAt).toLocaleTimeString()} · {session.eventCount} events
              <br />
              <small style={{ color: session.status === 'recording' ? '#ff6b6b' : '#8b9bb4' }}>
                {session.status}
              </small>
            </span>
            <span style={buttonRow}>
              <button type="button" onClick={() => void openReport(session.id)} disabled={session.status === 'recording'}>
                Report
              </button>
              <button type="button" onClick={() => void remove(session.id)}>
                Delete
              </button>
            </span>
          </li>
        ))}
      </ul>

      {report !== undefined && preview !== undefined ? (
        <section style={panel}>
          <h2 style={{ margin: '0 0 8px', fontSize: 13 }}>Preview: {preview.preview.repository}</h2>
          {preview.preview.publicWarning ? (
            <p style={{ color: '#ffa94d' }}>
              This repository is public. Anyone will be able to read the report and its evidence.
            </p>
          ) : null}
          {preview.duplicate ? (
            <p style={{ color: '#ffd43b' }}>
              {`Already reported as #${preview.duplicate.number}.`}{' '}
              <a href={preview.duplicate.url} target="_blank" rel="noreferrer">
                Open issue
              </a>
            </p>
          ) : null}
          <p style={muted}>{`Title: ${preview.preview.title}`}</p>
          <p style={muted}>{`Labels: ${preview.preview.labels.join(', ')}`}</p>
          <pre
            style={{
              maxHeight: 200,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              background: '#0b0d12',
              padding: 8,
              borderRadius: 4,
            }}
          >
            {preview.preview.body}
          </pre>
          <div style={buttonRow}>
            {preview.duplicate ? (
              <button type="button" onClick={() => void comment(preview.duplicate!.number)} disabled={busy}>
                {`Comment on #${preview.duplicate.number}`}
              </button>
            ) : null}
            <button type="button" onClick={() => void publish()} disabled={busy}>
              {preview.duplicate ? 'Create new issue' : 'Create issue'}
            </button>
            <button type="button" onClick={() => setPreview(undefined)}>
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {report !== undefined ? (
        <section style={panel}>
          <div style={buttonRow}>
            <button type="button" onClick={() => void exportZip()}>
              Export ZIP
            </button>
            {issue ? (
              <a href={issue.url} target="_blank" rel="noreferrer">
                {`Issue #${issue.number}`}
              </a>
            ) : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}
