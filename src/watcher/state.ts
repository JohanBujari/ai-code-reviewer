import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { PersistedState, PersistedPrState } from './types';
import type { WatchedRepo } from './types';

const CLEANUP_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export class StateManager {
  private state: PersistedState;
  private readonly resolvedPath: string;
  private readonly providerKey: string;

  constructor(filePath: string, providerKey: string) {
    this.resolvedPath = resolve(filePath);
    this.providerKey = providerKey;
    this.state = this.load();
  }

  hasBeenReviewed(project: string, repoId: string, prId: number, iterationId: number): boolean {
    const entry = this.state.reviewedPrs.find(
      (e) =>
        e.project === project &&
        e.repoId === repoId &&
        e.prId === prId &&
        e.providerKey === this.providerKey,
    );
    return entry !== undefined && entry.lastReviewedIterationId >= iterationId;
  }

  markReviewed(project: string, repoId: string, prId: number, iterationId: number): void {
    const existing = this.state.reviewedPrs.find(
      (e) =>
        e.project === project &&
        e.repoId === repoId &&
        e.prId === prId &&
        e.providerKey === this.providerKey,
    );
    if (existing) {
      existing.lastReviewedIterationId = iterationId;
      existing.lastReviewedAt = new Date().toISOString();
      existing.reviewCount++;
    } else {
      this.state.reviewedPrs.push({
        prId,
        repoId,
        project,
        providerKey: this.providerKey,
        lastReviewedIterationId: iterationId,
        lastReviewedAt: new Date().toISOString(),
        reviewCount: 1,
      });
    }
    this.save();
  }

  updateLastPollAt(): void {
    this.state.lastPollAt = new Date().toISOString();
    this.save();
  }

  getState(): Readonly<PersistedState> {
    return this.state;
  }

  clearReviewedForRepos(repos: WatchedRepo[]): number {
    const repoKeys = new Set(repos.map((repo) => `${repo.project}/${repo.repoId}`));
    const before = this.state.reviewedPrs.length;

    this.state.reviewedPrs = this.state.reviewedPrs.filter((entry) => {
      if (entry.providerKey !== this.providerKey) {
        return true;
      }

      return !repoKeys.has(`${entry.project}/${entry.repoId}`);
    });

    const removed = before - this.state.reviewedPrs.length;
    if (removed > 0) {
      this.save();
    }

    return removed;
  }

  private load(): PersistedState {
    const empty: PersistedState = { version: 2, reviewedPrs: [] };
    if (!existsSync(this.resolvedPath)) return empty;

    try {
      const raw = readFileSync(this.resolvedPath, 'utf-8');
      const parsed = this.migrate(JSON.parse(raw));
      this.cleanup(parsed);
      return parsed;
    } catch {
      return empty;
    }
  }

  private save(): void {
    const dir = dirname(this.resolvedPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const tmpPath = `${this.resolvedPath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(this.state, null, 2), 'utf-8');
    renameSync(tmpPath, this.resolvedPath);
  }

  private cleanup(state: PersistedState): void {
    const cutoff = Date.now() - CLEANUP_AGE_MS;
    state.reviewedPrs = state.reviewedPrs.filter(
      (entry) => new Date(entry.lastReviewedAt).getTime() > cutoff,
    );
  }

  private migrate(raw: unknown): PersistedState {
    const empty: PersistedState = { version: 2, reviewedPrs: [] };

    if (!raw || typeof raw !== 'object') {
      return empty;
    }

    const parsed = raw as {
      version?: number;
      reviewedPrs?: PersistedPrState[];
      lastPollAt?: string;
    };

    if (!Array.isArray(parsed.reviewedPrs)) {
      return empty;
    }

    if (parsed.version === 2) {
      return {
        version: 2,
        reviewedPrs: parsed.reviewedPrs,
        lastPollAt: parsed.lastPollAt,
      };
    }

    if (parsed.version === 1) {
      return {
        version: 2,
        reviewedPrs: parsed.reviewedPrs.map((entry) => ({
          ...entry,
          providerKey: entry.providerKey,
        })),
        lastPollAt: parsed.lastPollAt,
      };
    }

    return empty;
  }
}
