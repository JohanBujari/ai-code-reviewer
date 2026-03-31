import { z } from "zod";
import type { AiConfig, PrReviewerOptions } from "./config";
import { DEFAULTS, SKIP_PATTERNS } from "./config";
import { AzureDevOpsClient } from "./azure-devops/client";
import type { AiProvider, ReviewContext } from "./ai/provider";
import { CLI_SYSTEM_PROMPT, SYSTEM_PROMPT } from "./ai/provider";
import { createAiProvider } from "./ai/factory";
import { isCliAuthConfig } from "./ai/provider-status";
import type {
  Logger,
  PrFileChange,
  ReviewComment,
  ReviewResult,
  ReviewProgressUpdate,
} from "./types";
import { ReviewDeduplicator } from "./review/dedup";
import { buildChangedLinesIndex, validateAndAdjustComments, postInlineComment, postErrorComment } from "./review/comments";
import { filterReviewableChanges, fetchFileDiffs, fetchProjectContext } from "./review/file-fetcher";
import {
  buildEmbeddedReviewPrompt,
  buildUserPrompt,
  parseReviewResponse,
  chunkFiles,
  chunkFilesByPromptSize,
} from "./review/prompt";

const WebhookPayloadSchema = z.object({
  resource: z.object({
    repository: z.object({
      id: z.string(),
      name: z.string(),
      project: z.object({ id: z.string(), name: z.string() }),
    }),
    pullRequestId: z.number(),
    title: z.string(),
    description: z.string().optional(),
    sourceRefName: z.string(),
    targetRefName: z.string(),
    status: z.string(),
  }),
});

const defaultLogger: Logger = {
  info: (msg) => console.log(`[pr-reviewer] ${msg}`),
  warn: (msg) => console.warn(`[pr-reviewer] ${msg}`),
  error: (msg) => console.error(`[pr-reviewer] ${msg}`),
};

export class PrReviewer {
  private readonly devOps: AzureDevOpsClient;
  private readonly ai: AiProvider;
  readonly logger: Logger;
  private readonly maxFiles: number;
  private readonly maxDiffLength: number;
  private readonly skipPatterns: RegExp[];
  private readonly systemPrompt: string;
  private readonly cliSystemPrompt: string;
  private readonly dedup = new ReviewDeduplicator();

  constructor(private readonly options: PrReviewerOptions) {
    this.logger = options.logger ?? defaultLogger;
    this.devOps = new AzureDevOpsClient(
      options.azureDevOps.org,
      options.azureDevOps.pat,
      this.logger,
    );
    this.ai = createAiProvider(options.ai);
    this.maxFiles = options.maxFiles ?? DEFAULTS.maxFiles;
    this.maxDiffLength = options.maxDiffLength ?? DEFAULTS.maxDiffLength;
    this.skipPatterns = options.skipPatterns ?? SKIP_PATTERNS;
    this.systemPrompt = options.customPrompt ?? SYSTEM_PROMPT;
    this.cliSystemPrompt = options.customPrompt ?? CLI_SYSTEM_PROMPT;
  }

  /** Verify the webhook Authorization header against the configured secret */
  verifyWebhook(authHeader: string | undefined): boolean {
    if (!authHeader) return false;

    const secret = this.options.webhookSecret;

    if (authHeader === secret) return true;

    if (authHeader.startsWith("Basic ")) {
      try {
        const decoded = Buffer.from(authHeader.slice(6), "base64").toString();
        const password = decoded.startsWith(":") ? decoded.slice(1) : decoded;
        return password === secret;
      } catch {
        return false;
      }
    }

    return false;
  }

  /** Handle an incoming Azure DevOps webhook payload (fire-and-forget) */
  async handleWebhook(body: unknown): Promise<void> {
    const result = WebhookPayloadSchema.safeParse(body);
    if (!result.success) {
      this.logger.warn(`Invalid webhook payload: ${result.error.message}`);
      return;
    }

    const { resource } = result.data;
    await this.reviewPullRequest(
      resource.repository.project.name,
      resource.repository.id,
      resource.pullRequestId,
      resource.title,
      resource.description,
    );
  }

