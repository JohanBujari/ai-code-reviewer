export interface WatchedRepo {
  project: string;
  repoId: string;
  repoName: string;
}

export interface ReviewJob {
  /** Unique key: `${project}/${repoId}/${prId}/${iterationId}` */
  id: string;
  repo: WatchedRepo;
  prId: number;
  prTitle: string;
  prDescription?: string;
  iterationId: number;
  status: 'queued' | 'in-progress' | 'completed' | 'failed';
  queuedAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  filesReviewed?: number;
  commentsPosted?: number;
}

export interface PersistedPrState {
  prId: number;
  repoId: string;
  project: string;
  lastReviewedIterationId: number;
  lastReviewedAt: string;
  reviewCount: number;
}

export interface PersistedState {
  version: 1;
  reviewedPrs: PersistedPrState[];
  lastPollAt?: string;
}

export type WatcherEvent =
  | { type: 'poll-start'; repos: WatchedRepo[] }
  | { type: 'poll-complete'; newJobs: number }
  | { type: 'poll-error'; error: string }
  | { type: 'review-queued'; job: ReviewJob }
  | { type: 'review-start'; job: ReviewJob }
  | { type: 'review-file-progress'; jobId: string; filePath: string; fileIndex: number; totalFiles: number }
  | { type: 'review-complete'; job: ReviewJob }
  | { type: 'review-failed'; job: ReviewJob; error: string }
  | { type: 'shutdown' };
