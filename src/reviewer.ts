import { createPatch } from "diff";
import type { AiConfig, PrReviewerOptions } from "./config";
import { DEFAULTS, SKIP_PATTERNS } from "./config";
import { AzureDevOpsClient } from "./azure-devops/client";
import type { AiProvider, ReviewContext } from "./ai/provider";
import { SYSTEM_PROMPT } from "./ai/provider";
import { VercelAiProvider } from "./ai/vercel-ai-provider";
import type {
  Logger,
  PrFileChange,
  PrIterationChange,
  ReviewComment,
  ReviewResult,
  WebhookPayload,
} from "./types";

const SEVERITY_EMOJI: Record<string, string> = {
  critical: "🔴",
  warning: "🟡",
  suggestion: "🔵",
  nitpick: "⚪",
};

/** Key files that reveal project conventions and tech stack */
const PROJECT_CONTEXT_FILES = [
  "/README.md",
  "/package.json",
  "/tsconfig.json",
  "/pyproject.toml",
  "/requirements.txt",
  "/.eslintrc.json",
  "/.eslintrc.js",
  "/biome.json",
  "/Cargo.toml",
  "/go.mod",
  "/pom.xml",
  "/build.gradle",
  "/Makefile",
  "/Dockerfile",
  "/docker-compose.yml",
];

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
  private readonly logger: Logger;
  private readonly maxFiles: number;
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
    const payload = body as WebhookPayload;

    if (!payload?.resource?.pullRequestId || !payload?.resource?.repository) {
      this.logger.warn("Invalid webhook payload — missing required fields");
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
      return { comments: [] };
    }

    const latestIteration = iterations[iterations.length - 1];
    const dedupKey = `${prId}-${latestIteration.id}`;
    if (this.isDuplicate(dedupKey)) {
      this.logger.info(`Skipping duplicate review for ${dedupKey}`);
      return { comments: [] };
    }

    try {
      await this.devOps.setPrStatus(
        project,
        repoId,
        prId,
        "pending",
        "AI code review in progress...",
      );

      const changes = await this.devOps.getIterationChanges(
        project,
        repoId,
        prId,
        latestIteration.id,
      );

      const reviewableChanges = this.filterReviewableChanges(changes);
      const cappedChanges = reviewableChanges.slice(0, this.maxFiles);

      const fileChanges = await this.fetchFileDiffs(
        project,
        repoId,
        cappedChanges,
        latestIteration.targetRefCommit.commitId,
        latestIteration.sourceRefCommit.commitId,
      );

      if (fileChanges.length === 0) {
        this.logger.info(`No reviewable file changes for PR #${prId}`);
        await this.devOps.setPrStatus(
          project,
          repoId,
          prId,
          "succeeded",
          "AI review: No reviewable changes found.",
        );
        return { comments: [] };
      }

      // Build context so the AI can use tools to explore the repo
      const reviewContext: ReviewContext = {
        devOps: this.devOps,
        project,
        repoId,
        prId,
        commitId: latestIteration.sourceRefCommit.commitId,
        logger: this.logger,
        fileChanges,
      };

      // Pre-fetch project context (structure + key config files)
      const projectContext = await this.fetchProjectContext(
        project,
        repoId,
        latestIteration.sourceRefCommit.commitId,
      );

      const reviewResult = await this.runAiReview(
        fileChanges,
        prTitle ?? `PR #${prId}`,
        prDescription,
        reviewContext,
        projectContext,
      );

      for (const comment of reviewResult.comments) {
        await this.postInlineComment(project, repoId, prId, comment);
      }

      const hasCritical = reviewResult.comments.some(
        (c) => c.severity === "critical",
      );
      await this.devOps.setPrStatus(
        project,
        repoId,
        prId,
        hasCritical ? "failed" : "succeeded",
        hasCritical
          ? `AI review: ${reviewResult.comments.length} issue(s) found, including critical`
          : `AI review: ${reviewResult.comments.length} issue(s) found`,
      );

      this.markProcessed(dedupKey);
      this.logger.info(
        `Completed review for PR #${prId}: ${reviewResult.comments.length} comments`,
      );

      return reviewResult;
    } catch (error) {
      this.logger.error(`Review failed for PR #${prId}: ${error}`);
      await this.postErrorComment(project, repoId, prId, error);
      await this.devOps
        .setPrStatus(
          project,
          repoId,
          prId,
          "error",
          "AI review encountered an error",
        )
        .catch((statusError) =>
          this.logger.warn(`Failed to set error status: ${statusError}`),
        );

      return {
        comments: [],
      };
    }
  }

  // ── AI Review ──────────────────────────────────────────────

  private async runAiReview(
    files: PrFileChange[],
    prTitle: string,
    prDescription: string | undefined,
    reviewContext: ReviewContext,
    projectContext?: string,
  ): Promise<ReviewResult> {
    const chunks = this.chunkFiles(files);
    const allComments: ReviewComment[] = [];

    for (const chunk of chunks) {
      const userPrompt = this.buildUserPrompt(
        chunk,
        prTitle,
        prDescription,
        projectContext,
      );
      const responseText = await this.ai.review(
        this.systemPrompt,
        userPrompt,
        reviewContext,
      );
      const result = this.parseReviewResponse(responseText);
      allComments.push(...result.comments);
    }

    return { comments: allComments };
  }

  /**
   * Pre-fetch the repository tree and key config files to build a project
   * context string that is injected into the user prompt. This gives the AI
   * immediate awareness of the tech stack, structure, and conventions —
   * without requiring a tool call round-trip.
   */
  private async fetchProjectContext(
    project: string,
    repoId: string,
    commitId: string,
  ): Promise<string | undefined> {
    try {
      const tree = await this.devOps.getRepoTree(
        project,
        repoId,
        commitId,
        "/",
      );
      if (tree.length === 0) return undefined;

      const skipDirs = [
        "/node_modules",
        "/dist",
        "/.git",
        "/vendor",
        "/__pycache__",
        "/build",
        "/.next",
      ];
      const filtered = tree.filter(
        (item) =>
          !skipDirs.some(
            (skip) =>
              item.path.startsWith(skip) || item.path.includes(`${skip}/`),
          ),
      );

      const treeView = filtered
        .slice(0, 150)
        .map((item) => (item.isFolder ? `${item.path}/` : item.path))
        .join("\n");

      // Read key config files that exist in the repo
      const existingPaths = new Set(tree.map((item) => item.path));
      const configSections: string[] = [];

      for (const filePath of PROJECT_CONTEXT_FILES) {
        if (existingPaths.has(filePath)) {
          const content = await this.devOps.getFileContent(
            project,
            repoId,
            filePath,
            commitId,
          );
          if (content) {
            const truncated =
              content.length > 3_000
                ? content.slice(0, 3_000) + "\n... (truncated)"
                : content;
            configSections.push(
              `### ${filePath}\n\`\`\`\n${truncated}\n\`\`\``,
            );
          }
        }
      }

      const parts = [
        `**Repository structure** (${filtered.filter((i) => !i.isFolder).length} files):\n\`\`\`\n${treeView}\n\`\`\``,
      ];
      if (configSections.length > 0) {
        parts.push(configSections.join("\n\n"));
      }

      return parts.join("\n\n");
    } catch (error) {
      this.logger.warn(`Failed to fetch project context: ${error}`);
      return undefined;
    }
  }

  private buildUserPrompt(
    files: PrFileChange[],
    prTitle: string,
    prDescription?: string,
    projectContext?: string,
  ): string {
    const lines = [`**PR Title:** ${prTitle}`];
    if (prDescription) {
      lines.push(`**PR Description:** ${prDescription}`);
    }
    lines.push(`**Files changed:** ${files.length}`);
    lines.push("");

    if (projectContext) {
      lines.push("## Project Context");
      lines.push(projectContext);
      lines.push("");
    }

    lines.push("## Changed Files");
    lines.push(
      "Use `get_file_diff` to review the diff for each file. " +
        "Use `get_file_content` only if you need the full file for additional context.",
    );
    lines.push("");

    for (const file of files) {
      lines.push(`- **${file.changeType.toUpperCase()}**: \`${file.filePath}\``);
    }

    return lines.join("\n");
  }

  private parseReviewResponse(responseText: string): ReviewResult {
    try {
      const parsed = JSON.parse(responseText) as {
        comments?: ReviewComment[];
      };
      return {
        comments: Array.isArray(parsed.comments) ? parsed.comments : [],
      };
    } catch {
      this.logger.warn("Failed to parse AI response as JSON");
      return {
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
      if (
        currentSize + fileSize > DEFAULTS.maxCharsPerChunk &&
        currentChunk.length > 0
      ) {
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

  private filterReviewableChanges(
    changes: PrIterationChange[],
  ): PrIterationChange[] {
    return changes.filter((change) => {
      if (change.changeType === "delete") return false;
      const path = change.item.path;
      return !this.skipPatterns.some((pattern) => pattern.test(path));
    });
  }

  private async fetchFileDiffs(
    project: string,
    repoId: string,
    changes: PrIterationChange[],
    baseCommitId: string,
    headCommitId: string,
  ): Promise<PrFileChange[]> {
    const fileChanges: PrFileChange[] = [];

    for (let i = 0; i < changes.length; i += DEFAULTS.fileFetchBatchSize) {
      const batch = changes.slice(i, i + DEFAULTS.fileFetchBatchSize);
      const results = await Promise.all(
        batch.map(async (change) => {
          const filePath = change.item.path;
          const isAdd = change.changeType === "add";

          // For new files, base is empty. For edits, fetch both versions.
          const [baseContent, headContent] = await Promise.all([
            isAdd
              ? Promise.resolve("")
              : this.devOps.getFileContent(
                  project,
                  repoId,
                  filePath,
                  baseCommitId,
                ),
            this.devOps.getFileContent(project, repoId, filePath, headCommitId),
          ]);

          if (!headContent) return null;

          // Compute a unified diff showing only what changed
          const patch = createPatch(
            filePath,
            baseContent,
            headContent,
            "base",
            "PR head",
            {
              context: 3,
            },
          );

          return { filePath, changeType: change.changeType, content: patch };
        }),
      );

      fileChanges.push(
        ...results.filter(
          (f): f is PrFileChange => f !== null && f.content.length > 0,
        ),
      );
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
    const emoji = SEVERITY_EMOJI[comment.severity] ?? "⚪";
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


  private async postErrorComment(
    project: string,
    repoId: string,
    prId: number,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const content = [
      "## 🤖 AI Code Review",
      "",
      "⚠️ The automated review encountered an error and could not complete.",
      "",
      `**Error:** ${message}`,
      "",
      "---",
      "*Powered by azure-devops-pr-reviewer*",
    ].join("\n");

    try {
      await this.devOps.createGeneralComment(project, repoId, prId, content);
    } catch (commentError) {
      this.logger.error(
        `Failed to post error comment on PR #${prId}: ${commentError}`,
      );
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
