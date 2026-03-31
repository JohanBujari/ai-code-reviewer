import { annotateDiffWithLineNumbers } from "../ai/tools";
import { extractJson } from "../ai/extract-json";
import { DEFAULTS } from "../config";
import type { Logger, PrFileChange, ReviewComment, ReviewResult } from "../types";

/** Build the user prompt for the AI reviewer */
export function buildUserPrompt(
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
    lines.push(
      `- **${file.changeType.toUpperCase()}**: \`${file.filePath}\``,
    );
  }

  return lines.join("\n");
}

/** Parse the AI's JSON response into a ReviewResult */
export function parseReviewResponse(
  responseText: string,
  logger: Logger,
): ReviewResult {
  try {
    const parsed = JSON.parse(extractJson(responseText)) as {
      comments?: Array<ReviewComment & { endLineNumber?: number | null }>;
    };
    return {
      comments: Array.isArray(parsed.comments)
        ? parsed.comments.map((comment) => {
            const { endLineNumber, ...rest } = comment;
            return endLineNumber == null
              ? rest
              : { ...rest, endLineNumber };
          })
        : [],
    };
  } catch {
    logger.warn(
      `Failed to parse AI response as JSON. Response started with: ${responseText.slice(0, 120).replace(/\n/g, " ")}`,
    );
    return { comments: [] };
  }
}

/** Split files into chunks that fit within the token limit */
export function chunkFiles(
  files: PrFileChange[],
  maxCharsPerChunk: number = DEFAULTS.maxCharsPerChunk,
): PrFileChange[][] {
  const chunks: PrFileChange[][] = [];
  let currentChunk: PrFileChange[] = [];
  let currentSize = 0;

  for (const file of files) {
    const fileSize = file.content.length + file.filePath.length + 100;
    if (
      currentSize + fileSize > maxCharsPerChunk &&
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

/** Split files using the fully rendered prompt size rather than raw diff size. */
export function chunkFilesByPromptSize(
  files: PrFileChange[],
  renderPrompt: (chunk: PrFileChange[]) => string,
  maxPromptChars: number,
): PrFileChange[][] {
  const chunks: PrFileChange[][] = [];
  let currentChunk: PrFileChange[] = [];

  for (const file of files) {
    const candidateChunk = [...currentChunk, file];
    const candidateSize = renderPrompt(candidateChunk).length;

    if (candidateSize > maxPromptChars && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [file];
      continue;
    }

    currentChunk = candidateChunk;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

export interface ExistingPrThreadSummary {
  id: number;
  status: string;
  firstComment: string;
}

/** Build a self-contained review packet for external provider CLIs. */
export function buildEmbeddedReviewPrompt(
  files: PrFileChange[],
  prTitle: string,
  prDescription?: string,
  projectContext?: string,
  existingThreads: ExistingPrThreadSummary[] = [],
): string {
  const lines = [`# PR Review Packet`, "", `PR Title: ${prTitle}`];

  if (prDescription) {
    lines.push(`PR Description: ${prDescription}`);
  }

  lines.push(`Files Changed: ${files.length}`);
  lines.push("");

  if (projectContext) {
    lines.push("## Project Context");
    lines.push(projectContext);
    lines.push("");
  }

  lines.push("## Existing PR Discussion");
  if (existingThreads.length === 0) {
    lines.push("No prior discussion threads were found.");
  } else {
    for (const thread of existingThreads) {
      lines.push(
        `- Thread #${thread.id} [${thread.status}]: ${thread.firstComment}`,
      );
    }
  }
  lines.push("");

  lines.push("## Changed Files");
  lines.push(
    "Review only the added/modified lines listed under each file. The line numbers below are the exact line numbers in the new version of the file.",
  );
  lines.push("");

  for (const file of files) {
    const { changedLines } = annotateDiffWithLineNumbers(file.content);
    lines.push(`### ${file.filePath} (${file.changeType.toUpperCase()})`);
    lines.push("Changed lines:");
    if (changedLines.length === 0) {
      lines.push("- No changed lines detected");
    } else {
      for (const entry of changedLines) {
        lines.push(`- ${entry.line}: ${entry.content}`);
      }
    }
    lines.push("");
    lines.push("Unified diff:");
    lines.push("```diff");
    lines.push(file.content);
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}
