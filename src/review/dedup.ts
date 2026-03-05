import { DEFAULTS } from "../config";
import { MAX_DEDUP_ENTRIES } from "../shared/constants";

/** Tracks processed PR iterations to prevent duplicate reviews */
export class ReviewDeduplicator {
  private readonly processedIterations = new Map<string, number>();

  isDuplicate(key: string): boolean {
    const timestamp = this.processedIterations.get(key);
    if (!timestamp) return false;
    if (Date.now() - timestamp > DEFAULTS.dedupTtlMs) {
      this.processedIterations.delete(key);
      return false;
    }
    return true;
  }

  markProcessed(key: string): void {
    this.processedIterations.set(key, Date.now());

    if (this.processedIterations.size > MAX_DEDUP_ENTRIES) {
      const now = Date.now();
      for (const [k, v] of this.processedIterations) {
        if (now - v > DEFAULTS.dedupTtlMs) {
          this.processedIterations.delete(k);
        }
      }
    }
  }
}
