import { z } from "zod";
import type { AiConfig, PrReviewerOptions } from "./config";
import { DEFAULTS, SKIP_PATTERNS } from "./config";
import { AzureDevOpsClient } from "./azure-devops/client";
import type { AiProvider, ReviewContext } from "./ai/provider";
import { SYSTEM_PROMPT } from "./ai/provider";
import { VercelAiProvider } from "./ai/vercel-ai-provider";
import type {
  Logger,
  PrFileChange,
  ReviewComment,
  ReviewResult,
} from "./types";
import { ReviewDeduplicator } from "./review/dedup";
import { buildChangedLinesIndex, validateAndAdjustComments, postInlineComment, postErrorComment } from "./review/comments";
import { filterReviewableChanges, fetchFileDiffs, fetchProjectContext } from "./review/file-fetcher";
import { buildUserPrompt, parseReviewResponse, chunkFiles } from "./review/prompt";

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

function createAiProvider(config: AiConfig): AiProvider {
  return new VercelAiProvider(config);
}

export class PrReviewer {
  private readonly devOps: AzureDevOpsClient;
  private readonly ai: AiProvider;
  readonly logger: Logger;
  private readonly maxFiles: number;
  private readonly skipPatterns: RegExp[];
  private readonly systemPrompt: string;
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
    this.skipPatterns = options.skipPatterns ?? SKIP_PATTERNS;
    this.systemPrompt = options.customPrompt ?? SYSTEM_PROMPT;
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
  ): Promise<ReviewResult> {
    this.logger.info(`Starting review for PR #${prId} in ${project}`);

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

      const fileChanges = await fetchFileDiffs(
        this.devOps,
        project,
        repoId,
        cappedChanges,
        latestIteration.targetRefCommit.commitId,
        latestIteration.sourceRefCommit.commitId,
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
      );

      for (const comment of reviewResult.comments) {
        await postInlineComment(this.devOps, project, repoId, prId, comment, this.logger);
      }

      const hasCritical = reviewResult.comments.some((c) => c.severity === "critical");
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

  // ── AI Review ──

  private async runAiReview(
    files: PrFileChange[],
    prTitle: string,
    prDescription: string | undefined,
    reviewContext: ReviewContext,
    projectContext?: string,
  ): Promise<ReviewResult> {
    const chunks = chunkFiles(files);
    const allComments: ReviewComment[] = [];
    const changedLinesIndex = buildChangedLinesIndex(files);

    for (const chunk of chunks) {
      const userPrompt = buildUserPrompt(chunk, prTitle, prDescription, projectContext);
      const responseText = await this.ai.review(this.systemPrompt, userPrompt, reviewContext);
      const result = parseReviewResponse(responseText, this.logger);
      allComments.push(...result.comments);
    }

    const validatedComments = validateAndAdjustComments(allComments, changedLinesIndex, this.logger);

    this.logger.info(`[review] ${allComments.length} raw comments → ${validatedComments.length} validated`);

    return { comments: validatedComments };
  }
}
