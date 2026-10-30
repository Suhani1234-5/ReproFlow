import type { Environment, ReproReport } from '@shared/report';
import type { RecordedEvent, Session } from '@shared/types';
import { db, saveReport } from './db';
import { generateSpec } from './generator';
import { buildReport } from './report';

/** The last recorded event sits where the failure was observed. */
function failureUrl(session: Session, events: RecordedEvent[]): string {
  return events.reduce<RecordedEvent | undefined>(
    (latest, event) => (latest === undefined || event.seq > latest.seq ? event : latest),
    undefined,
  )?.url ?? session.startUrl;
}

function browserName(): string {
  const match = /(Chrome|Chromium)\/(\d+)/.exec(navigator.userAgent);
  return match ? `${match[1]} ${match[2]}` : navigator.userAgent;
}

function osName(): string {
  const agent = navigator.userAgent;
  if (/Windows NT 10/.test(agent)) return 'Windows 10/11';
  if (/CrOS/.test(agent)) return 'ChromeOS';
  if (/Mac OS X/.test(agent)) return 'macOS';
  if (/Android/.test(agent)) return 'Android';
  if (/Linux/.test(agent)) return 'Linux';
  return 'Unknown';
}

export function environmentFor(session: Session, events: RecordedEvent[]): Environment {
  return {
    browser: browserName(),
    os: osName(),
    viewport: session.viewport ?? 'unknown',
    url: failureUrl(session, events),
    extensionVersion: chrome.runtime.getManifest().version,
  };
}

/**
 * Session -> generated spec -> report, persisted so the popup can preview and file it.
 * Verification is attached by the runner flow; without it the report is filed as needs-triage.
 */
export async function buildReportForSession(sessionId: string): Promise<ReproReport> {
  const session = await db.sessions.get(sessionId);
  if (session === undefined) throw new Error('Unknown session.');

  const events = await db.events.where('sessionId').equals(sessionId).toArray();
  const screenshots = (await db.screenshots.where('sessionId').equals(sessionId).toArray()).sort((a, b) => a.ts - b.ts);
  const spec = await generateSpec({ startUrl: session.startUrl, events });

  const report = await buildReport({
    session,
    events,
    screenshots,
    spec,
    environment: environmentFor(session, events),
  });
  await saveReport(report);
  return report;
}
