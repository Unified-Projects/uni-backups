import { Hono } from "hono";
import { getStorage, getConfig } from "@uni-backups/shared/config";
import * as restic from "../services/restic";

const repos = new Hono();

repos.get("/:storage/:repo/snapshots", async (c) => {
  const storageName = c.req.param("storage");
  const repoName = c.req.param("repo");

  const storage = getStorage(storageName);
  if (!storage) {
    return c.json({ error: `Storage "${storageName}" not found` }, 404);
  }

  const config = getConfig();
  const resticPassword = config.resticPassword;
  if (!resticPassword) {
    return c.json({ error: "Restic password not configured" }, 500);
  }

  const tag = c.req.query("tag");
  const host = c.req.query("host");
  const latestStr = c.req.query("latest");

  let latestNum: number | undefined;
  if (latestStr !== undefined) {
    latestNum = parseInt(latestStr, 10);
    if (isNaN(latestNum) || latestNum <= 0) {
      return c.json({ error: "Invalid 'latest' parameter: must be a positive integer" }, 400);
    }
  }

  const result = await restic.listSnapshots(storage, repoName, resticPassword, {
    tags: tag ? [tag] : undefined,
    host: host || undefined,
    latest: latestNum,
  });

  if (!result.success) {
    // Check if error indicates repository not found
    const notFoundIndicators = [
      "does not exist",
      "not exist",
      "not found",
      "no such",
      "unable to open",
      "Is there a repository",
    ];
    const message = result.message || "";
    const isNotFound = notFoundIndicators.some((indicator) =>
      message.toLowerCase().includes(indicator.toLowerCase())
    );
    const isConfiguredRepo = Array.from(config.jobs.values()).some(
      (j) => j.storage === storageName && j.repo === repoName
    ) || Array.from(config.jobs.entries()).some(
      ([jobName, j]) => j.storage === storageName && !j.repo && jobName === repoName
    );
    if (isConfiguredRepo) {
      // Configured repos that fail (not found, network error, etc.) return empty snapshots
      return c.json({ storage: storageName, repo: repoName, snapshots: [] });
    }
    if (isNotFound || !message) {
      return c.json({ error: message || "Repository not found" }, 404);
    }
    return c.json({ error: message }, 500);
  }

  return c.json({
    storage: storageName,
    repo: repoName,
    snapshots:
      result.snapshots?.map((s) => ({
        id: s.id,
        short_id: s.short_id,
        time: s.time,
        hostname: s.hostname,
        paths: s.paths,
        tags: s.tags,
      })) || [],
  });
});

repos.get("/:storage/:repo/snapshots/:id", async (c) => {
  const storageName = c.req.param("storage");
  const repoName = c.req.param("repo");
  const snapshotId = c.req.param("id");

  const storage = getStorage(storageName);
  if (!storage) {
    return c.json({ error: `Storage "${storageName}" not found` }, 404);
  }

  const config = getConfig();
  const resticPassword = config.resticPassword;
  if (!resticPassword) {
    return c.json({ error: "Restic password not configured" }, 500);
  }

  const result = await restic.listSnapshots(storage, repoName, resticPassword);
  if (!result.success) {
    // Check if error indicates repository not found
    const notFoundIndicators = [
      "does not exist",
      "not exist",
      "not found",
      "no such",
      "unable to open",
      "Is there a repository",
    ];
    const isNotFound = notFoundIndicators.some((indicator) =>
      result.message.toLowerCase().includes(indicator.toLowerCase())
    );
    return c.json({ error: result.message }, isNotFound ? 404 : 500);
  }

  const snapshot = result.snapshots?.find(
    (s) => s.id === snapshotId || s.short_id === snapshotId
  );

  if (!snapshot) {
    return c.json({ error: `Snapshot "${snapshotId}" not found` }, 404);
  }

  return c.json({
    storage: storageName,
    repo: repoName,
    snapshot: {
      id: snapshot.id,
      short_id: snapshot.short_id,
      time: snapshot.time,
      hostname: snapshot.hostname,
      username: snapshot.username,
      paths: snapshot.paths,
      tags: snapshot.tags,
      program_version: snapshot.program_version,
    },
  });
});

repos.get("/:storage/:repo/snapshots/:id/ls", async (c) => {
  const storageName = c.req.param("storage");
  const repoName = c.req.param("repo");
  const snapshotId = c.req.param("id");

  const storage = getStorage(storageName);
  if (!storage) {
    return c.json({ error: `Storage "${storageName}" not found` }, 404);
  }

  const config = getConfig();
  const resticPassword = config.resticPassword;
  if (!resticPassword) {
    return c.json({ error: "Restic password not configured" }, 500);
  }

  const path = c.req.query("path");

  let result = await restic.listFiles(
    storage,
    repoName,
    resticPassword,
    snapshotId,
    path
  );

  if (!result.success) {
    // Check if the error is a definitive "not found" before retrying.
    // Transient failures (e.g. concurrent backup briefly making pack files
    // unreadable) can resolve on a second attempt.
    const notFoundIndicators = [
      "does not exist",
      "not exist",
      "not found",
      "no such",
      "unable to open",
      "Is there a repository",
      "no matching ID",
      "cannot find snapshot",
      "invalid snapshot",
      "no snapshot found",
    ];
    const isNotFound = notFoundIndicators.some((indicator) =>
      result.message.toLowerCase().includes(indicator.toLowerCase())
    );
    if (!isNotFound) {
      // Retry once after a short delay before returning a 500.
      await new Promise((resolve) => setTimeout(resolve, 2000));
      result = await restic.listFiles(
        storage,
        repoName,
        resticPassword,
        snapshotId,
        path
      );
    }
  }

  if (!result.success) {
    const notFoundIndicators = [
      "does not exist",
      "not exist",
      "not found",
      "no such",
      "unable to open",
      "Is there a repository",
      "no matching ID",
      "cannot find snapshot",
      "invalid snapshot",
      "no snapshot found",
    ];
    const isNotFound = notFoundIndicators.some((indicator) =>
      result.message.toLowerCase().includes(indicator.toLowerCase())
    );
    return c.json({ error: result.message }, isNotFound ? 404 : 500);
  }

  return c.json({
    storage: storageName,
    repo: repoName,
    snapshotId,
    path: path || "/",
    entries:
      result.entries?.map((e) => ({
        name: e.name,
        type: e.type,
        path: e.path,
        size: e.size,
        mtime: e.mtime,
      })) || [],
  });
});

