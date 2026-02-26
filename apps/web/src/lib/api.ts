// Use NEXT_PUBLIC_API_URL if set (even empty string means relative URLs)
// Default to relative URLs when not set (uses current host)
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

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

export interface JobRun {
  startTime: string;
  endTime?: string;
  status: "pending" | "running" | "completed" | "success" | "failed";
  message?: string;
  snapshotId?: string;
}

export interface Job {
  name: string;
  type: "volume" | "folder" | "postgres" | "mariadb" | "redis";
  storage: string;
  repo: string;
  schedule: string | null;
  isRunning: boolean;
  lastRun: JobRun | null;
  source?: string;
  database?: string;
  host?: string;
}

export interface Snapshot {
  id: string;
  short_id: string;
  time: string;
  hostname: string;
  paths: string[];
  tags: string[] | null;
}

export interface FileEntry {
  name: string;
  type: "file" | "dir" | "symlink";
  path: string;
  size: number;
  mtime: string;
}

export interface RepoStats {
  total_size: number;
  total_file_count: number;
  snapshots_count?: number;
}

export interface ScheduledJob {
  name: string;
  schedule: string;
  nextRun?: string;
}

export interface PaginationInfo {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PaginatedJobsResponse {
  jobs: Job[];
  pagination: PaginationInfo;
}

export interface JobsQueryParams {
  page?: number;
  pageSize?: number;
  sortBy?: "name" | "type" | "storage" | "lastRun" | "status";
  sortOrder?: "asc" | "desc";
}

export interface RestoreOperation {
  id: string;
  storage: string;
  repo: string;
  snapshotId: string;
  paths: string[];
  method: "download" | "path";
  target?: string;
  status: "pending" | "running" | "completed" | "failed";
  startTime: string;
  endTime?: string;
  message?: string;
  downloadReady?: boolean;
}

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || "Request failed");
  }

  return response.json();
}

export async function getStorage(): Promise<{ storage: Storage[] }> {
  return fetchApi("/api/storage");
}

export async function getStorageStatus(name: string): Promise<{ name: string; status: string; connected: boolean; message?: string }> {
  return fetchApi(`/api/storage/${name}/status`);
}

export async function getStorageRepos(name: string): Promise<{ storage: string; repos: string[] }> {
  return fetchApi(`/api/storage/${name}/repos`);
}

export interface StorageRepoStats {
  repo: string;
  totalSize: number;
  totalFileCount: number;
  snapshotsCount: number;
  error?: string;
}

export interface StorageStats {
  storage: string;
  totalSize: number;
  totalFileCount: number;
  totalSnapshots: number;
  repoCount: number;
  repos: StorageRepoStats[];
}

export async function getStorageStats(name: string): Promise<StorageStats> {
  return fetchApi(`/api/storage/${name}/stats`);
}

export async function getJobs(params?: JobsQueryParams): Promise<PaginatedJobsResponse> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set("page", params.page.toString());
  if (params?.pageSize) searchParams.set("pageSize", params.pageSize.toString());
  if (params?.sortBy) searchParams.set("sortBy", params.sortBy);
  if (params?.sortOrder) searchParams.set("sortOrder", params.sortOrder);
  const query = searchParams.toString() ? `?${searchParams}` : "";
  return fetchApi(`/api/jobs${query}`);
}

export async function getJob(name: string): Promise<{
  name: string;
  config: Job;
  isRunning: boolean;
  recentRuns: JobRun[];
}> {
  return fetchApi(`/api/jobs/${name}`);
}

