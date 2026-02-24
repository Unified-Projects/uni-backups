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

/**
 * Run a command and return result
 */
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

/**
 * Dump PostgreSQL database
 */
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

/**
 * Dump MariaDB/MySQL database
 */
export async function dumpMariadb(job: MariadbJob): Promise<DumpResult> {
  const tempDir = ensureTempDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dumpPath = join(tempDir, `mariadb-${job.database}-${timestamp}.sql`);

  // Use mariadb-dump with --skip-ssl for Alpine compatibility
  // Alpine's mariadb-client defaults to requiring SSL
  const args: string[] = [
    "--skip-ssl",
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

  const result = await runCommand("mariadb-dump", args, {}, 3600000);

  if (!result.success) {
    return { success: false, message: result.stderr };
  }

  return { success: true, dumpPath, message: "Database dumped successfully" };
}

/**
 * Dump Redis database
 */
export async function dumpRedis(job: RedisJob): Promise<DumpResult> {
  const tempDir = ensureTempDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dumpPath = join(tempDir, `redis-${timestamp}.rdb`);

  // If RDB path is known, just copy it
  if (job.rdb_path && existsSync(job.rdb_path)) {
    const content = readFileSync(job.rdb_path);
    writeFileSync(dumpPath, content);
    return { success: true, dumpPath, message: "Redis RDB copied" };
  }

  // Otherwise trigger BGSAVE and wait for it
  const cliArgs: string[] = [
    "-h", job.host,
    "-p", job.port.toString(),
  ];

  if (job.password) {
    cliArgs.push("-a", job.password);
  }

  // Trigger BGSAVE (use 30 second timeout for connection/auth)
  const bgsaveResult = await runCommand("redis-cli", [...cliArgs, "BGSAVE"], {}, 30000);

  // Check for authentication errors - redis-cli may exit 0 but output NOAUTH error
  const bgsaveOutput = bgsaveResult.stdout + bgsaveResult.stderr;
  if (!bgsaveResult.success || bgsaveOutput.includes("NOAUTH") || bgsaveOutput.includes("ERR ")) {
    return { success: false, message: bgsaveOutput || "BGSAVE failed - check Redis connection and authentication" };
  }

  // Wait for BGSAVE to complete (poll LASTSAVE)
  let lastSave = "";
  const startTime = Date.now();
  const timeout = 300000; // 5 minutes

  // Get initial LASTSAVE (30 second timeout)
  const initialResult = await runCommand("redis-cli", [...cliArgs, "LASTSAVE"], {}, 30000);
  if (initialResult.success) {
    lastSave = initialResult.stdout.trim();
  }

  // Poll until LASTSAVE changes
  while (Date.now() - startTime < timeout) {
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const result = await runCommand("redis-cli", [...cliArgs, "LASTSAVE"], {}, 30000);
    if (result.success && result.stdout.trim() !== lastSave) {
      break;
    }
  }

  // Get the RDB file location from CONFIG (30 second timeout)
  const configResult = await runCommand("redis-cli", [...cliArgs, "CONFIG", "GET", "dir"], {}, 30000);
  if (!configResult.success) {
    return { success: false, message: "Could not get Redis data directory" };
  }

  const dirMatch = configResult.stdout.match(/dir\n(.+)/);
  const dataDir = dirMatch ? dirMatch[1].trim() : "/var/lib/redis";

  const dbFileResult = await runCommand("redis-cli", [...cliArgs, "CONFIG", "GET", "dbfilename"], {}, 30000);
  const dbMatch = dbFileResult.stdout.match(/dbfilename\n(.+)/);
  const dbFilename = dbMatch ? dbMatch[1].trim() : "dump.rdb";

  const rdbPath = join(dataDir, dbFilename);

  if (!existsSync(rdbPath)) {
    return { success: false, message: `RDB file not found at ${rdbPath}` };
  }

  // Copy the RDB file
  const content = readFileSync(rdbPath);
  writeFileSync(dumpPath, content);

  return { success: true, dumpPath, message: "Redis RDB backed up" };
}

/**
 * Clean up a dump file
 */
export function cleanupDump(dumpPath: string): void {
  try {
    if (existsSync(dumpPath)) {
      unlinkSync(dumpPath);
    }
  } catch (error) {
    console.error(`Failed to cleanup dump file ${dumpPath}:`, error);
  }
}

/**
 * Run a database backup job - dumps the database and backs it up with restic
 */
export async function runDatabaseBackup(
  job: PostgresJob | MariadbJob | RedisJob,
  jobName: string,
  storage: StorageConfig,
  repoName: string,
  resticPassword: string
): Promise<{ success: boolean; message: string; snapshotId?: string }> {
  let dumpResult: DumpResult;

  // Dump the database based on type
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
    // Initialize repo if needed
    const initResult = await restic.initRepo(storage, repoName, resticPassword);
    if (!initResult.success) {
      return { success: false, message: `Failed to init repo: ${initResult.message}` };
    }

    // Backup the dump file
    const backupResult = await restic.backup(storage, repoName, resticPassword, dumpResult.dumpPath, {
      tags: [...(job.tags || []), jobName, job.type],
      hostname: `${job.type}-backup`,
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
    // Always clean up the dump file
    cleanupDump(dumpResult.dumpPath);
  }
}
