/**
 * Typed API client for tests
 */

export interface ApiClientOptions {
  baseUrl: string;
  timeout?: number;
}

export interface Storage {
  name: string;
  type: "sftp" | "s3" | "rest" | "local";
  host?: string;
  port?: number;
  path?: string;
  endpoint?: string;
  bucket?: string;
  region?: string;
  url?: string;
}

export interface Job {
  name: string;
  type: "folder" | "volume" | "postgres" | "mariadb" | "redis";
  storage: string;
  repo: string;
  source?: string;
  database?: string;
  host?: string;
  port?: number;
  tags?: string[];
  isRunning?: boolean;
  recentRuns?: JobRun[];
}

export interface JobRun {
  id: string;
  status: "success" | "failed" | "running";
  snapshotId?: string;
  startTime: string;
  endTime?: string;
  message?: string;
}

export interface RestoreOperation {
  id: string;
  storage: string;
  repo: string;
  snapshotId: string;
  method: "download" | "path";
  target?: string;
  status: "pending" | "running" | "completed" | "failed";
  startTime: string;
  endTime?: string;
  message?: string;
  downloadReady?: boolean;
}

export interface Snapshot {
  id: string;
  short_id: string;
  time: string;
  hostname: string;
  paths: string[];
  tags: string[] | null;
}

export class ApiClient {
  private baseUrl: string;
  private timeout: number;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.timeout = options.timeout ?? 30000;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API error ${response.status}: ${error}`);
      }

      return response.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async health(): Promise<{ status: string }> {
    return this.request("GET", "/health");
  }

  async getStorage(): Promise<{ storage: Storage[] }> {
    return this.request("GET", "/api/storage");
  }

  async getStorageStatus(
    name: string
  ): Promise<{ connected: boolean; error?: string }> {
    return this.request("GET", `/api/storage/${name}/status`);
  }

  async getJobs(): Promise<{ jobs: Job[] }> {
    return this.request("GET", "/api/jobs");
  }

  async getJob(name: string): Promise<Job> {
    return this.request("GET", `/api/jobs/${name}`);
  }

  async runJob(name: string): Promise<{ status: string; message?: string }> {
    return this.request("POST", `/api/jobs/${name}/run`, {});
  }

  async getJobHistory(
    name: string
  ): Promise<{ snapshots: Snapshot[] }> {
    return this.request("GET", `/api/jobs/${name}/history`);
  }

  async initiateRestore(options: {
    storage: string;
    repo: string;
    snapshotId: string;
    method: "download" | "path";
    target?: string;
    paths?: string[];
  }): Promise<{ id: string; status: string; message: string }> {
    return this.request("POST", "/api/restore", options);
  }

  async getRestoreStatus(id: string): Promise<RestoreOperation> {
    return this.request("GET", `/api/restore/${id}`);
  }

  async listRestores(): Promise<{ operations: RestoreOperation[] }> {
    return this.request("GET", "/api/restore");
  }

  async waitForJobCompletion(
    jobName: string,
    timeoutMs = 300000,
    pollIntervalMs = 5000
  ): Promise<JobRun> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const job = await this.getJob(jobName);

      if (!job.isRunning && job.recentRuns && job.recentRuns.length > 0) {
        return job.recentRuns[0];
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`Job ${jobName} did not complete within ${timeoutMs}ms`);
  }

  async waitForRestoreCompletion(
    restoreId: string,
    timeoutMs = 120000,
    pollIntervalMs = 2000
  ): Promise<RestoreOperation> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const restore = await this.getRestoreStatus(restoreId);

      if (restore.status === "completed" || restore.status === "failed") {
        return restore;
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(
      `Restore ${restoreId} did not complete within ${timeoutMs}ms`
    );
  }

  async waitForHealth(timeoutMs = 60000, pollIntervalMs = 2000): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      try {
        const health = await this.health();
        if (health.status === "ok") {
          return;
        }
      } catch {
        // Continue polling
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`API did not become healthy within ${timeoutMs}ms`);
  }
}

export function createApiClient(baseUrl = "http://localhost:3001"): ApiClient {
  return new ApiClient({ baseUrl });
}
