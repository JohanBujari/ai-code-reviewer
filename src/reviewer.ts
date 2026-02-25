import type { AiConfig, PrReviewerOptions } from './config';
import { DEFAULTS, SKIP_PATTERNS } from './config';
import { AzureDevOpsClient } from './azure-devops/client';
import type { AiProvider } from './ai/provider';
import { SYSTEM_PROMPT } from './ai/provider';
import { AzureOpenAiProvider } from './ai/azure-openai';
import { OpenAiProvider } from './ai/openai';
import { AnthropicProvider } from './ai/anthropic';
import type {
  Logger,
  PrFileChange,
  PrIterationChange,
  ReviewComment,
  ReviewResult,
  WebhookPayload,
} from './types';

const SEVERITY_EMOJI: Record<string, string> = {
  critical: '🔴',
  warning: '🟡',
  suggestion: '🔵',
  nitpick: '⚪',
};

const defaultLogger: Logger = {
  info: (msg) => console.log(`[pr-reviewer] ${msg}`),
  warn: (msg) => console.warn(`[pr-reviewer] ${msg}`),
  error: (msg) => console.error(`[pr-reviewer] ${msg}`),
};

function createAiProvider(config: AiConfig): AiProvider {
  switch (config.provider) {
    case 'azure-openai':
      return new AzureOpenAiProvider(config);
    case 'openai':
      return new OpenAiProvider(config);
    case 'anthropic':
      return new AnthropicProvider(config);
  }
}

