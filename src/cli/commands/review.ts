import { loadEnvConfig } from '../env';
import { PrReviewer } from '../../reviewer';
import type { Logger } from '../../types';

const PR_URL_REGEX =
  /https:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)/;

export async function reviewCommand(url: string): Promise<void> {
  const match = url.match(PR_URL_REGEX);
  if (!match) {
    console.error(
      'Invalid Azure DevOps PR URL. Expected format: https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{id}',
    );
    process.exit(1);
  }

  const [, , project, repoSlug, prIdStr] = match;
  const prId = parseInt(prIdStr, 10);

  let config;
  try {
    config = loadEnvConfig({});
  } catch (error) {
    console.error(`Configuration error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  const logger: Logger = {
    info: (msg) => console.log(`[INFO] ${msg}`),
    warn: (msg) => console.warn(`[WARN] ${msg}`),
    error: (msg) => console.error(`[ERROR] ${msg}`),
  };

  const reviewer = new PrReviewer({
    azureDevOps: config.azureDevOps,
    webhookSecret: '',
    ai: config.ai,
    logger,
  });

  try {
    console.log(`Reviewing PR #${prId} in ${project}/${repoSlug}...`);
    const result = await reviewer.reviewPullRequest(project, repoSlug, prId);
    console.log('\n--- Review Summary ---');
    console.log(result.summary);
    console.log(`\nComments posted: ${result.comments.length}`);
    for (const comment of result.comments) {
      const severity = comment.severity.toUpperCase().padEnd(10);
      console.log(`  [${severity}] ${comment.filePath}:${comment.lineNumber} - ${comment.message}`);
    }
  } catch (error) {
    console.error(`Review failed: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