export async function runJob(name: string): Promise<{ name: string; status: string; message: string }> {
  const response = await fetch(`${API_URL}/api/jobs/${name}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  if (response.status === 409) {
    // Job is already running — treat as queued success so callers can show confirmation
    return { name, status: "queued", message: "Job is already running" };
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || "Request failed");
  }

  return response.json();
}

export async function createJob(name: string, config: Record<string, unknown>): Promise<{ name: string; status: string; message: string }> {
  return fetchApi("/api/jobs", { method: "POST", body: JSON.stringify({ name, ...config }) });
}

export async function updateJobConfig(name: string, config: Record<string, unknown>): Promise<{ name: string; status: string; message: string }> {
  return fetchApi(`/api/jobs/${name}`, { method: "PUT", body: JSON.stringify(config) });
}

export async function deleteJob(name: string): Promise<{ name: string; status: string; message: string }> {
  return fetchApi(`/api/jobs/${name}`, { method: "DELETE" });
}

export async function getJobHistory(name: string): Promise<{
  name: string;
  repo: string;
  storage: string;
  snapshots: Snapshot[];
}> {
  return fetchApi(`/api/jobs/${name}/history`);
}

export async function getSnapshots(
  storage: string,
  repo: string,
  options?: { tag?: string; latest?: number }
): Promise<{ storage: string; repo: string; snapshots: Snapshot[] }> {
  const params = new URLSearchParams();
  if (options?.tag) params.set("tag", options.tag);
  if (options?.latest) params.set("latest", options.latest.toString());
  const query = params.toString() ? `?${params}` : "";
  return fetchApi(`/api/repos/${storage}/${repo}/snapshots${query}`);
}

export async function getSnapshot(
  storage: string,
  repo: string,
  id: string
): Promise<{ storage: string; repo: string; snapshot: Snapshot & { username: string; program_version: string } }> {
  return fetchApi(`/api/repos/${storage}/${repo}/snapshots/${id}`);
}

export async function listSnapshotFiles(
  storage: string,
  repo: string,
  snapshotId: string,
  path?: string
): Promise<{ storage: string; repo: string; snapshotId: string; path: string; entries: FileEntry[] }> {
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  return fetchApi(`/api/repos/${storage}/${repo}/snapshots/${snapshotId}/ls${query}`);
}

export async function getRepoStats(
  storage: string,
  repo: string
): Promise<{ storage: string; repo: string; stats: RepoStats }> {
  return fetchApi(`/api/repos/${storage}/${repo}/stats`);
}

export async function checkRepo(
  storage: string,
  repo: string,
  readData?: boolean
): Promise<{ storage: string; repo: string; success: boolean; message: string }> {
  const query = readData ? "?readData=true" : "";
  return fetchApi(`/api/repos/${storage}/${repo}/check${query}`, { method: "POST" });
}

export async function unlockRepo(
  storage: string,
  repo: string
): Promise<{ storage: string; repo: string; success: boolean; message: string }> {
  return fetchApi(`/api/repos/${storage}/${repo}/unlock`, { method: "POST" });
}

export async function initiateRestore(params: {
  storage: string;
  repo: string;
  snapshotId: string;
  paths?: string[];
  method: "download" | "path";
  target?: string;
}): Promise<{ id: string; status: string; message: string }> {
  return fetchApi("/api/restore", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function getRestoreStatus(id: string): Promise<RestoreOperation> {
  return fetchApi(`/api/restore/${id}`);
}

export function getRestoreDownloadUrl(id: string): string {
  return `${API_URL}/api/restore/${id}/download`;
}

export async function getRestoreOperations(): Promise<{ operations: RestoreOperation[] }> {
  return fetchApi("/api/restore");
}

export async function getSchedule(): Promise<{
  scheduled: ScheduledJob[];
  running: { name: string; startTime: string }[];
  recent: (JobRun & { jobName: string })[];
}> {
  return fetchApi("/api/schedule");
}

export async function getRunningJobs(): Promise<{ running: { name: string; startTime: string }[] }> {
  return fetchApi("/api/schedule/running");
}

export async function getScheduleHistory(options?: {
  job?: string;
  limit?: number;
}): Promise<{ history: (JobRun & { jobName: string })[] }> {
  const params = new URLSearchParams();
  if (options?.job) params.set("job", options.job);
  if (options?.limit) params.set("limit", options.limit.toString());
  const query = params.toString() ? `?${params}` : "";
  return fetchApi(`/api/schedule/history${query}`);
}

export async function getHealth(): Promise<{ status: string; timestamp: string }> {
  return fetchApi("/health");
}

export interface BackupStats {
  successRate7d: number;
  successRate30d: number;
  totalBackups7d: number;
  totalBackups30d: number;
  failedBackups7d: number;
  failedBackups30d: number;
  averageDuration7d: number;
  averageDuration30d: number;
}

export async function getBackupStats(): Promise<BackupStats> {
  return fetchApi("/api/schedule/stats");
}
