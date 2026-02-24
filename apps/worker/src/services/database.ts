import { spawn } from "child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import type { PostgresJob, MariadbJob, RedisJob, StorageConfig } from "@uni-backups/shared/config";
import { ensureTempDir } from "./restic";
import * as restic from "./restic";

interface DumpResult {
  success: boolean;
  dumpPath?: string;
  message: string;
}

async function runCommand(
  command: string,
  args: string[],
  env?: Record<string, string>,
  timeout = 300000
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      env: { ...process.env, ...env },
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
      });
    });

    proc.on("error", (err) => {
      resolve({
        success: false,
        stdout,
        stderr: err.message,
      });
    });
  });
}

export async function dumpPostgres(job: PostgresJob): Promise<DumpResult> {
  const tempDir = ensureTempDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dumpPath = join(tempDir, `postgres-${job.database}-${timestamp}.sql`);

  const env: Record<string, string> = {};
  if (job.password) {
    env.PGPASSWORD = job.password;
  }

  const args: string[] = [
    "-h", job.host,
    "-p", job.port.toString(),
    "-U", job.user,
  ];

  if (job.all_databases) {
    args.push("-f", dumpPath);
    const result = await runCommand("pg_dumpall", args, env, 3600000);
    if (!result.success) {
      return { success: false, message: result.stderr };
    }
  } else {
    args.push("-d", job.database, "-f", dumpPath);
    const result = await runCommand("pg_dump", args, env, 3600000);
    if (!result.success) {
      return { success: false, message: result.stderr };
    }
  }

  return { success: true, dumpPath, message: "Database dumped successfully" };
}

export async function dumpMariadb(job: MariadbJob): Promise<DumpResult> {
  const tempDir = ensureTempDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dumpPath = join(tempDir, `mariadb-${job.database}-${timestamp}.sql`);

  const args: string[] = [
    "-h", job.host,
    "-P", job.port.toString(),
    "-u", job.user,
  ];

  if (job.password) {
    args.push(`-p${job.password}`);
  }

  if (job.all_databases) {
    args.push("--all-databases");
  } else {
    args.push(job.database);
  }

  args.push("--result-file=" + dumpPath);

  // Try mariadb-dump first (canonical name in newer MariaDB client packages),
  // fall back to mysqldump for older packages and compatibility symlinks.
  let result = await runCommand("mariadb-dump", args, {}, 3600000);
  if (!result.success && result.stderr.toLowerCase().includes("enoent")) {
    result = await runCommand("mysqldump", args, {}, 3600000);
  }

  if (!result.success) {
    return { success: false, message: result.stderr };
  }

  return { success: true, dumpPath, message: "Database dumped successfully" };
}

export async function dumpRedis(job: RedisJob): Promise<DumpResult> {
  const tempDir = ensureTempDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dumpPath = join(tempDir, `redis-${timestamp}.rdb`);

  if (job.rdb_path && existsSync(job.rdb_path)) {
    const content = readFileSync(job.rdb_path);
    writeFileSync(dumpPath, content);
    return { success: true, dumpPath, message: "Redis RDB copied" };
  }

  const cliArgs: string[] = [
    "-h", job.host,
    "-p", job.port.toString(),
  ];

  if (job.password) {
    cliArgs.push("--no-auth-warning", "-a", job.password);
  }

  // Primary method: dump RDB over the network using redis-cli --rdb.
  // This streams the RDB payload via the replication protocol and works
  // in containerised environments where Redis's data directory is not
  // mounted into the worker container.
  const rdbDumpResult = await runCommand("redis-cli", [...cliArgs, "--rdb", dumpPath], {});
  if (existsSync(dumpPath)) {
    return { success: true, dumpPath, message: "Redis RDB backed up via network" };
  }

  // Fallback: BGSAVE + wait + read local file.
  // This only succeeds when the Redis data directory is mounted into the worker.
  const bgsaveResult = await runCommand("redis-cli", [...cliArgs, "BGSAVE"], {});
  if (!bgsaveResult.success) {
    return {
      success: false,
      message: rdbDumpResult.stderr || bgsaveResult.stderr || "redis-cli --rdb failed and BGSAVE fallback also failed",
    };
  }

  let lastSave = "";
  const startTime = Date.now();
  const timeout = 300000; // 5 minutes

  const initialResult = await runCommand("redis-cli", [...cliArgs, "LASTSAVE"], {});
  if (initialResult.success) {
    lastSave = initialResult.stdout.trim();
  }

  while (Date.now() - startTime < timeout) {
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const result = await runCommand("redis-cli", [...cliArgs, "LASTSAVE"], {});
    if (result.success && result.stdout.trim() !== lastSave) {
      break;
    }
  }

  const configResult = await runCommand("redis-cli", [...cliArgs, "CONFIG", "GET", "dir"], {});
  if (!configResult.success) {
    return { success: false, message: "Could not get Redis data directory" };
  }

  const dirMatch = configResult.stdout.match(/dir\n(.+)/);
  const dataDir = dirMatch ? dirMatch[1].trim() : "/var/lib/redis";

  const dbFileResult = await runCommand("redis-cli", [...cliArgs, "CONFIG", "GET", "dbfilename"], {});
  const dbMatch = dbFileResult.stdout.match(/dbfilename\n(.+)/);
  const dbFilename = dbMatch ? dbMatch[1].trim() : "dump.rdb";

  const rdbPath = join(dataDir, dbFilename);

  if (!existsSync(rdbPath)) {
    return { success: false, message: `RDB file not found at ${rdbPath}` };
  }

  const content = readFileSync(rdbPath);
  writeFileSync(dumpPath, content);

  return { success: true, dumpPath, message: "Redis RDB backed up" };
}

export function cleanupDump(dumpPath: string): void {
  try {
    if (existsSync(dumpPath)) {
      unlinkSync(dumpPath);
    }
  } catch (error) {
    console.error(`Failed to cleanup dump file ${dumpPath}:`, error);
  }
}

export async function runDatabaseBackup(
  job: PostgresJob | MariadbJob | RedisJob,
  jobName: string,
  storage: StorageConfig,
  repoName: string,
  resticPassword: string,
  onProgress?: (line: string) => void
): Promise<{ success: boolean; message: string; snapshotId?: string }> {
  let dumpResult: DumpResult;

  switch (job.type) {
    case "postgres":
      dumpResult = await dumpPostgres(job);
      break;
    case "mariadb":
      dumpResult = await dumpMariadb(job);
      break;
    case "redis":
      dumpResult = await dumpRedis(job);
      break;
    default:
      return { success: false, message: "Unknown database type" };
  }

  if (!dumpResult.success || !dumpResult.dumpPath) {
    return { success: false, message: dumpResult.message };
  }

  try {
    const initResult = await restic.initRepo(storage, repoName, resticPassword);
    if (!initResult.success) {
      return { success: false, message: `Failed to init repo: ${initResult.message}` };
    }

    const backupResult = await restic.backup(storage, repoName, resticPassword, dumpResult.dumpPath, {
      tags: [...(job.tags || []), jobName, job.type],
      hostname: `${job.type}-backup`,
      onProgress,
    });

    if (backupResult.success) {
      return {
        success: true,
        message: `Database backup completed`,
        snapshotId: backupResult.snapshotId,
      };
    }

    return { success: false, message: backupResult.message };
  } finally {
    cleanupDump(dumpResult.dumpPath);
  }
}
