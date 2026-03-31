/** Incoming Azure DevOps webhook payload (PR events) */
export interface WebhookPayload {
  subscriptionId?: string;
  notificationId?: number;
  eventType: string;
  resource: {
    repository: {
      id: string;
      name: string;
      project: { id: string; name: string };
    };
    pullRequestId: number;
    title: string;
    description?: string;
    sourceRefName: string;
    targetRefName: string;
    status: string;
    mergeStatus?: string;
    lastMergeSourceCommit?: { commitId: string };
    lastMergeTargetCommit?: { commitId: string };
  };
}

/** Azure DevOps PR iteration */
export interface PrIteration {
  id: number;
  sourceRefCommit: { commitId: string };
  targetRefCommit: { commitId: string };
  createdDate: string;
}

/** A single file change within a PR iteration */
export interface PrIterationChange {
  changeId: number;
  item: { path: string };
  changeType: string;
}

/** Processed file change ready for AI review */
export interface PrFileChange {
  filePath: string;
  changeType: string;
  content: string;
}

/** A single AI review comment targeting a specific file and line (or line range) */
export interface ReviewComment {
  filePath: string;
  lineNumber: number;
  /** Optional end line for multi-line issues. When set, the comment highlights a range. */
  endLineNumber?: number;
  severity: 'critical' | 'warning' | 'suggestion' | 'nitpick';
  message: string;
}

/** Complete AI review result */
export interface ReviewResult {
  comments: ReviewComment[];
}

export type ReviewProgressUpdate =
  | {
      kind: "stage";
      label: string;
      detail?: string;
    }
  | {
      kind: "file";
      filePath: string;
      fileIndex: number;
      totalFiles: number;
    };

/** Azure DevOps comment thread context */
export interface ThreadContext {
  filePath: string;
  rightFileStart: { line: number; offset: 1 };
  rightFileEnd: { line: number; offset: 1 };
}

/** PR status state */
export type PrStatusState = 'succeeded' | 'failed' | 'pending' | 'error' | 'notApplicable';

/** Summary of an active pull request from Azure DevOps */
export interface PullRequestSummary {
  pullRequestId: number;
  title: string;
  description?: string;
  status: string;
  sourceRefName: string;
  targetRefName: string;
  repository: {
    id: string;
    name: string;
    project: { id: string; name: string };
  };
  creationDate: string;
  lastMergeSourceCommit?: { commitId: string };
}

/** Logger interface — users can provide their own */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}
