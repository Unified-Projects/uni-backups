import { spawn } from "child_process";
import { mkdirSync, existsSync } from "fs";
import type { StorageConfig, Retention } from "@uni-backups/shared/config";
import { getResticCacheDir, getTempDir } from "@uni-backups/shared/config";

export interface ResticSnapshot {
  id: string;
  short_id: string;
  time: string;
  hostname: string;
  username: string;
  paths: string[];
  tags: string[] | null;
  program_version: string;
}

export interface ResticLsEntry {
  name: string;
  type: "file" | "dir" | "symlink";
  path: string;
  uid: number;
  gid: number;
  size: number;
  mode: number;
  mtime: string;
  atime: string;
  ctime: string;
}

export interface ResticStats {
  total_size: number;
  total_file_count: number;
  snapshots_count?: number;
}

interface ResticResult {
  success: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

export function buildRepoUrl(storage: StorageConfig, repoName: string): string {
  switch (storage.type) {
    case "sftp":
      // SFTP URL format: sftp:user@host:path (port handled via ssh options)
      const sftpPath = storage.path.replace(/\/$/, "");
      return `sftp:${storage.user}@${storage.host}:${sftpPath}/${repoName}`;

    case "s3":
      // For S3-compatible endpoints, preserve the protocol (http/https)
      // Restic defaults to HTTPS, so we must include http:// for HTTP endpoints
      let s3Endpoint: string;
      if (storage.endpoint) {
        s3Endpoint = storage.endpoint.replace(/\/$/, "");
      } else {
        s3Endpoint = "s3.amazonaws.com";
      }
      const s3Path = storage.path ? `/${storage.path.replace(/^\//, "")}` : "";
      return `s3:${s3Endpoint}/${storage.bucket}${s3Path}/${repoName}`;

    case "rest":
      const restUrl = storage.url.replace(/\/$/, "");
      return `rest:${restUrl}/${repoName}`;

    case "local":
      return `${storage.path}/${repoName}`;
  }
}

export function buildResticEnv(
  storage: StorageConfig,
  resticPassword: string
): Record<string, string> {
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    RESTIC_PASSWORD: resticPassword,
    RESTIC_CACHE_DIR: getResticCacheDir(),
  };

  switch (storage.type) {
    case "sftp":
      const sshPort = storage.port || 22;
      let sshCmd = `ssh -p ${sshPort} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`;

      if (storage.key_file) {
        sshCmd += ` -i '${storage.key_file}'`;
      }

      sshCmd += ` ${storage.user}@${storage.host} -s sftp`;
      env.__SFTP_COMMAND = sshCmd;

      // If password authentication, we need to use sshpass
      if (storage.password && !storage.key_file) {
        env.__SFTP_PASSWORD = storage.password;
      }
      break;

    case "s3":
      if (storage.access_key) {
        env.AWS_ACCESS_KEY_ID = storage.access_key;
      }
      if (storage.secret_key) {
        env.AWS_SECRET_ACCESS_KEY = storage.secret_key;
      }
      if (storage.endpoint) {
        env.AWS_S3_ENDPOINT = storage.endpoint;
      }
      break;

    case "rest":
      if (storage.user && storage.password) {
        env.RESTIC_REST_USERNAME = storage.user;
        env.RESTIC_REST_PASSWORD = storage.password;
      }
      break;
  }

  return env;
}

async function runRestic(
  args: string[],
  env: Record<string, string>,
  timeout = 300000 // 5 minutes default
): Promise<ResticResult> {
  return new Promise((resolve) => {
    const sftpCommand = env.__SFTP_COMMAND;
    const sftpPassword = env.__SFTP_PASSWORD;

    let command = "restic";
    let finalArgs = [...args];

    if (sftpCommand) {
      finalArgs = ["-o", `sftp.command=${sftpCommand}`, ...args];

      if (sftpPassword) {
        command = "sshpass";
        finalArgs = ["-p", sftpPassword, "restic", ...finalArgs];
      }
    }

    const spawnEnv = { ...env };
    delete spawnEnv.__SFTP_COMMAND;
    delete spawnEnv.__SFTP_PASSWORD;

    const proc = spawn(command, finalArgs, {
      env: spawnEnv,
      timeout,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      resolve({
        success: code === 0,
        stdout,
        stderr,
        code: code ?? 1,
      });
    });

    proc.on("error", (err) => {
      resolve({
        success: false,
        stdout,
        stderr: err.message,
        code: 1,
      });
    });
  });
}

