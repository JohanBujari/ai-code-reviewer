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
    const parsed = JSON.parse(responseText) as {
      comments?: ReviewComment[];
    };
    return {
      comments: Array.isArray(parsed.comments) ? parsed.comments : [],
    };
  } catch {
    logger.warn(
      `Failed to parse AI response as JSON. Response started with: ${responseText.slice(0, 120).replace(/\n/g, " ")}`,
    );
    return { comments: [] };
  }
}

/** Split files into chunks that fit within the token limit */
export function chunkFiles(files: PrFileChange[]): PrFileChange[][] {
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
