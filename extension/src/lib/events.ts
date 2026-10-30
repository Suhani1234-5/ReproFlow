import type { RawEvent, RecordedEvent } from '@shared/types';

/** Stamps the next monotonic sequence numbers for a session. */
export function withSeq(sessionId: string, events: RawEvent[], start: number): RecordedEvent[] {
  return events.map((event, index) => ({ ...event, sessionId, seq: start + index })) as RecordedEvent[];
}

/** Restores capture order after reading rows out of IndexedDB in any order. */
export function sortBySeq<T extends { seq: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.seq - b.seq);
}

/** After a service-worker restart the counter is rebuilt from what is already stored. */
export function recoverNextSeq(rows: Array<{ seq: number }>): number {
  return rows.reduce((max, row) => (row.seq > max ? row.seq : max), -1) + 1;
}