  /** Run a full AI review on a pull request */
  async reviewPullRequest(
    project: string,
    repoId: string,
    prId: number,
    prTitle?: string,
    prDescription?: string,
    onProgress?: (progress: ReviewProgressUpdate) => void,
  ): Promise<ReviewResult> {
    this.logger.info(`Starting review for PR #${prId} in ${project}`);
    this.reportStage(onProgress, "Loading pull request metadata");

    const iterations = await this.devOps.getPrIterations(project, repoId, prId);
    if (iterations.length === 0) {
      this.logger.warn(`No iterations found for PR #${prId}`);
      return { comments: [] };
    }

    const latestIteration = iterations[iterations.length - 1];
    const dedupKey = `${prId}-${latestIteration.id}`;
    if (this.dedup.isDuplicate(dedupKey)) {
      this.logger.info(`Skipping duplicate review for ${dedupKey}`);
      return { comments: [] };
    }

    try {
      await this.devOps.setPrStatus(project, repoId, prId, "pending", "AI code review in progress...");

      const changes = await this.devOps.getIterationChanges(project, repoId, prId, latestIteration.id);
      const reviewableChanges = filterReviewableChanges(changes, this.skipPatterns);
      const cappedChanges = reviewableChanges.slice(0, this.maxFiles);
      const reviewScopeSummary = formatReviewScopeSummary(
        changes.length,
        reviewableChanges.length,
        cappedChanges.length,
      );
      this.logger.info(`[review] ${reviewScopeSummary}`);
      this.reportStage(
        onProgress,
        "Downloading file diffs",
        reviewScopeSummary,
      );

      const fileChanges = await fetchFileDiffs(
        this.devOps,
        project,
        repoId,
        cappedChanges,
        latestIteration.targetRefCommit.commitId,
        latestIteration.sourceRefCommit.commitId,
        this.maxDiffLength,
        (progress) => this.reportProgress(onProgress, { kind: "file", ...progress }),
      );

      if (fileChanges.length === 0) {
        this.logger.info(`No reviewable file changes for PR #${prId}`);
        await this.devOps.setPrStatus(project, repoId, prId, "succeeded", "AI review: No reviewable changes found.");
        return { comments: [] };
      }

      const reviewContext: ReviewContext = {
        devOps: this.devOps,
        project,
        repoId,
        prId,
        commitId: latestIteration.sourceRefCommit.commitId,
        logger: this.logger,
        fileChanges,
      };

      this.reportStage(
        onProgress,
        "Loading repository context",
        `${fileChanges.length} changed file${fileChanges.length === 1 ? "" : "s"}`,
      );
      const projectContext = await fetchProjectContext(
        this.devOps,
        project,
        repoId,
        latestIteration.sourceRefCommit.commitId,
        this.logger,
      );

      const reviewResult = await this.runAiReview(
        fileChanges,
        prTitle ?? `PR #${prId}`,
        prDescription,
        reviewContext,
        projectContext,
        onProgress,
        reviewScopeSummary,
      );

      this.reportStage(
        onProgress,
        "Posting review comments",
        `${reviewResult.comments.length} comment${reviewResult.comments.length === 1 ? "" : "s"}`,
      );
      for (const comment of reviewResult.comments) {
        await postInlineComment(this.devOps, project, repoId, prId, comment, this.logger);
      }

      const hasCritical = reviewResult.comments.some((c) => c.severity === "critical");
      this.reportStage(onProgress, "Finalizing pull request status");
      await this.devOps.setPrStatus(
        project,
        repoId,
        prId,
        hasCritical ? "failed" : "succeeded",
        hasCritical
          ? `AI review: ${reviewResult.comments.length} issue(s) found, including critical`
          : `AI review: ${reviewResult.comments.length} issue(s) found`,
      );

      this.dedup.markProcessed(dedupKey);
      this.logger.info(`Completed review for PR #${prId}: ${reviewResult.comments.length} comments`);

      return reviewResult;
    } catch (error) {
      this.logger.error(`Review failed for PR #${prId}: ${error}`);
      await postErrorComment(this.devOps, project, repoId, prId, error, this.logger);
      await this.devOps
        .setPrStatus(project, repoId, prId, "error", "AI review encountered an error")
        .catch((statusError) => this.logger.warn(`Failed to set error status: ${statusError}`));

      return { comments: [] };
    }
  }

  clearRecentReviews(): number {
    return this.dedup.clear();
  }

  // ── AI Review ──

