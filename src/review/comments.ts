import type { AzureDevOpsClient } from "../azure-devops/client";
import { annotateDiffWithLineNumbers } from "../ai/tools";
import { SEVERITY_STYLES, COMMENT_SNAP_DISTANCE } from "../shared/constants";
import type { Logger, PrFileChange, ReviewComment } from "../types";

/** Build an index of which lines in each file were actually added/modified */
export function buildChangedLinesIndex(
  files: PrFileChange[],
): Map<string, Set<number>> {
  const index = new Map<string, Set<number>>();
  for (const file of files) {
    const { changedLines } = annotateDiffWithLineNumbers(file.content);
    index.set(file.filePath, new Set(changedLines.map((cl) => cl.line)));
  }
  return index;
}

/**
 * Validate AI comments against actual changed lines.
 * - Snaps slightly misaligned comments to the nearest changed line
 * - Drops comments that reference lines far from any change
 */
export function validateAndAdjustComments(
  comments: ReviewComment[],
  changedLinesIndex: Map<string, Set<number>>,
  logger: Logger,
): ReviewComment[] {
  const maxSnap = COMMENT_SNAP_DISTANCE;
  const validated: ReviewComment[] = [];

  for (const comment of comments) {
    const changedLines = changedLinesIndex.get(comment.filePath);
    if (!changedLines || changedLines.size === 0) {
      logger.warn(
        `[validate] Dropping comment on ${comment.filePath}:${comment.lineNumber} — file not in changed lines index`,
      );
      continue;
    }

    if (changedLines.has(comment.lineNumber)) {
      validated.push(comment);
      continue;
    }

    // Try to snap to the nearest changed line within ±maxSnap
    let nearest: number | null = null;
    let nearestDist = Infinity;
    for (const line of changedLines) {
      const dist = Math.abs(line - comment.lineNumber);
      if (dist <= maxSnap && dist < nearestDist) {
        nearest = line;
        nearestDist = dist;
      }
    }

    if (nearest !== null) {
      logger.info(
        `[validate] Snapped comment on ${comment.filePath}:${comment.lineNumber} → line ${nearest} (offset ${nearestDist})`,
      );
      validated.push({ ...comment, lineNumber: nearest });
    } else {
      logger.warn(
        `[validate] Dropping comment on ${comment.filePath}:${comment.lineNumber} — not near any changed line`,
      );
    }
  }

  return validated;
}

/** Post a single inline review comment on a PR */
export async function postInlineComment(
  devOps: AzureDevOpsClient,
  project: string,
  repoId: string,
  prId: number,
  comment: ReviewComment,
  logger: Logger,
): Promise<void> {
  const emoji = SEVERITY_STYLES[comment.severity]?.emoji ?? "⚪";
  const startLine = Math.max(comment.lineNumber, 1);
  const endLine = comment.endLineNumber
    ? Math.max(comment.endLineNumber, startLine)
    : startLine;
  const content = `${emoji} **${comment.severity.toUpperCase()}**: ${comment.message}`;

  try {
    await devOps.createCommentThread(project, repoId, prId, content, {
      filePath: comment.filePath,
      rightFileStart: { line: startLine, offset: 1 },
      rightFileEnd: { line: endLine, offset: 1 },
    });
  } catch (error) {
    logger.warn(
      `Failed to post inline comment on ${comment.filePath}:${comment.lineNumber}: ${error}`,
    );
  }
}

/** Post a general error comment on a PR when a review fails */
export async function postErrorComment(
  devOps: AzureDevOpsClient,
  project: string,
  repoId: string,
  prId: number,
  error: unknown,
  logger: Logger,
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
    "*Powered by axiom*",
  ].join("\n");

  try {
    await devOps.createGeneralComment(project, repoId, prId, content);
  } catch (commentError) {
    logger.error(
      `Failed to post error comment on PR #${prId}: ${commentError}`,
    );
  }
}
