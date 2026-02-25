import { DEFAULTS } from '../config';
import type {
  Logger,
  PrIteration,
  PrIterationChange,
  PrStatusState,
  ThreadContext,
} from '../types';

interface DevOpsListResponse<T> {
  value: T[];
  count: number;
}

export class AzureDevOpsClient {
  private readonly authHeader: string;
  private readonly apiVersion = DEFAULTS.devOpsApiVersion;

  constructor(
    private readonly org: string,
    pat: string,
    private readonly logger: Logger,
  ) {
    this.authHeader = `Basic ${btoa(`:${pat}`)}`;
  }

  async getPrIterations(
    project: string,
    repoId: string,
    prId: number,
  ): Promise<PrIteration[]> {
    const url = this.buildUrl(project, repoId, `pullrequests/${prId}/iterations`);
    const response = await this.get<DevOpsListResponse<PrIteration>>(url);
    return response.value;
  }

  async getIterationChanges(
    project: string,
    repoId: string,
    prId: number,
    iterationId: number,
  ): Promise<PrIterationChange[]> {
    const url = this.buildUrl(
      project,
      repoId,
      `pullrequests/${prId}/iterations/${iterationId}/changes`,
    );
    const response = await this.get<{ changeEntries: PrIterationChange[] }>(url);
    return response.changeEntries ?? [];
  }

  async getFileContent(
    project: string,
    repoId: string,
    path: string,
    commitId: string,
  ): Promise<string> {
    const params = new URLSearchParams({
      path,
      'versionDescriptor.version': commitId,
      'versionDescriptor.versionType': 'commit',
      'api-version': this.apiVersion,
      '$format': 'text',
    });
    const url = `${this.buildUrl(project, repoId, 'items')}?${params}`;

    try {
      const response = await fetch(url, {
        headers: { Authorization: this.authHeader },
      });
      if (!response.ok) return '';
      return await response.text();
    } catch (error) {
      this.logger.warn(`Failed to fetch file content for ${path}@${commitId}: ${error}`);
      return '';
    }
  }

  async createCommentThread(
    project: string,
    repoId: string,
    prId: number,
    content: string,
    threadContext: ThreadContext,
  ): Promise<void> {
    const url = this.buildUrl(project, repoId, `pullrequests/${prId}/threads`);
    await this.post(url, {
      comments: [{ parentCommentId: 0, content, commentType: 1 }],
      threadContext: {
        filePath: threadContext.filePath,
        rightFileStart: threadContext.rightFileStart,
        rightFileEnd: threadContext.rightFileEnd,
      },
      status: 1,
    });
  }

  async createGeneralComment(
    project: string,
    repoId: string,
    prId: number,
    content: string,
  ): Promise<void> {
    const url = this.buildUrl(project, repoId, `pullrequests/${prId}/threads`);
    await this.post(url, {
      comments: [{ parentCommentId: 0, content, commentType: 1 }],
      status: 4,
    });
  }

  async setPrStatus(
    project: string,
    repoId: string,
    prId: number,
    state: PrStatusState,
    description: string,
  ): Promise<void> {
    const url = this.buildUrl(project, repoId, `pullrequests/${prId}/statuses`);
    await this.post(url, {
      state,
      description,
      context: { name: 'ai-code-review', genre: 'pr-review' },
    });
  }

  private buildUrl(project: string, repoId: string, path: string): string {
    return `https://dev.azure.com/${this.org}/${project}/_apis/git/repositories/${repoId}/${path}`;
  }

  private async get<T>(url: string): Promise<T> {
    const separator = url.includes('?') ? '&' : '?';
    const response = await fetch(`${url}${separator}api-version=${this.apiVersion}`, {
      headers: { Authorization: this.authHeader },
    });
    if (!response.ok) {
      throw new Error(`Azure DevOps API error: ${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<T>;
  }

  private async post(url: string, body: unknown): Promise<void> {
    const separator = url.includes('?') ? '&' : '?';
    const response = await fetch(`${url}${separator}api-version=${this.apiVersion}`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Azure DevOps API error: ${response.status} ${text}`);
    }
  }
}
