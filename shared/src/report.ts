import { REPORT_SCHEMA_VERSION, type RecordedEvent, type Screenshot } from './types';

export interface Environment {
  browser: string;
  os: string;
  viewport: string;
  url: string;
  extensionVersion: string;
}

export type VerificationResult =
  | 'reproduced'
  | 'not-reproduced'
  | 'different-failure'
  | 'infrastructure-error';

export interface Verification {
  result: VerificationResult;
  runs: number;
  failures: number;
  message: string;
}

export interface IssueRef {
  number: number;
  url: string;
}

export interface ReproReport {
  schemaVersion: number;
  id: string;
  sessionId: string;
  createdAt: number;
  title: string;
  summary: string;
  expected: string;
  actual: string;
  steps: string[];
  /** What the recording failed on; read by the runner and hashed into the fingerprint. */
  failureAssertion: string;
  environment: Environment;
  verification?: Verification;
  screenshots: Screenshot[];
  events: RecordedEvent[];
  testFile: string;
  fingerprint: string;
  issue?: IssueRef;
}

export function createReport(input: Omit<ReproReport, 'schemaVersion' | 'createdAt'>): ReproReport {
  return { schemaVersion: REPORT_SCHEMA_VERSION, createdAt: Date.now(), ...input };
}

/** Older reports stay readable: only the version is required to identify one. */
export function isReproReport(value: unknown): value is ReproReport {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ReproReport>;
  return typeof candidate.schemaVersion === 'number' && typeof candidate.id === 'string';
}
