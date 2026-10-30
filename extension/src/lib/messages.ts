import type { ReproReport } from '@shared/report';
import type { NavigationKind, RawEvent, Session } from '@shared/types';
import type {
  AttachmentPlan,
  DeviceCode,
  DeviceFlowStatus,
  ExistingIssue,
  GitHubRepo,
  GitHubSettings,
  IssuePreview,
  SubmissionResult,
} from './github';

export type StartRecording = { type: 'START_RECORDING'; tabId: number };
export type StopRecording = { type: 'STOP_RECORDING'; sessionId: string };
export type ListSessions = { type: 'LIST_SESSIONS' };
export type DeleteSession = { type: 'DELETE_SESSION'; sessionId: string };

export type GitHubStatus = { type: 'GITHUB_STATUS' };
export type GitHubConnectStart = { type: 'GITHUB_CONNECT_START' };
export type GitHubConnectPoll = { type: 'GITHUB_CONNECT_POLL' };
export type GitHubDisconnect = { type: 'GITHUB_DISCONNECT' };
export type GitHubSaveSettings = {
  type: 'GITHUB_SAVE_SETTINGS';
  patch: { defaultRepo?: GitHubRepo; autoCreate?: boolean };
};
export type BuildReport = { type: 'BUILD_REPORT'; sessionId: string };
export type PreviewIssue = { type: 'PREVIEW_ISSUE'; reportId: string; repo?: GitHubRepo };
export type SubmitIssue = { type: 'SUBMIT_ISSUE'; reportId: string; repo?: GitHubRepo };
export type CommentIssue = {
  type: 'COMMENT_ISSUE';
  reportId: string;
  issueNumber: number;
  repo?: GitHubRepo;
};

export type PopupRequest =
  | StartRecording
  | StopRecording
  | ListSessions
  | DeleteSession
  | GitHubStatus
  | GitHubConnectStart
  | GitHubConnectPoll
  | GitHubDisconnect
  | GitHubSaveSettings
  | BuildReport
  | PreviewIssue
  | SubmitIssue
  | CommentIssue;

export interface GitHubStatusPayload {
  connected: boolean;
  settings: GitHubSettings;
  repos: GitHubRepo[];
  /** Set when the token works but the repository list could not be read. */
  error?: string;
}

export interface PreviewPayload {
  preview: IssuePreview;
  /** GH-8: an open issue already carries this fingerprint; offer a comment instead. */
  duplicate?: ExistingIssue;
}

export type PopupResponse =
  | {
      ok: true;
      session?: Session;
      sessions?: Session[];
      github?: GitHubStatusPayload;
      /** Present while authorization is still pending. */
      device?: DeviceCode;
      status?: DeviceFlowStatus;
      connected?: boolean;
      settings?: GitHubSettings;
      report?: ReproReport;
      preview?: PreviewPayload;
      submission?: SubmissionResult;
      issue?: ExistingIssue;
      attachments?: AttachmentPlan;
    }
  | { ok: false; error: string };

export const CHANNEL = 'reproflow';

/** Recorder -> service worker, one event at a time. */
export type CaptureMessage = { channel: typeof CHANNEL; type: 'EVENT'; event: RawEvent };

/** Service worker -> recorder, flush anything still buffered. */
export type StopCaptureMessage = { channel: typeof CHANNEL; type: 'STOP_CAPTURE' };

/** Page world -> recorder: only signals that need to observe the page's own objects. */
export const PAGE_CHANNEL = 'reproflow-page';

export type PageSignal =
  | { kind: 'console'; message: string }
  | { kind: 'exception'; message: string }
  | { kind: 'requestfailed'; method: string; requestUrl: string; status: number }
  | { kind: 'navigation'; navigationKind: NavigationKind; toUrl: string };

export type PageSignalMessage = { channel: typeof PAGE_CHANNEL; type: 'SIGNAL'; signal: PageSignal };
