import Dexie, { type Table } from 'dexie';
import type { ReproReport } from '@shared/report';
import type { RecordedEvent, Screenshot, Session } from '@shared/types';

export type StoredEvent = RecordedEvent & { key?: number };

/** Events are written one batch at a time so a service-worker restart loses nothing. */
class ReproFlowDB extends Dexie {
  sessions!: Table<Session, string>;
  events!: Table<StoredEvent, number>;
  screenshots!: Table<Screenshot, string>;
  reports!: Table<ReproReport, string>;

  constructor() {
    super('reproflow');
    this.version(1).stores({
      sessions: 'id, status, tabId, startedAt',
      events: '++key, sessionId, [sessionId+seq]',
      screenshots: 'id, sessionId, label',
    });
    this.version(2).stores({
      reports: 'id, sessionId, createdAt',
    });
  }
}

export const db = new ReproFlowDB();

export async function findRecordingSession(tabId: number): Promise<Session | undefined> {
  return db.sessions.filter((session) => session.status === 'recording' && session.tabId === tabId).first();
}

export async function listSessions(): Promise<Session[]> {
  return db.sessions.orderBy('startedAt').reverse().toArray();
}

export async function saveReport(report: ReproReport): Promise<void> {
  await db.reports.put(report);
}

export async function getReport(reportId: string): Promise<ReproReport | undefined> {
  return db.reports.get(reportId);
}

export async function deleteSession(sessionId: string): Promise<void> {
  await db.transaction('rw', db.sessions, db.events, db.screenshots, db.reports, async () => {
    await db.events.where('sessionId').equals(sessionId).delete();
    await db.screenshots.where('sessionId').equals(sessionId).delete();
    await db.reports.where('sessionId').equals(sessionId).delete();
    await db.sessions.delete(sessionId);
  });
}