export async function initRepo(
  storage: StorageConfig,
  repoName: string,
  resticPassword: string
): Promise<{ success: boolean; message: string; alreadyExists?: boolean }> {
  const repoUrl = buildRepoUrl(storage, repoName);
  const env = buildResticEnv(storage, resticPassword);

  const checkResult = await runRestic(
    ["--repo", repoUrl, "snapshots", "--json"],
    env,
    30000
  );

  if (checkResult.success) {
    return { success: true, message: "Repository already exists", alreadyExists: true };
  }

  const result = await runRestic(["--repo", repoUrl, "init"], env, 60000);

  if (result.success) {
    return { success: true, message: "Repository initialized" };
  }

  // newer restic says "config file already exists" instead of "already initialized"
  if (result.stderr.includes("already initialized") || result.stderr.includes("config file already exists")) {
    return { success: true, message: "Repository already exists", alreadyExists: true };
  }

  return { success: false, message: result.stderr };
}

export async function backup(
  storage: StorageConfig,
  repoName: string,
  resticPassword: string,
  sourcePath: string,
  options?: {
    tags?: string[];
    exclude?: string[];
    hostname?: string;
  }
): Promise<{ success: boolean; message: string; snapshotId?: string }> {
  const repoUrl = buildRepoUrl(storage, repoName);
  const env = buildResticEnv(storage, resticPassword);

  const args = ["--repo", repoUrl, "backup", sourcePath, "--json"];

  if (options?.tags) {
    for (const tag of options.tags) {
      args.push("--tag", tag);
    }
  }

  if (options?.exclude) {
    for (const pattern of options.exclude) {
      args.push("--exclude", pattern);
    }
  }

  if (options?.hostname) {
    args.push("--host", options.hostname);
  }

  const result = await runRestic(args, env, 3600000); // 1 hour timeout for backups

  if (result.success) {
    try {
      const lines = result.stdout.trim().split("\n");
      const lastLine = lines[lines.length - 1];
      const summary = JSON.parse(lastLine);
      return {
        success: true,
        message: "Backup completed",
        snapshotId: summary.snapshot_id,
      };
    } catch {
      return { success: true, message: "Backup completed" };
    }
  }

  return { success: false, message: result.stderr };
}

export async function listSnapshots(
  storage: StorageConfig,
  repoName: string,
  resticPassword: string,
  options?: {
    tags?: string[];
    host?: string;
    path?: string;
    latest?: number;
  }
): Promise<{ success: boolean; snapshots?: ResticSnapshot[]; message?: string }> {
  const repoUrl = buildRepoUrl(storage, repoName);
  const env = buildResticEnv(storage, resticPassword);

  // --no-lock is safe for read-only snapshot listing; avoids failures from concurrent backup locks.
  const args = ["--repo", repoUrl, "--no-lock", "snapshots", "--json"];

  if (options?.tags) {
    for (const tag of options.tags) {
      args.push("--tag", tag);
    }
  }

  if (options?.host) {
    args.push("--host", options.host);
  }

  if (options?.path) {
    args.push("--path", options.path);
  }

  if (options?.latest) {
    args.push("--latest", options.latest.toString());
  }

  const result = await runRestic(args, env);

  if (result.success) {
    try {
      const snapshots = JSON.parse(result.stdout) as ResticSnapshot[];
      return { success: true, snapshots };
    } catch {
      return { success: true, snapshots: [] };
    }
  }

  return { success: false, message: result.stderr };
}

export async function listFiles(
  storage: StorageConfig,
  repoName: string,
  resticPassword: string,
  snapshotId: string,
  path?: string
): Promise<{ success: boolean; entries?: ResticLsEntry[]; message?: string }> {
  const repoUrl = buildRepoUrl(storage, repoName);
  const env = buildResticEnv(storage, resticPassword);

  // --no-lock skips acquiring/checking repo locks, safe for read-only ls operations.
  // This prevents failures when a backup is concurrently holding an exclusive lock.
  const args = ["--repo", repoUrl, "--no-lock", "ls", "--json", snapshotId];
  if (path) {
    args.push(path);
  }

  const result = await runRestic(args, env);

  if (result.success) {
    try {
      const entries: ResticLsEntry[] = [];
      for (const line of result.stdout.trim().split("\n")) {
        if (line) {
          entries.push(JSON.parse(line));
        }
      }
      return { success: true, entries };
    } catch {
      return { success: true, entries: [] };
    }
  }

  return { success: false, message: result.stderr };
}