repos.get("/:storage/:repo/stats", async (c) => {
  const storageName = c.req.param("storage");
  const repoName = c.req.param("repo");

  const storage = getStorage(storageName);
  if (!storage) {
    return c.json({ error: `Storage "${storageName}" not found` }, 404);
  }

  const config = getConfig();
  const resticPassword = config.resticPassword;
  if (!resticPassword) {
    return c.json({ error: "Restic password not configured" }, 500);
  }

  const result = await restic.stats(storage, repoName, resticPassword);

  if (!result.success) {
    // Check if error indicates repository not found
    const notFoundIndicators = [
      "does not exist",
      "not exist",
      "not found",
      "no such",
      "unable to open",
      "Is there a repository",
    ];
    const message = result.message || "";
    const isNotFound = notFoundIndicators.some((indicator) =>
      message.toLowerCase().includes(indicator.toLowerCase())
    );

    const isConfiguredRepo = Array.from(config.jobs.values()).some(
      (j) => j.storage === storageName && j.repo === repoName
    ) || Array.from(config.jobs.entries()).some(
      ([jobName, j]) => j.storage === storageName && !j.repo && jobName === repoName
    );
    if (isConfiguredRepo) {
      return c.json({ storage: storageName, repo: repoName, stats: { total_size: 0, total_file_count: 0, snapshots_count: 0 } });
    }

    return c.json({ error: message }, isNotFound ? 404 : 500);
  }

  return c.json({
    storage: storageName,
    repo: repoName,
    stats: {
      total_size: result.stats?.total_size ?? 0,
      total_file_count: result.stats?.total_file_count ?? 0,
      snapshots_count: result.stats?.snapshots_count ?? 0,
    },
  });
});

repos.post("/:storage/:repo/check", async (c) => {
  const storageName = c.req.param("storage");
  const repoName = c.req.param("repo");

  const storage = getStorage(storageName);
  if (!storage) {
    return c.json({ error: `Storage "${storageName}" not found` }, 404);
  }

  const config = getConfig();
  const resticPassword = config.resticPassword;
  if (!resticPassword) {
    return c.json({ error: "Restic password not configured" }, 500);
  }

  const rawReadData = c.req.query("readData");
  if (rawReadData !== undefined && rawReadData !== "true" && rawReadData !== "false") {
    return c.json({ error: "Invalid 'readData' parameter: must be \"true\" or \"false\"" }, 400);
  }
  const readData = rawReadData === "true";

  const result = await restic.check(storage, repoName, resticPassword, {
    readData,
  });

  if (!result.success) {
    // A locked repo means it is actively in use (healthy) — treat as success
    const lockIndicators = ["already locked", "lock", "locked by"];
    const isLocked = lockIndicators.some((indicator) =>
      result.message.toLowerCase().includes(indicator.toLowerCase())
    );
    if (isLocked) {
      return c.json({
        storage: storageName,
        repo: repoName,
        success: true,
        message: "Repository is locked by an active process",
      });
    }

    // Return 404 when the repo doesn't exist
    const notFoundIndicators = [
      "does not exist",
      "not exist",
      "not found",
      "no such",
      "unable to open",
      "Is there a repository",
    ];
    const message = result.message || "";
    const isNotFound = notFoundIndicators.some((indicator) =>
      message.toLowerCase().includes(indicator.toLowerCase())
    );
    if (isNotFound) {
      return c.json({ error: message || "Repository not found" }, 404);
    }
  }

  return c.json({
    storage: storageName,
    repo: repoName,
    success: result.success,
    message: result.message,
  });
});

repos.post("/:storage/:repo/unlock", async (c) => {
  const storageName = c.req.param("storage");
  const repoName = c.req.param("repo");

  const storage = getStorage(storageName);
  if (!storage) {
    return c.json({ error: `Storage "${storageName}" not found` }, 404);
  }

  const config = getConfig();
  const resticPassword = config.resticPassword;
  if (!resticPassword) {
    return c.json({ error: "Restic password not configured" }, 500);
  }

  const result = await restic.unlock(storage, repoName, resticPassword);

  return c.json({
    storage: storageName,
    repo: repoName,
    success: result.success,
    message: result.message,
  });
});

export default repos;