export class PrReviewer {
  private readonly devOps: AzureDevOpsClient;
  private readonly ai: AiProvider;
  private readonly logger: Logger;
  private readonly maxFiles: number;
  private readonly maxDiffLength: number;
  private readonly skipPatterns: RegExp[];
  private readonly systemPrompt: string;
  private readonly processedIterations = new Map<string, number>();

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
  }

  /** Verify the webhook Authorization header against the configured secret */
  verifyWebhook(authHeader: string | undefined): boolean {
    if (!authHeader) return false;

    const secret = this.options.webhookSecret;

    // Support raw match
    if (authHeader === secret) return true;

    // Support Basic auth with empty username: "Basic base64(:secret)"
    if (authHeader.startsWith('Basic ')) {
      try {
        const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
        const password = decoded.startsWith(':') ? decoded.slice(1) : decoded;
        return password === secret;
      } catch {
        return false;
      }
    }

    return false;
  }

  /** Handle an incoming Azure DevOps webhook payload (fire-and-forget) */
  async handleWebhook(body: unknown): Promise<void> {
    const payload = body as WebhookPayload;

    if (!payload?.resource?.pullRequestId || !payload?.resource?.repository) {
      this.logger.warn('Invalid webhook payload — missing required fields');
      return;
    }

    await this.reviewPullRequest(
      payload.resource.repository.project.name,
      payload.resource.repository.id,
      payload.resource.pullRequestId,
      payload.resource.title,
      payload.resource.description,
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
      return { summary: 'No iterations found.', comments: [] };
    }

    const latestIteration = iterations[iterations.length - 1];
    const dedupKey = `${prId}-${latestIteration.id}`;
    if (this.isDuplicate(dedupKey)) {
      this.logger.info(`Skipping duplicate review for ${dedupKey}`);
      return { summary: 'Duplicate review skipped.', comments: [] };
    }

    try {
      await this.devOps.setPrStatus(project, repoId, prId, 'pending', 'AI code review in progress...');

      const changes = await this.devOps.getIterationChanges(
        project,
        repoId,
        prId,
        latestIteration.id,
      );

      const reviewableChanges = this.filterReviewableChanges(changes);
      const cappedChanges = reviewableChanges.slice(0, this.maxFiles);
      const skippedCount = reviewableChanges.length - cappedChanges.length;

      const fileChanges = await this.fetchFileContents(
        project,
        repoId,
        cappedChanges,
        latestIteration.sourceRefCommit.commitId,
      );

      if (fileChanges.length === 0) {
        this.logger.info(`No reviewable file changes for PR #${prId}`);
        await this.devOps.setPrStatus(
          project,
          repoId,
          prId,
          'succeeded',
          'AI review: No reviewable changes found.',
        );
        return { summary: 'No reviewable changes found.', comments: [] };
      }

      const reviewResult = await this.runAiReview(fileChanges, prTitle ?? `PR #${prId}`, prDescription);

      for (const comment of reviewResult.comments) {
        await this.postInlineComment(project, repoId, prId, comment);
      }

      const summaryMarkdown = this.buildSummaryComment(
        reviewResult.summary,
        reviewResult.comments,
        fileChanges.length,
        skippedCount,
      );
      await this.devOps.createGeneralComment(project, repoId, prId, summaryMarkdown);

      const hasCritical = reviewResult.comments.some((c) => c.severity === 'critical');
      await this.devOps.setPrStatus(
        project,
        repoId,
        prId,
        hasCritical ? 'failed' : 'succeeded',
        hasCritical
          ? `AI review: ${reviewResult.comments.length} issue(s) found, including critical`
          : `AI review: ${reviewResult.comments.length} issue(s) found`,
      );

      this.markProcessed(dedupKey);
      this.logger.info(`Completed review for PR #${prId}: ${reviewResult.comments.length} comments`);

      return reviewResult;
    } catch (error) {
      this.logger.error(`Review failed for PR #${prId}: ${error}`);
      await this.postErrorComment(project, repoId, prId, error);
      await this.devOps
        .setPrStatus(project, repoId, prId, 'error', 'AI review encountered an error')
        .catch((statusError) => this.logger.warn(`Failed to set error status: ${statusError}`));

      return {
        summary: 'AI review encountered an error.',
        comments: [],
      };
    }
  }

  // ── AI Review ──────────────────────────────────────────────

  private async runAiReview(
    files: PrFileChange[],
    prTitle: string,
    prDescription?: string,
  ): Promise<ReviewResult> {
    const chunks = this.chunkFiles(files);
    const allComments: ReviewComment[] = [];
    const summaries: string[] = [];

    for (const chunk of chunks) {
      const userPrompt = this.buildUserPrompt(chunk, prTitle, prDescription);
      const responseText = await this.ai.review(this.systemPrompt, userPrompt);
      const result = this.parseReviewResponse(responseText);
      allComments.push(...result.comments);
      summaries.push(result.summary);
    }

    const combinedSummary =
      summaries.length === 1
        ? summaries[0]
        : `Review across ${chunks.length} chunks:\n\n${summaries
            .map((s, i) => `**Part ${i + 1}:** ${s}`)
            .join('\n\n')}`;

    return { summary: combinedSummary, comments: allComments };
  }

  private buildUserPrompt(files: PrFileChange[], prTitle: string, prDescription?: string): string {
    const header = [`**PR Title:** ${prTitle}`];
    if (prDescription) {
      header.push(`**PR Description:** ${prDescription}`);
    }
    header.push(`**Files changed:** ${files.length}`);
    header.push('');

    const fileBlocks = files.map((file) => {
      const truncated =
        file.content.length > this.maxDiffLength
          ? file.content.slice(0, this.maxDiffLength) + '\n... (truncated, file too large)'
          : file.content;

      return `### ${file.changeType.toUpperCase()}: ${file.filePath}\n\`\`\`\n${truncated}\n\`\`\``;
    });

    return header.join('\n') + fileBlocks.join('\n\n');
  }

  private parseReviewResponse(responseText: string): ReviewResult {
    try {
      const parsed = JSON.parse(responseText) as {
        summary?: string;
        comments?: ReviewComment[];
      };
      return {
        summary: parsed.summary ?? 'No summary provided.',
        comments: Array.isArray(parsed.comments) ? parsed.comments : [],
      };
    } catch {
      this.logger.warn('Failed to parse AI response as JSON');
      return {
        summary: responseText.slice(0, 2000),
        comments: [],
      };
    }
  }

  private chunkFiles(files: PrFileChange[]): PrFileChange[][] {
    const chunks: PrFileChange[][] = [];
    let currentChunk: PrFileChange[] = [];
    let currentSize = 0;

    for (const file of files) {
      const fileSize = file.content.length + file.filePath.length + 100;
      if (currentSize + fileSize > DEFAULTS.maxCharsPerChunk && currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentSize = 0;
      }
      currentChunk.push(file);
      currentSize += fileSize;
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  // ── File Fetching ──────────────────────────────────────────

  private filterReviewableChanges(changes: PrIterationChange[]): PrIterationChange[] {
    return changes.filter((change) => {
      if (change.changeType === 'delete') return false;
      const path = change.item.path;
      return !this.skipPatterns.some((pattern) => pattern.test(path));
    });
  }

  private async fetchFileContents(
    project: string,
    repoId: string,
    changes: PrIterationChange[],
    commitId: string,
  ): Promise<PrFileChange[]> {
    const fileChanges: PrFileChange[] = [];

    for (let i = 0; i < changes.length; i += DEFAULTS.fileFetchBatchSize) {
      const batch = changes.slice(i, i + DEFAULTS.fileFetchBatchSize);
      const results = await Promise.all(
        batch.map(async (change) => {
          const content = await this.devOps.getFileContent(
            project,
            repoId,
            change.item.path,
            commitId,
          );
          return { filePath: change.item.path, changeType: change.changeType, content };
        }),
      );
      fileChanges.push(...results.filter((f) => f.content.length > 0));
    }

    return fileChanges;
  }

  // ── Azure DevOps Comments ──────────────────────────────────

  private async postInlineComment(
    project: string,
    repoId: string,
    prId: number,
    comment: ReviewComment,
  ): Promise<void> {
    const emoji = SEVERITY_EMOJI[comment.severity] ?? '⚪';
    const lineNumber = Math.max(comment.lineNumber, 1);
    const content = `${emoji} **${comment.severity.toUpperCase()}**: ${comment.message}`;

    try {
      await this.devOps.createCommentThread(project, repoId, prId, content, {
        filePath: comment.filePath,
        rightFileStart: { line: lineNumber, offset: 1 },
        rightFileEnd: { line: lineNumber, offset: 1 },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to post inline comment on ${comment.filePath}:${comment.lineNumber}: ${error}`,
      );
    }
  }

  private buildSummaryComment(
    summary: string,
    comments: ReviewComment[],
    filesReviewed: number,
    skippedCount: number,
  ): string {
    const providerName = this.options.ai.provider;
    const lines = ['## 🤖 AI Code Review Summary', '', summary, '', `**Files reviewed:** ${filesReviewed}`];

    if (skippedCount > 0) {
      lines.push(`**Files skipped (over limit):** ${skippedCount} (max ${this.maxFiles})`);
    }

    if (comments.length > 0) {
      const bySeverity = comments.reduce(
        (acc, c) => {
          acc[c.severity] = (acc[c.severity] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      lines.push('', '**Issues found:**');
      for (const [severity, count] of Object.entries(bySeverity)) {
        const emoji = SEVERITY_EMOJI[severity] ?? '⚪';
        lines.push(`- ${emoji} ${severity}: ${count}`);
      }
    } else {
      lines.push('', '✅ No issues found. Code looks good!');
    }

    lines.push('', '---', `*Powered by ${providerName} • azure-devops-pr-reviewer*`);
    return lines.join('\n');
  }

  private async postErrorComment(
    project: string,
    repoId: string,
    prId: number,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const content = [
      '## 🤖 AI Code Review',
      '',
      '⚠️ The automated review encountered an error and could not complete.',
      '',
      `**Error:** ${message}`,
      '',
      '---',
      '*Powered by azure-devops-pr-reviewer*',
    ].join('\n');

    try {
      await this.devOps.createGeneralComment(project, repoId, prId, content);
    } catch (commentError) {
      this.logger.error(`Failed to post error comment on PR #${prId}: ${commentError}`);
    }
  }

  // ── Deduplication ──────────────────────────────────────────

  private isDuplicate(key: string): boolean {
    const timestamp = this.processedIterations.get(key);
    if (!timestamp) return false;
    if (Date.now() - timestamp > DEFAULTS.dedupTtlMs) {
      this.processedIterations.delete(key);
      return false;
    }
    return true;
  }

  private markProcessed(key: string): void {
    this.processedIterations.set(key, Date.now());

    if (this.processedIterations.size > 1000) {
      const now = Date.now();
      for (const [k, v] of this.processedIterations) {
        if (now - v > DEFAULTS.dedupTtlMs) {
          this.processedIterations.delete(k);
        }
      }
    }
  }
}
