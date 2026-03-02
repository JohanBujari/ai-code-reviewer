import { tool } from 'ai';
import { z } from 'zod';
import type { ReviewContext } from './provider';

/** Key files that reveal project conventions and tech stack */
const PROJECT_CONTEXT_FILES = [
  '/README.md',
  '/package.json',
  '/tsconfig.json',
  '/pyproject.toml',
  '/requirements.txt',
  '/.eslintrc.json',
  '/.eslintrc.js',
  '/biome.json',
  '/Cargo.toml',
  '/go.mod',
  '/pom.xml',
  '/build.gradle',
  '/Makefile',
  '/Dockerfile',
  '/docker-compose.yml',
];

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
          .default('/')
          .describe('Root path to scan from (default "/")'),
      }),
      execute: async ({ scopePath }) => {
        ctx.logger.info(`[tool] get_project_structure: scanning ${scopePath}`);

        // 1. Get the directory tree
        const tree = await ctx.devOps.getRepoTree(ctx.project, ctx.repoId, ctx.commitId, scopePath);

        // Build a compact tree view (skip noisy directories)
        const skipDirs = ['/node_modules', '/dist', '/.git', '/vendor', '/__pycache__', '/build', '/.next'];
        const filteredTree = tree.filter(
          (item) => !skipDirs.some((skip) => item.path.startsWith(skip) || item.path.includes(`${skip}/`)),
        );

        // Limit to avoid huge outputs
        const treeView = filteredTree
          .slice(0, 200)
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
              contextFiles[filePath] = content.length > 5_000
                ? content.slice(0, 5_000) + '\n... (truncated)'
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
     * Fetch the full content of any file in the repository.
     * Use this when you see a function call, import, or reference
     * and need to understand what it does.
     */
    get_file_content: tool({
      description:
        'Fetch the full content of a file from the repository at the PR commit. ' +
        'Use this to read function definitions, imported modules, config files, ' +
        'or any code referenced in the changed files that you need to understand.',
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
        // Truncate very large files to avoid blowing up the context
        const maxChars = 30_000;
        const truncated = content.length > maxChars;
        return {
          filePath,
          content: truncated ? content.slice(0, maxChars) + '\n... (truncated)' : content,
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
          threads: threads.slice(0, 20).map((t) => ({
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
          .default(5)
          .describe('Number of recent commits to return (default 5, max 10)'),
      }),
      execute: async ({ filePath, top }) => {
        const limit = Math.min(top ?? 5, 10);
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
  };
}
