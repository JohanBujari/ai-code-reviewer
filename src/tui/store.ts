import { EventEmitter } from 'node:events';
import type { WatcherEvent, ReviewJob, WatchedRepo } from '../watcher/types';

export interface TuiState {
  status: 'watching' | 'paused' | 'shutting-down';
  startedAt: number;
  repos: WatchedRepo[];
  lastPollAt?: number;
  pendingJobs: ReviewJob[];
  currentJob?: ReviewJob;
  completedJobs: ReviewJob[];
  currentFileProgress?: {
    filePath: string;
    fileIndex: number;
    totalFiles: number;
  };
  logs: Array<{ timestamp: number; level: 'info' | 'warn' | 'error'; message: string }>;
  errors: Array<{ timestamp: number; message: string }>;
}

const MAX_COMPLETED = 50;
const MAX_LOGS = 200;
const MAX_ERRORS = 10;

export class TuiStore extends EventEmitter {
  state: TuiState;

  constructor(repos: WatchedRepo[]) {
    super();
    this.state = {
      status: 'watching',
      startedAt: Date.now(),
      repos,
      pendingJobs: [],
      completedJobs: [],
      logs: [],
      errors: [],
    };
  }

  handleEvent(event: WatcherEvent): void {
    switch (event.type) {
      case 'poll-complete':
        this.state.lastPollAt = Date.now();
        break;

      case 'review-queued':
        this.state.pendingJobs.push(event.job);
        this.addLog('info', `Queued PR #${event.job.prId}: ${event.job.prTitle}`);
        break;

      case 'review-start':
        this.state.currentJob = event.job;
        this.state.pendingJobs = this.state.pendingJobs.filter((j) => j.id !== event.job.id);
        this.state.currentFileProgress = undefined;
        this.addLog('info', `Reviewing PR #${event.job.prId}: ${event.job.prTitle}`);
        break;

      case 'review-file-progress':
        this.state.currentFileProgress = {
          filePath: event.filePath,
          fileIndex: event.fileIndex,
          totalFiles: event.totalFiles,
        };
        break;

      case 'review-complete':
        this.addLog('info', `Completed PR #${event.job.prId}: ${event.job.commentsPosted ?? 0} comments`);
        this.state.currentJob = undefined;
        this.state.currentFileProgress = undefined;
        this.state.completedJobs.unshift(event.job);
        if (this.state.completedJobs.length > MAX_COMPLETED) {
          this.state.completedJobs = this.state.completedJobs.slice(0, MAX_COMPLETED);
        }
        break;

      case 'review-failed':
        this.addLog('error', `PR #${event.job.prId} failed: ${event.error}`);
        this.state.currentJob = undefined;
        this.state.currentFileProgress = undefined;
        this.state.completedJobs.unshift(event.job);
        if (this.state.completedJobs.length > MAX_COMPLETED) {
          this.state.completedJobs = this.state.completedJobs.slice(0, MAX_COMPLETED);
        }
        break;

      case 'poll-error':
        this.addLog('error', `Poll error: ${event.error}`);
        break;

      case 'shutdown':
        this.state.status = 'shutting-down';
        break;
    }

    this.emit('change', this.state);
  }

  addLog(level: 'info' | 'warn' | 'error', message: string): void {
    this.state.logs.push({ timestamp: Date.now(), level, message });
    if (this.state.logs.length > MAX_LOGS) {
      this.state.logs = this.state.logs.slice(-MAX_LOGS);
    }
    if (level === 'error') {
      this.state.errors.push({ timestamp: Date.now(), message });
      if (this.state.errors.length > MAX_ERRORS) {
        this.state.errors = this.state.errors.slice(-MAX_ERRORS);
      }
    }
    this.emit('change', this.state);
  }
}
