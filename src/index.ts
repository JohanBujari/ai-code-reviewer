import type { PrReviewerOptions } from "./config";
import { PrReviewer } from "./reviewer";

/** Create a configured PR reviewer instance */
export function createPrReviewer(options: PrReviewerOptions): PrReviewer {
  return new PrReviewer(options);
}

/**
 * Optional Express middleware that handles webhook verification and review.
 *
 * Usage:
 * ```ts
 * import express from 'express';
 * import { expressMiddleware } from 'axiom';
 *
 * const app = express();
 * app.use('/api/pr-review', expressMiddleware({ ... }));
 * ```
 */
export function expressMiddleware(
  options: PrReviewerOptions,
): (req: ExpressLikeRequest, res: ExpressLikeResponse) => void {
  const reviewer = new PrReviewer(options);

  return (req: ExpressLikeRequest, res: ExpressLikeResponse) => {
    const authHeader =
      req.headers["authorization"] ?? req.headers["Authorization"];
    const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;

    if (!reviewer.verifyWebhook(headerValue)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    res.status(200).json({ received: true });

    // Fire-and-forget — errors are handled internally
    reviewer.handleWebhook(req.body).catch(() => {});
  };
}

/** Minimal Express-like request shape (avoids requiring express as a dependency) */
interface ExpressLikeRequest {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

/** Minimal Express-like response shape */
interface ExpressLikeResponse {
  status(code: number): ExpressLikeResponse;
  json(body: unknown): void;
}

// Re-export types and classes for consumers
export { PrReviewer } from "./reviewer";
export type {
  PrReviewerOptions,
  AiConfig,
  AzureOpenAiConfig,
  OpenAiConfig,
  AnthropicConfig,
} from "./config";
export type {
  WebhookPayload,
  ReviewComment,
  ReviewResult,
  PrFileChange,
  PrIteration,
  PrIterationChange,
  ThreadContext,
  PullRequestSummary,
  PrStatusState,
  Logger,
} from "./types";
export { DEFAULTS, SKIP_PATTERNS } from "./config";
