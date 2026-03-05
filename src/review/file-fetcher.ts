import { createPatch } from "diff";
import type { AzureDevOpsClient } from "../azure-devops/client";
import { DEFAULTS } from "../config";
import {
  PROJECT_CONTEXT_FILES,
  SKIP_DIRS,
  MAX_TREE_VIEW_ITEMS,
  MAX_CONFIG_FILE_CHARS,
} from "../shared/constants";
import type { Logger, PrFileChange, PrIterationChange } from "../types";

/** Filter out deleted files and files matching skip patterns */
export function filterReviewableChanges(
  changes: PrIterationChange[],
  skipPatterns: RegExp[],
): PrIterationChange[] {
  return changes.filter((change) => {
    if (change.changeType === "delete") return false;
    const path = change.item.path;
    return !skipPatterns.some((pattern) => pattern.test(path));
  });
}

/** Fetch diffs for changed files in batches */
export async function fetchFileDiffs(
  devOps: AzureDevOpsClient,
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

        const [baseContent, headContent] = await Promise.all([
          isAdd
            ? Promise.resolve("")
            : devOps.getFileContent(project, repoId, filePath, baseCommitId),
          devOps.getFileContent(project, repoId, filePath, headCommitId),
        ]);

        if (!headContent) return null;

        const patch = createPatch(
          filePath,
          baseContent,
          headContent,
          "base",
          "PR head",
          { context: 3 },
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

/**
 * Pre-fetch the repository tree and key config files to build a project
 * context string that gives the AI immediate awareness of the tech stack.
 */
export async function fetchProjectContext(
  devOps: AzureDevOpsClient,
  project: string,
  repoId: string,
  commitId: string,
  logger: Logger,
): Promise<string | undefined> {
  try {
    const tree = await devOps.getRepoTree(project, repoId, commitId, "/");
    if (tree.length === 0) return undefined;

    const filtered = tree.filter(
      (item) =>
        !SKIP_DIRS.some(
          (skip) =>
            item.path.startsWith(skip) || item.path.includes(`${skip}/`),
        ),
    );

    const treeView = filtered
      .slice(0, MAX_TREE_VIEW_ITEMS)
      .map((item) => (item.isFolder ? `${item.path}/` : item.path))
      .join("\n");

    const existingPaths = new Set(tree.map((item) => item.path));
    const configSections: string[] = [];

    for (const filePath of PROJECT_CONTEXT_FILES) {
      if (existingPaths.has(filePath)) {
        const content = await devOps.getFileContent(
          project,
          repoId,
          filePath,
          commitId,
        );
        if (content) {
          const truncated =
            content.length > MAX_CONFIG_FILE_CHARS
              ? content.slice(0, MAX_CONFIG_FILE_CHARS) + "\n... (truncated)"
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
    logger.warn(`Failed to fetch project context: ${error}`);
    return undefined;
  }
}
