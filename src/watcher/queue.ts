import type { PrReviewer } from '../reviewer';
import type { StateManager } from './state';
import type { ReviewJob, WatcherEvent } from './types';

export class ReviewQueue {
  private readonly jobs: ReviewJob[] = [];
  private processing = false;

  constructor(
    private readonly reviewer: PrReviewer,
    private readonly stateManager: StateManager,
    private readonly onEvent: (event: WatcherEvent) => void,
  ) {}

  enqueue(job: ReviewJob): boolean {
    const existingIndex = this.jobs.findIndex((j) => j.id === job.id);
    if (existingIndex >= 0) {
      const existing = this.jobs[existingIndex];
      if (existing.status === 'queued' || existing.status === 'in-progress') {
        return false;
      }

      this.jobs.splice(existingIndex, 1);
    }

    this.jobs.push(job);
    this.processNext();
    return true;
  }

  get pending(): ReviewJob[] {
    return this.jobs.filter((j) => j.status === 'queued');
  }

  get current(): ReviewJob | undefined {
    return this.jobs.find((j) => j.status === 'in-progress');
  }

  get completed(): ReviewJob[] {
    return this.jobs.filter((j) => j.status === 'completed' || j.status === 'failed');
  }

  get all(): ReviewJob[] {
    return [...this.jobs];
  }

  private async processNext(): Promise<void> {
    if (this.processing) return;
    const job = this.jobs.find((j) => j.status === 'queued');
    if (!job) return;

    this.processing = true;
    job.status = 'in-progress';
    job.startedAt = Date.now();
    this.onEvent({ type: 'review-start', job });

    try {
      const result = await this.reviewer.reviewPullRequest(
        job.repo.project,
        job.repo.repoId,
        job.prId,
        job.prTitle,
        job.prDescription,
        (progress) => {
          if (progress.kind === 'stage') {
            this.onEvent({
              type: 'review-stage',
              jobId: job.id,
              label: progress.label,
              detail: progress.detail,
            });
            return;
          }

          job.filesReviewed = progress.fileIndex + 1;
          this.onEvent({
            type: 'review-file-progress',
            jobId: job.id,
            filePath: progress.filePath,
            fileIndex: progress.fileIndex,
            totalFiles: progress.totalFiles,
          });
        },
      );

      job.status = 'completed';
      job.completedAt = Date.now();
      job.commentsPosted = result.comments.length;
      this.stateManager.markReviewed(
        job.repo.project,
        job.repo.repoId,
        job.prId,
        job.iterationId,
      );
      this.onEvent({ type: 'review-complete', job });
    } catch (error) {
      job.status = 'failed';
      job.completedAt = Date.now();
      job.error = error instanceof Error ? error.message : String(error);
      this.onEvent({ type: 'review-failed', job, error: job.error });
    } finally {
      this.processing = false;
      // Trim completed jobs to last 100
      const completedJobs = this.jobs.filter((j) => j.status === 'completed' || j.status === 'failed');
      if (completedJobs.length > 100) {
        const toRemove = completedJobs.slice(0, completedJobs.length - 100);
        for (const j of toRemove) {
          const idx = this.jobs.indexOf(j);
          if (idx >= 0) this.jobs.splice(idx, 1);
        }
      }
      this.processNext();
    }
  }
}
