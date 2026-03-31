import { EventEmitter } from 'node:events';
import type { Logger } from '../types';
import type { AiConfig } from '../config';
import { PrReviewer } from '../reviewer';
import { AzureDevOpsClient } from '../azure-devops/client';
import { StateManager } from './state';
import { Poller } from './poller';
import { ReviewQueue } from './queue';
import type { WatchedRepo, WatcherEvent, ReviewJob } from './types';

export interface OrchestratorConfig {
  azureDevOps: { org: string; pat: string };
  ai: AiConfig;
  repos: WatchedRepo[];
  pollIntervalMs: number;
  stateFilePath: string;
}

export class WatcherOrchestrator extends EventEmitter {
  private readonly poller: Poller;
  private readonly queue: ReviewQueue;
  private readonly reviewer: PrReviewer;
  private readonly stateManager: StateManager;
  private readonly repos: WatchedRepo[];

  constructor(config: OrchestratorConfig, logger: Logger) {
    super();
    this.repos = config.repos;
    this.stateManager = new StateManager(
      config.stateFilePath,
      config.ai.provider,
    );

    const devOps = new AzureDevOpsClient(config.azureDevOps.org, config.azureDevOps.pat, logger);
    this.reviewer = new PrReviewer({
      azureDevOps: config.azureDevOps,
      webhookSecret: '',
      ai: config.ai,
      logger,
    });

    const emitEvent = (event: WatcherEvent) => this.emit('event', event);

    this.queue = new ReviewQueue(this.reviewer, this.stateManager, emitEvent);

    this.poller = new Poller(
      devOps,
      this.stateManager,
      config.repos,
      config.pollIntervalMs,
      (event) => {
        if (event.type === 'review-queued') {
          const accepted = this.queue.enqueue(event.job);
          if (accepted) {
            emitEvent(event);
          }
          return accepted;
        }
        emitEvent(event);
      },
      logger,
    );
  }

  start(): void {
    this.poller.start();
  }

  stop(): void {
    this.poller.stop();
    this.emit('event', { type: 'shutdown' } as WatcherEvent);
  }

  pause(): void {
    this.poller.pause();
  }

  resume(): void {
    this.poller.resume();
  }

  isPaused(): boolean {
    return this.poller.isPaused();
  }

  forcePoll(): void {
    this.poller.forcePoll();
  }

  resetReviewState(): number {
    const cleared = this.stateManager.clearReviewedForRepos(this.repos);
    this.reviewer.clearRecentReviews();
    return cleared;
  }

  getQueueStatus(): { pending: ReviewJob[]; current?: ReviewJob; completed: ReviewJob[] } {
    return {
      pending: this.queue.pending,
      current: this.queue.current,
      completed: this.queue.completed,
    };
  }
}
