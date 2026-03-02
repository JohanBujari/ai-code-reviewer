import { DEFAULTS } from "../config";
import type {
  Logger,
  PrIteration,
  PrIterationChange,
  PrStatusState,
  PullRequestSummary,
  ThreadContext,
} from "../types";

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

  async listActivePullRequests(
    project: string,
    repoId: string,
    top = 20,
  ): Promise<PullRequestSummary[]> {
    const params = new URLSearchParams({
      "searchCriteria.status": "active",
      $top: String(top),
      "api-version": this.apiVersion,
    });
    const baseUrl = this.buildUrl(project, repoId, "pullrequests");
    const response = await fetch(`${baseUrl}?${params}`, {
      headers: { Authorization: this.authHeader },
    });
    this.ensureJsonResponse(response);
    const data =
      (await response.json()) as DevOpsListResponse<PullRequestSummary>;
    return data.value;
  }

  async getPrIterations(
    project: string,
    repoId: string,
    prId: number,
  ): Promise<PrIteration[]> {
    const url = this.buildUrl(
      project,
      repoId,
      `pullrequests/${prId}/iterations`,
    );
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
    const response = await this.get<{ changeEntries: PrIterationChange[] }>(
      url,
    );
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
      "versionDescriptor.version": commitId,
      "versionDescriptor.versionType": "commit",
      "api-version": this.apiVersion,
      $format: "text",
    });
    const url = `${this.buildUrl(project, repoId, "items")}?${params}`;

    try {
      const response = await fetch(url, {
        headers: { Authorization: this.authHeader },
      });
      if (!response.ok) return "";
      return await response.text();
    } catch (error) {
      this.logger.warn(
        `Failed to fetch file content for ${path}@${commitId}: ${error}`,
      );
      return "";
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

  async getPrThreads(
    project: string,
    repoId: string,
    prId: number,
  ): Promise<
    Array<{ id: number; status: string; comments: Array<{ content: string }> }>
  > {
    const url = this.buildUrl(project, repoId, `pullrequests/${prId}/threads`);
    const response =
      await this.get<
        DevOpsListResponse<{
          id: number;
          status: string;
          comments: Array<{ content: string }>;
        }>
      >(url);
    return response.value;
  }

  async getFileCommits(
    project: string,
    repoId: string,
    filePath: string,
    top = 5,
  ): Promise<
    Array<{
      commitId: string;
      comment: string;
      author: { name: string };
      committer: { date: string };
    }>
  > {
    const params = new URLSearchParams({
      "searchCriteria.itemPath": filePath,
      $top: String(top),
      "api-version": this.apiVersion,
    });
    const baseUrl = this.buildUrl(project, repoId, "commits");
    const response = await fetch(`${baseUrl}?${params}`, {
      headers: { Authorization: this.authHeader },
    });
    if (!response.ok) return [];
    const data = (await response.json()) as DevOpsListResponse<{
      commitId: string;
      comment: string;
      author: { name: string };
      committer: { date: string };
    }>;
    return data.value;
  }

  async getRepoTree(
    project: string,
    repoId: string,
    commitId: string,
    scopePath = "/",
  ): Promise<Array<{ path: string; isFolder: boolean }>> {
    const params = new URLSearchParams({
      scopePath,
      recursionLevel: "Full",
      "versionDescriptor.version": commitId,
      "versionDescriptor.versionType": "commit",
      "api-version": this.apiVersion,
    });
    const url = `${this.buildUrl(project, repoId, "items")}?${params}`;
    try {
      const response = await fetch(url, {
        headers: { Authorization: this.authHeader },
      });
      if (!response.ok) return [];
      const data = (await response.json()) as DevOpsListResponse<{
        path: string;
        isFolder: boolean;
      }>;
      return data.value;
    } catch {
      return [];
    }
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
      context: { name: "ai-code-review", genre: "pr-review" },
    });
  }

  private buildUrl(project: string, repoId: string, path: string): string {
    return `https://dev.azure.com/${this.org}/${project}/_apis/git/repositories/${repoId}/${path}`;
  }

  private ensureJsonResponse(response: Response): void {
    if (!response.ok) {
      throw new Error(
        `Azure DevOps API error: ${response.status} ${response.statusText}`,
      );
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      throw new Error(
        `Azure DevOps returned non-JSON response (content-type: ${contentType}). ` +
          `This usually means the PAT is expired or invalid. ` +
          `Please update your Personal Access Token.`,
      );
    }
  }

  private async get<T>(url: string): Promise<T> {
    const separator = url.includes("?") ? "&" : "?";
    const response = await fetch(
      `${url}${separator}api-version=${this.apiVersion}`,
      {
        headers: { Authorization: this.authHeader },
      },
    );
    this.ensureJsonResponse(response);
    return response.json() as Promise<T>;
  }

  private async post(url: string, body: unknown): Promise<void> {
    const separator = url.includes("?") ? "&" : "?";
    const response = await fetch(
      `${url}${separator}api-version=${this.apiVersion}`,
      {
        method: "POST",
        headers: {
          Authorization: this.authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Azure DevOps API error: ${response.status} ${text}`);
    }
  }
}