export async function restore(
  storage: StorageConfig,
  repoName: string,
  resticPassword: string,
  snapshotId: string,
  targetPath: string,
  options?: {
    include?: string[];
    exclude?: string[];
  }
): Promise<{ success: boolean; message: string }> {
  const repoUrl = buildRepoUrl(storage, repoName);
  const env = buildResticEnv(storage, resticPassword);

  if (!existsSync(targetPath)) {
    mkdirSync(targetPath, { recursive: true });
  }

  const args = ["--repo", repoUrl, "restore", snapshotId, "--target", targetPath];

  if (options?.include) {
    for (const pattern of options.include) {
      args.push("--include", pattern);
    }
  }

  if (options?.exclude) {
    for (const pattern of options.exclude) {
      args.push("--exclude", pattern);
    }
  }

  const result = await runRestic(args, env, 3600000); // 1 hour timeout

  if (result.success) {
    return { success: true, message: "Restore completed" };
  }

  return { success: false, message: result.stderr };
}

export async function prune(
  storage: StorageConfig,
  repoName: string,
  resticPassword: string,
  retention: Retention,
  options?: {
    tags?: string[];
    host?: string;
    dryRun?: boolean;
  }
): Promise<{ success: boolean; message: string }> {
  const repoUrl = buildRepoUrl(storage, repoName);
  const env = buildResticEnv(storage, resticPassword);

  const args = ["--repo", repoUrl, "forget", "--prune"];

  // Group by tags so retention policies apply per job/tag, not per unique path
  args.push("--group-by", "tags");

  if (retention.last) args.push("--keep-last", retention.last.toString());
  if (retention.hourly) args.push("--keep-hourly", retention.hourly.toString());
  if (retention.daily) args.push("--keep-daily", retention.daily.toString());
  if (retention.weekly) args.push("--keep-weekly", retention.weekly.toString());
  if (retention.monthly) args.push("--keep-monthly", retention.monthly.toString());
  if (retention.yearly) args.push("--keep-yearly", retention.yearly.toString());

  if (options?.tags) {
    for (const tag of options.tags) {
      args.push("--tag", tag);
    }
  }

  if (options?.host) {
    args.push("--host", options.host);
  }

  if (options?.dryRun) {
    args.push("--dry-run");
  }

  const result = await runRestic(args, env, 3600000);

  if (result.success) {
    return { success: true, message: options?.dryRun ? result.stdout : "Prune completed" };
  }

  return { success: false, message: result.stderr };
}

export async function check(
  storage: StorageConfig,
  repoName: string,
  resticPassword: string,
  options?: {
    readData?: boolean;
  }
): Promise<{ success: boolean; message: string }> {
  const repoUrl = buildRepoUrl(storage, repoName);
  const env = buildResticEnv(storage, resticPassword);

  const args = ["--repo", repoUrl, "--no-lock", "check"];

  if (options?.readData) {
    args.push("--read-data");
  }

  const result = await runRestic(args, env, 3600000);

  if (result.success) {
    return { success: true, message: "Repository check passed" };
  }

  // Exit code 3 means warnings only (e.g. orphaned pack files from interrupted backups).
  // The repository is still usable; treat this as a passing check.
  if (result.code === 3) {
    return { success: true, message: "Repository check passed with warnings" };
  }

  return { success: false, message: result.stderr };
}

export async function stats(
  storage: StorageConfig,
  repoName: string,
  resticPassword: string
): Promise<{ success: boolean; stats?: ResticStats; message?: string }> {
  const repoUrl = buildRepoUrl(storage, repoName);
  const env = buildResticEnv(storage, resticPassword);

  const args = ["--repo", repoUrl, "stats", "--json"];

  const result = await runRestic(args, env);

  if (result.success) {
    try {
      const stats = JSON.parse(result.stdout) as ResticStats;

      const snapshotsResult = await listSnapshots(storage, repoName, resticPassword);
      if (snapshotsResult.success && snapshotsResult.snapshots) {
        stats.snapshots_count = snapshotsResult.snapshots.length;
      }

      return { success: true, stats };
    } catch {
      return { success: false, message: "Failed to parse stats" };
    }
  }

  return { success: false, message: result.stderr };
}

export async function unlock(
  storage: StorageConfig,
  repoName: string,
  resticPassword: string
): Promise<{ success: boolean; message: string }> {
  const repoUrl = buildRepoUrl(storage, repoName);
  const env = buildResticEnv(storage, resticPassword);

  const result = await runRestic(["--repo", repoUrl, "unlock"], env);

  if (result.success) {
    return { success: true, message: "Repository unlocked" };
  }

  return { success: false, message: result.stderr };
}

export function ensureTempDir(): string {
  const tempDir = getTempDir();
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }
  return tempDir;
}
