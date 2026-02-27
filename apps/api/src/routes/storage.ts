import { Hono } from "hono";
import { existsSync } from "fs";
import { join } from "path";
import { getAllStorage, getStorage, getConfig } from "@uni-backups/shared/config";
import * as restic from "../services/restic";

const storage = new Hono();

storage.get("/", (c) => {
  const storages = getAllStorage();

  return c.json({
    storage: storages.map(({ name, config }) => ({
      name,
      type: config.type,
      // Don't expose sensitive data
      ...(config.type === "sftp" && {
        host: config.host,
        port: config.port,
        path: config.path,
      }),
      ...(config.type === "s3" && {
        endpoint: config.endpoint,
        bucket: config.bucket,
        region: config.region,
        path: config.path,
      }),
      ...(config.type === "rest" && {
        url: config.url,
      }),
      ...(config.type === "local" && {
        path: config.path,
      }),
      ...(config.type === "rclone" && {
        remote: config.remote,
        path: config.path,
      }),
    })),
  });
});

storage.get("/:name/status", async (c) => {
  const name = c.req.param("name");
  const storageConfig = getStorage(name);

  if (!storageConfig) {
    return c.json({ error: `Storage "${name}" not found` }, 404);
  }

  const resticPassword = getConfig().resticPassword;
  const testRepoName = "_connection_test";

  try {
    const result = await restic.initRepo(storageConfig, testRepoName, resticPassword);

    if (result.success) {
      return c.json({
        name,
        status: "connected",
        connected: true,
        message: result.message,
      });
    } else {
      return c.json({
        name,
        status: "error",
        connected: false,
        message: result.message,
      });
    }
  } catch (error) {
    return c.json({
      name,
      status: "error",
      connected: false,
      message: error instanceof Error ? error.message : "Connection failed",
    });
  }
});

storage.get("/:name/repos", async (c) => {
  const name = c.req.param("name");
  const storageConfig = getStorage(name);

  if (!storageConfig) {
    return c.json({ error: `Storage "${name}" not found` }, 404);
  }

  const config = getConfig();
  const repos = new Set<string>();

  for (const [jobName, jobConfig] of config.jobs) {
    if (jobConfig.storage === name) {
      repos.add(jobConfig.repo || jobName);
    }
  }

  // For local storage, only return repos that have actually been initialized
  // (i.e. have a restic config file). This prevents check/snapshot calls on
  // repos that exist in the config but haven't been backed up yet.
  let repoList = Array.from(repos);
  if (storageConfig.type === "local") {
    repoList = repoList.filter((repoName) =>
      existsSync(join(storageConfig.path, repoName, "config"))
    );
  }

  return c.json({
    storage: name,
    repos: repoList,
  });
});

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    ),
  ]);
}

storage.get("/:name/stats", async (c) => {
  const name = c.req.param("name");
  const storageConfig = getStorage(name);

  if (!storageConfig) {
    return c.json({ error: `Storage "${name}" not found` }, 404);
  }

  const config = getConfig();
  const resticPassword = config.resticPassword;

  const repos = new Set<string>();
  for (const [jobName, jobConfig] of config.jobs) {
    if (jobConfig.storage === name) {
      repos.add(jobConfig.repo || jobName);
    }
  }

  // Timeout for each repo stats check (150 seconds to match frontend timeout)
  const REPO_TIMEOUT_MS = 150000;

  const repoStatsPromises = Array.from(repos).map(async (repoName) => {
    try {
      const [statsResult, snapshotsResult] = await Promise.all([
        withTimeout(
          restic.stats(storageConfig, repoName, resticPassword),
          REPO_TIMEOUT_MS,
          "Stats request timed out"
        ),
        withTimeout(
          restic.listSnapshots(storageConfig, repoName, resticPassword),
          REPO_TIMEOUT_MS,
          "Snapshots request timed out"
        ),
      ]);

      if (statsResult.success && statsResult.stats) {
        return {
          repo: repoName,
          totalSize: statsResult.stats.total_size || 0,
          totalFileCount: statsResult.stats.total_file_count || 0,
          snapshotsCount: snapshotsResult.snapshots?.length || 0,
        };
      } else {
        const errorMsg = statsResult.message || "Failed to get stats";
        const isRepoNotExist = errorMsg.includes("repository does not exist") || errorMsg.includes("does not exist");
        return {
          repo: repoName,
          totalSize: 0,
          totalFileCount: 0,
          snapshotsCount: 0,
          error: isRepoNotExist ? "Repository not initialized (no backups yet)" : errorMsg,
        };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      return {
        repo: repoName,
        totalSize: 0,
        totalFileCount: 0,
        snapshotsCount: 0,
        error: errorMsg,
      };
    }
  });

  const repoStats = await Promise.all(repoStatsPromises);

  let totalSize = 0;
  let totalFileCount = 0;
  let totalSnapshots = 0;

  for (const stat of repoStats) {
    if (!stat.error) {
      totalSize += stat.totalSize;
      totalFileCount += stat.totalFileCount;
      totalSnapshots += stat.snapshotsCount;
    }
  }

  return c.json({
    storage: name,
    totalSize,
    totalFileCount,
    totalSnapshots,
    repoCount: repos.size,
    repos: repoStats,
  });
});

export default storage;