  private async runAiReview(
    files: PrFileChange[],
    prTitle: string,
    prDescription: string | undefined,
    reviewContext: ReviewContext,
    projectContext?: string,
    onProgress?: (progress: ReviewProgressUpdate) => void,
    reviewScopeSummary?: string,
  ): Promise<ReviewResult> {
    const useCliPrompt = isCliAuthConfig(this.options.ai);
    const allComments: ReviewComment[] = [];
    const changedLinesIndex = buildChangedLinesIndex(files);
    const existingThreads = useCliPrompt
      ? (this.reportStage(onProgress, "Summarizing existing PR discussion"),
        await this.fetchExistingThreadSummary(
          reviewContext.project,
          reviewContext.repoId,
          reviewContext.prId,
        ))
      : [];
    const chunks = useCliPrompt
      ? chunkFilesByPromptSize(
          files,
          (chunk) =>
            buildEmbeddedReviewPrompt(
              chunk,
              prTitle,
              prDescription,
              projectContext,
              existingThreads,
            ),
          DEFAULTS.maxCliCharsPerChunk,
        )
      : chunkFiles(files, DEFAULTS.maxCharsPerChunk);
    const providerLabel = this.options.ai.provider.charAt(0).toUpperCase() + this.options.ai.provider.slice(1);

    if (useCliPrompt && chunks.length > 1) {
      this.logger.info(
        `[review] split CLI review into ${chunks.length} chunk(s) using rendered prompt size`,
      );
    }

    for (const [chunkIndex, chunk] of chunks.entries()) {
      const chunkDetail =
        chunks.length > 1
          ? `Chunk ${chunkIndex + 1}/${chunks.length} • ${chunk.length} file${chunk.length === 1 ? "" : "s"}`
          : `${chunk.length} file${chunk.length === 1 ? "" : "s"}`;
      this.reportStage(onProgress, "Preparing review packet", chunkDetail);
      const userPrompt = useCliPrompt
        ? buildEmbeddedReviewPrompt(
            chunk,
            prTitle,
            prDescription,
            projectContext,
            existingThreads,
          )
        : buildUserPrompt(chunk, prTitle, prDescription, projectContext);
      const systemPrompt = useCliPrompt ? this.cliSystemPrompt : this.systemPrompt;
      const promptChars = systemPrompt.length + userPrompt.length;
      const scopePrefix = reviewScopeSummary ? `${reviewScopeSummary} • ` : "";
      const waitingDetail =
        useCliPrompt && this.options.ai.provider === "codex"
          ? `${scopePrefix}${chunkDetail} • ${Math.round(promptChars / 1000)}k chars • Codex can take a few minutes on larger PRs`
          : `${scopePrefix}${chunkDetail}${useCliPrompt ? ` • ~${promptChars} chars` : ""}`;
      this.reportStage(
        onProgress,
        `Waiting for ${providerLabel} response`,
        waitingDetail,
      );
      this.logger.info(
        `[review] waiting for ${this.options.ai.provider} response (${chunkDetail}, ~${promptChars} chars)`,
      );
      const responseText = await this.ai.review(systemPrompt, userPrompt, reviewContext);
      this.reportStage(
        onProgress,
        `Parsing ${providerLabel} response`,
        chunkDetail,
      );
      const result = parseReviewResponse(responseText, this.logger);
      allComments.push(...result.comments);
    }

    this.reportStage(onProgress, "Validating review comments");
    const validatedComments = validateAndAdjustComments(allComments, changedLinesIndex, this.logger);

    this.logger.info(`[review] ${allComments.length} raw comments → ${validatedComments.length} validated`);

    return { comments: validatedComments };
  }

  private async fetchExistingThreadSummary(
    project: string,
    repoId: string,
    prId: number,
  ): Promise<Array<{ id: number; status: string; firstComment: string }>> {
    try {
      const threads = await this.devOps.getPrThreads(project, repoId, prId);
      return threads.slice(0, 10).map((thread) => ({
        id: thread.id,
        status: thread.status,
        firstComment: (thread.comments[0]?.content ?? "")
          .replace(/\s+/g, " ")
          .slice(0, 300),
      }));
    } catch (error) {
      this.logger.warn(`Failed to fetch existing PR threads: ${error}`);
      return [];
    }
  }

  private reportStage(
    onProgress: ((progress: ReviewProgressUpdate) => void) | undefined,
    label: string,
    detail?: string,
  ): void {
    this.reportProgress(onProgress, { kind: "stage", label, detail });
  }

  private reportProgress(
    onProgress: ((progress: ReviewProgressUpdate) => void) | undefined,
    progress: ReviewProgressUpdate,
  ): void {
    onProgress?.(progress);
  }
}

function formatReviewScopeSummary(
  totalChanged: number,
  reviewable: number,
  selected: number,
): string {
  const parts = [`${totalChanged} changed`, `${reviewable} reviewable`];

  if (selected < reviewable) {
    parts.push(`capped to ${selected}`);
  } else {
    parts.push(`reviewing ${selected}`);
  }

  return parts.join(" • ");
}
