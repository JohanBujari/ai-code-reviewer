import { AzureDevOpsClient } from "../azure-devops/client";
import type { Logger } from "../types";
import type { StateManager } from "./state";
import type { WatchedRepo, ReviewJob, WatcherEvent } from "./types";

export class Poller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private paused = false;

  constructor(
    private readonly devOps: AzureDevOpsClient,
    private readonly stateManager: StateManager,
    private readonly repos: WatchedRepo[],
    private readonly intervalMs: number,
    private readonly onEvent: (event: WatcherEvent) => boolean | void,
    private readonly logger: Logger,
  ) {}

  start(): void {
    this.pollOnce();
    this.timer = setInterval(() => this.pollOnce(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  isPaused(): boolean {
    return this.paused;
  }

  forcePoll(): void {
    this.pollOnce();
  }

  private isFatalError(msg: string): boolean {
    return (
      msg.includes("non-JSON response") ||
      msg.includes("is not valid JSON") ||
      /\b(?:401|403)\s+(?:Unauthorized|Forbidden)/i.test(msg) ||
      /(?:status|HTTP)\s*(?:401|403)\b/i.test(msg) ||
      msg.includes("Unauthorized") ||
      msg.includes("Forbidden")
    );
  }

  private async pollOnce(): Promise<void> {
    if (this.polling || this.paused) return;
    this.polling = true;
    this.onEvent({ type: "poll-start", repos: this.repos });

    let totalNewJobs = 0;

    try {
      for (const repo of this.repos) {
        try {
          const prs = await this.devOps.listActivePullRequests(
            repo.project,
            repo.repoId,
          );

          for (const pr of prs) {
            try {
              const iterations = await this.devOps.getPrIterations(
                repo.project,
                repo.repoId,
                pr.pullRequestId,
              );
              if (iterations.length === 0) continue;

              const latest = iterations[iterations.length - 1];
              if (
                this.stateManager.hasBeenReviewed(
                  repo.project,
                  repo.repoId,
                  pr.pullRequestId,
                  latest.id,
                )
              ) {
                continue;
              }

              const job: ReviewJob = {
                id: `${repo.project}/${repo.repoId}/${pr.pullRequestId}/${latest.id}`,
                repo,
                prId: pr.pullRequestId,
                prTitle: pr.title,
                prDescription: pr.description,
                iterationId: latest.id,
                status: "queued",
                queuedAt: Date.now(),
              };
              const accepted = this.onEvent({ type: "review-queued", job });
              if (accepted !== false) {
                totalNewJobs++;
              }
            } catch (error) {
              this.logger.warn(
                `Failed to check iterations for PR #${pr.pullRequestId} in ${repo.project}/${repo.repoName}: ${error}`,
              );
            }
          }
        } catch (error) {
          const msg = String(error);
          if (this.isFatalError(msg)) {
            this.stop();
            this.onEvent({
              type: "fatal-error",
              error: `${msg} — check that your Azure DevOps PAT is still valid`,
            });
            return;
          }
          this.logger.error(
            `Poll error for ${repo.project}/${repo.repoName}: ${msg}`,
          );
        }
      }

      this.stateManager.updateLastPollAt();
      this.onEvent({ type: "poll-complete", newJobs: totalNewJobs });
    } catch (error) {
      this.onEvent({ type: "poll-error", error: String(error) });
    } finally {
      this.polling = false;
    }
  }
}
