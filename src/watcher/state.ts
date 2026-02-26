import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { PersistedState, PersistedPrState } from './types';

const CLEANUP_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export class StateManager {
  private state: PersistedState;
  private readonly resolvedPath: string;

  constructor(filePath: string) {
    this.resolvedPath = resolve(filePath);
    this.state = this.load();
  }

  hasBeenReviewed(project: string, repoId: string, prId: number, iterationId: number): boolean {
    const entry = this.state.reviewedPrs.find(
      (e) => e.project === project && e.repoId === repoId && e.prId === prId,
    );
    return entry !== undefined && entry.lastReviewedIterationId >= iterationId;
  }

  markReviewed(project: string, repoId: string, prId: number, iterationId: number): void {
    const existing = this.state.reviewedPrs.find(
      (e) => e.project === project && e.repoId === repoId && e.prId === prId,
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

  private load(): PersistedState {
    const empty: PersistedState = { version: 1, reviewedPrs: [] };
    if (!existsSync(this.resolvedPath)) return empty;

    try {
      const raw = readFileSync(this.resolvedPath, 'utf-8');
      const parsed = JSON.parse(raw) as PersistedState;
      if (parsed.version !== 1) return empty;
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
}
