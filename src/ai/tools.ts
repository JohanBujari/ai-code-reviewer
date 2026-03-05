import { tool } from 'ai';
import { z } from 'zod';
import type { ReviewContext } from './provider';

/** A single line from an annotated diff with its new-file line number */
export interface AnnotatedDiffLine {
  /** Line number in the new version of the file (null for deleted lines) */
  newLine: number | null;
  /** Line number in the old version of the file (null for added lines) */
  oldLine: number | null;
  type: 'added' | 'deleted' | 'context';
  content: string;
}

/**
 * Parse a unified diff and annotate each line with its actual file line numbers.
 * This makes it trivial for the AI to map diff lines → new-file line numbers.
 */
export function annotateDiffWithLineNumbers(diff: string): {
  lines: AnnotatedDiffLine[];
  changedLines: { line: number; content: string }[];
} {
  const lines: AnnotatedDiffLine[] = [];
  const changedLines: { line: number; content: string }[] = [];

  let newLine = 0;
  let oldLine = 0;

  for (const rawLine of diff.split('\n')) {
    // Hunk header: @@ -oldStart,oldCount +newStart,newCount @@
    const hunkMatch = rawLine.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
    if (hunkMatch) {
      oldLine = parseInt(hunkMatch[1], 10);
      newLine = parseInt(hunkMatch[2], 10);
      continue;
    }

    // Skip diff metadata lines (---, +++, diff, index, etc.)
    if (
      rawLine.startsWith('---') ||
      rawLine.startsWith('+++') ||
      rawLine.startsWith('diff ') ||
      rawLine.startsWith('index ') ||
      rawLine.startsWith('\\')
    ) {
      continue;
    }

    if (rawLine.startsWith('+')) {
      const content = rawLine.slice(1);
      lines.push({ newLine, oldLine: null, type: 'added', content });
      changedLines.push({ line: newLine, content });
      newLine++;
    } else if (rawLine.startsWith('-')) {
      const content = rawLine.slice(1);
      lines.push({ newLine: null, oldLine, type: 'deleted', content });
      oldLine++;
    } else if (newLine > 0) {
      // Context line (unchanged)
      const content = rawLine.startsWith(' ') ? rawLine.slice(1) : rawLine;
      lines.push({ newLine, oldLine, type: 'context', content });
      newLine++;
      oldLine++;
    }
  }

  return { lines, changedLines };
}

import {
  PROJECT_CONTEXT_FILES,
  SKIP_DIRS,
  MAX_TOOL_TREE_VIEW_ITEMS,
  MAX_TOOL_CONFIG_FILE_CHARS,
  MAX_TOOL_CONTENT_CHARS,
  MAX_PR_THREADS_RETURNED,
  MAX_FILE_HISTORY_COMMITS,
  MAX_CONTEXT_LINES,
} from '../shared/constants';

/**
 * Create the set of tools the AI reviewer can use during a review.
 * Each tool wraps an Azure DevOps API call, giving the model the ability
 * to explore the codebase beyond just the changed files.
 */
export function createReviewTools(ctx: ReviewContext) {
  return {
    /**
     * Scan the repository structure and read key config files to understand
     * the project's tech stack, architecture, and conventions.
     */
    get_project_structure: tool({
      description:
        'Scan the repository directory tree and read key project files (package.json, tsconfig, README, etc.) ' +
        'to understand the project structure, tech stack, patterns, and conventions. ' +
        'ALWAYS call this tool first before reviewing code — it gives you essential context.',
      parameters: z.object({
        scopePath: z
          .string()
          .describe('Root path to scan from, use "/" for the repo root'),
      }),
      execute: async ({ scopePath = '/' }) => {
        ctx.logger.info(`[tool] get_project_structure: scanning ${scopePath}`);

        // 1. Get the directory tree
        const tree = await ctx.devOps.getRepoTree(ctx.project, ctx.repoId, ctx.commitId, scopePath);

        // Build a compact tree view (skip noisy directories)
        const filteredTree = tree.filter(
          (item) => !SKIP_DIRS.some((skip) => item.path.startsWith(skip) || item.path.includes(`${skip}/`)),
        );

        // Limit to avoid huge outputs
        const treeView = filteredTree
          .slice(0, MAX_TOOL_TREE_VIEW_ITEMS)
          .map((item) => (item.isFolder ? `${item.path}/` : item.path))
          .join('\n');

        // 2. Auto-read key config files that exist in the repo
        const existingPaths = new Set(tree.map((item) => item.path));
        const contextFiles: Record<string, string> = {};

        for (const filePath of PROJECT_CONTEXT_FILES) {
          if (existingPaths.has(filePath)) {
            const content = await ctx.devOps.getFileContent(
              ctx.project,
              ctx.repoId,
              filePath,
              ctx.commitId,
            );
            if (content) {
              // Truncate large files (e.g. big READMEs)
              contextFiles[filePath] = content.length > MAX_TOOL_CONFIG_FILE_CHARS
                ? content.slice(0, MAX_TOOL_CONFIG_FILE_CHARS) + '\n... (truncated)'
                : content;
            }
          }
        }

        return {
          totalFiles: filteredTree.filter((i) => !i.isFolder).length,
          totalFolders: filteredTree.filter((i) => i.isFolder).length,
          tree: treeView,
          projectFiles: contextFiles,
        };
      },
    }),

    /**
     * Get the diff (changes only) for a specific file in this PR.
     * This is the PRIMARY tool for reviewing — it shows only what was
     * added, modified, or deleted in unified diff format.
     */
    get_file_diff: tool({
      description:
        'Get the diff (changes only) for a file changed in this PR. Returns a unified diff showing ' +
        'only added (+), removed (-), and a few context lines. This is your PRIMARY tool for reviewing code — ' +
        'call it for each file you want to review. Lines starting with "+" are additions, "-" are deletions.',
      parameters: z.object({
        filePath: z
          .string()
          .describe('Path of the changed file, e.g. /src/utils/auth.ts'),
      }),
      execute: async ({ filePath }) => {
        ctx.logger.info(`[tool] get_file_diff: ${filePath}`);
        const change = ctx.fileChanges.find((f) => f.filePath === filePath);
        if (!change) {
          return { error: `File not found in PR changes: ${filePath}. Use get_file_content to read files that were not changed.` };
        }
        const truncated = change.content.length > MAX_TOOL_CONTENT_CHARS;
        const diffContent = truncated ? change.content.slice(0, MAX_TOOL_CONTENT_CHARS) + '\n... (truncated)' : change.content;

        // Annotate diff with new-file line numbers for accurate commenting
        const { changedLines } = annotateDiffWithLineNumbers(change.content);

        return {
          filePath: change.filePath,
          changeType: change.changeType,
          diff: diffContent,
          truncated,
          changedLines,
          _hint: 'Use the "changedLines" array for accurate line numbers. Each entry has "line" (new-file line number) and "content". Use these line numbers in your comments.',
        };
      },
    }),

    /**
     * Fetch the FULL content of any file in the repository.
     * Use this for additional context beyond the diff — e.g. to understand
     * an imported function, a base class, or surrounding code.
     */
    get_file_content: tool({
      description:
        'Fetch the FULL content of a file from the repository (not just the diff). ' +
        'Use this when you need additional context beyond what the diff shows — for example, ' +
        'to understand a function definition, read an imported module, check a base class, ' +
        'or see surrounding code. Do NOT use this as your primary review tool; use get_file_diff instead.',
      parameters: z.object({
        filePath: z
          .string()
          .describe('Absolute path to the file in the repo, e.g. /src/utils/auth.ts'),
      }),
      execute: async ({ filePath }) => {
        ctx.logger.info(`[tool] get_file_content: ${filePath}`);
        const content = await ctx.devOps.getFileContent(
          ctx.project,
          ctx.repoId,
          filePath,
          ctx.commitId,
        );
        if (!content) {
          return { error: `File not found or empty: ${filePath}` };
        }
        const truncated = content.length > MAX_TOOL_CONTENT_CHARS;
        return {
          filePath,
          content: truncated ? content.slice(0, MAX_TOOL_CONTENT_CHARS) + '\n... (truncated)' : content,
          truncated,
          totalLength: content.length,
        };
      },
    }),

    /**
     * Read existing PR comment threads to avoid duplicating feedback
     * or to understand ongoing discussions.
     */
    get_pr_threads: tool({
      description:
        'Fetch existing comment threads on this pull request. ' +
        'Use this to check if an issue has already been discussed, ' +
        'or to understand context from prior review rounds.',
      parameters: z.object({}),
      execute: async () => {
        ctx.logger.info(`[tool] get_pr_threads: PR #${ctx.prId}`);
        const threads = await ctx.devOps.getPrThreads(ctx.project, ctx.repoId, ctx.prId);
        // Return a simplified view to save tokens
        return {
          threadCount: threads.length,
          threads: threads.slice(0, MAX_PR_THREADS_RETURNED).map((t) => ({
            id: t.id,
            status: t.status,
            firstComment: t.comments[0]?.content?.slice(0, 500) ?? '',
          })),
        };
      },
    }),

    /**
     * Get the recent commit history for a specific file —
     * useful for understanding who changed it and why.
     */
    get_file_history: tool({
      description:
        'Get recent commit history for a file. ' +
        'Use this to understand recent changes, who modified the file, and why. ' +
        'Helpful for context on patterns and conventions used in the file.',
      parameters: z.object({
        filePath: z
          .string()
          .describe('Absolute path to the file in the repo, e.g. /src/index.ts'),
        top: z
          .number()
          .describe('Number of recent commits to return (max 10)'),
      }),
      execute: async ({ filePath, top = 5 }) => {
        const limit = Math.min(top, MAX_FILE_HISTORY_COMMITS);
        ctx.logger.info(`[tool] get_file_history: ${filePath} (last ${limit})`);
        const commits = await ctx.devOps.getFileCommits(
          ctx.project,
          ctx.repoId,
          filePath,
          limit,
        );
        return {
          filePath,
          commits: commits.map((c) => ({
            commitId: c.commitId.slice(0, 8),
            message: c.comment.slice(0, 200),
            author: c.author.name,
            date: c.committer.date,
          })),
        };
      },
    }),

    /**
     * Fetch a specific line range from the new version of a file.
     * Useful for understanding context around changed lines without
     * fetching the entire file.
     */
    get_surrounding_context: tool({
      description:
        'Fetch a specific line range from the current (new) version of a file. ' +
        'Use this to understand what surrounds a changed line — e.g. the function a change is inside, ' +
        'nearby variable declarations, control flow, or error handling. ' +
        'More efficient than get_file_content when you only need a small window of context.',
      parameters: z.object({
        filePath: z
          .string()
          .describe('Absolute path to the file in the repo, e.g. /src/utils/auth.ts'),
        startLine: z
          .number()
          .describe('First line number to fetch (1-indexed)'),
        endLine: z
          .number()
          .describe('Last line number to fetch (1-indexed, max 50 lines from startLine)'),
      }),
      execute: async ({ filePath, startLine, endLine }) => {
        // Clamp the range to max 50 lines
        const clampedEnd = Math.min(endLine, startLine + MAX_CONTEXT_LINES - 1);
        ctx.logger.info(`[tool] get_surrounding_context: ${filePath}:${startLine}-${clampedEnd}`);

        const content = await ctx.devOps.getFileContent(
          ctx.project,
          ctx.repoId,
          filePath,
          ctx.commitId,
        );
        if (!content) {
          return { error: `File not found or empty: ${filePath}` };
        }

        const allLines = content.split('\n');
        const start = Math.max(1, startLine) - 1; // Convert to 0-indexed
        const end = Math.min(clampedEnd, allLines.length);

        const numberedLines = allLines
          .slice(start, end)
          .map((line, i) => `${start + i + 1}: ${line}`);

        return {
          filePath,
          startLine: start + 1,
          endLine: end,
          totalFileLines: allLines.length,
          lines: numberedLines.join('\n'),
        };
      },
    }),
  };
}
