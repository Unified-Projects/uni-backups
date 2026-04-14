import { Hono } from "hono";
import { createReadStream, existsSync, lstatSync, mkdirSync, statSync, unlinkSync } from "fs";
import { Readable } from "stream";
import { isAbsolute, join, relative, resolve } from "path";
import { spawn } from "child_process";
import { getStorage, getConfig, getTempDir } from "@uni-backups/shared/config";
import * as restic from "../services/restic";

const restore = new Hono();

interface RestoreOperation {
  id: string;
  storage: string;
  repo: string;
  snapshotId: string;
  paths: string[];
  method: "download" | "path";
  target?: string;
  status: "pending" | "running" | "completed" | "failed";
  startTime: Date;
  endTime?: Date;
  message?: string;
  archivePath?: string;
}

const restoreOperations = new Map<string, RestoreOperation>();
const restoreCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
const TERMINAL_OPERATION_TTL_MS = 60 * 60 * 1000;
const DOWNLOAD_COMPLETION_TTL_MS = 5 * 60 * 1000;

function getRestoreRoot(): string {
  return resolve(getTempDir(), "restores");
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function isWithinRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = relative(rootPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function validatePathRestoreTarget(rawTarget: string): string {
  const restoreRoot = getRestoreRoot();
  const trimmedTarget = rawTarget.trim();

  if (!trimmedTarget) {
    throw new Error("Target path is required for path restore method");
  }

  if (existsSync(restoreRoot) && lstatSync(restoreRoot).isSymbolicLink()) {
    throw new Error(`Restore root "${restoreRoot}" cannot be a symbolic link`);
  }

  const resolvedTarget = isAbsolute(trimmedTarget)
    ? resolve(trimmedTarget)
    : resolve(restoreRoot, trimmedTarget);

  if (!isAbsolute(trimmedTarget) && !isWithinRoot(restoreRoot, resolvedTarget)) {
    throw new Error(
      `Target path must stay within the restore root "${restoreRoot}"`
    );
  }

  const parentRoot = isAbsolute(trimmedTarget) ? resolve("/") : restoreRoot;
  const relativeSegments = relative(parentRoot, resolvedTarget)
    .split(/[\\/]+/)
    .filter(Boolean);

  let currentPath = parentRoot;
  for (const segment of relativeSegments) {
    currentPath = join(currentPath, segment);
    if (!existsSync(currentPath)) {
      continue;
    }

    const stats = lstatSync(currentPath);
    if (stats.isSymbolicLink()) {
      throw new Error(
        `Target path contains a symbolic link and cannot be used outside the restore root "${restoreRoot}"`
      );
    }
  }

  return resolvedTarget;
}

function clearRestoreCleanup(id: string): void {
  const timer = restoreCleanupTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    restoreCleanupTimers.delete(id);
  }
}

function deleteRestoreOperation(id: string): void {
  clearRestoreCleanup(id);

  const operation = restoreOperations.get(id);
  if (operation?.archivePath && existsSync(operation.archivePath)) {
    try {
      unlinkSync(operation.archivePath);
    } catch {
      // Ignore cleanup errors
    }
  }

  restoreOperations.delete(id);
}

function scheduleRestoreCleanup(id: string, ttlMs: number): void {
  clearRestoreCleanup(id);

  const timer = setTimeout(() => {
    deleteRestoreOperation(id);
  }, ttlMs);

  restoreCleanupTimers.set(id, timer);
}

function markRestoreOperationTerminal(
  operation: RestoreOperation,
  status: "completed" | "failed",
  message: string
): void {
  operation.status = status;
  operation.message = message;
  operation.endTime = new Date();
  scheduleRestoreCleanup(operation.id, TERMINAL_OPERATION_TTL_MS);
}

async function createArchive(sourceDir: string, archivePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("tar", ["-czf", archivePath, "-C", sourceDir, "."]);

    proc.on("close", (code) => {
      resolve(code === 0);
    });

    proc.on("error", () => {
      resolve(false);
    });
  });
}

restore.post("/", async (c) => {
  let body: {
    storage?: string;
    storageName?: string;
    repo?: string;
    repoName?: string;
    snapshotId: string;
    paths?: string[];
    method?: "download" | "path";
    target?: string;
    targetPath?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const storageName = body.storage || body.storageName || "";
  const repoName = body.repo || body.repoName || "";
  const { snapshotId, paths } = body;
  const target = body.target || body.targetPath;
  const rawMethod = body.method;
  const method: "download" | "path" = (!rawMethod || rawMethod === "download" || rawMethod === "path")
    ? (rawMethod || (target ? "path" : "download"))
    : rawMethod as "download" | "path";

  if (rawMethod && rawMethod !== "download" && rawMethod !== "path") {
    return c.json({ error: `Invalid method "${rawMethod}". Must be "download" or "path"` }, 400);
  }

  if (!storageName || !storageName.trim()) {
    return c.json({ error: "storageName is required" }, 400);
  }

  if (!repoName || !repoName.trim()) {
    return c.json({ error: "repoName is required" }, 400);
  }

  if (!snapshotId || !snapshotId.trim()) {
    return c.json({ error: "snapshotId is required" }, 400);
  }

  if (method === "path" && !target) {
    return c.json({ error: "Target path is required for path restore method" }, 400);
  }

  const storage = getStorage(storageName);
  if (!storage) {
    return c.json({ error: `Storage "${storageName}" not found` }, 404);
  }

  // Validate snapshot ID format (restic IDs are hex strings of 8-64 chars, or "latest")
  if (snapshotId && !/^([a-fA-F0-9]{8,64}|latest)$/.test(snapshotId)) {
    return c.json({ error: `Snapshot "${snapshotId}" not found` }, 404);
  }

  const config = getConfig();
  const resticPassword = config.resticPassword;
  if (!resticPassword) {
    return c.json({ error: "Restic password not configured" }, 500);
  }

  let validatedTarget: string | undefined;
  if (method === "path") {
    try {
      validatedTarget = validatePathRestoreTarget(target!);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Invalid target path" },
        400
      );
    }
  }

  const id = generateId();
  const operation: RestoreOperation = {
    id,
    storage: storageName,
    repo: repoName,
    snapshotId,
    paths: paths || [],
    method,
    target: validatedTarget,
    status: "pending",
    startTime: new Date(),
  };

  restoreOperations.set(id, operation);

  (async () => {
    operation.status = "running";

    try {
      let restoreTarget: string;

      if (method === "download") {
        const tempDir = getTempDir();
        restoreTarget = join(tempDir, `restore-${id}`);
        mkdirSync(restoreTarget, { recursive: true });
      } else {
        restoreTarget = validatedTarget!;
        mkdirSync(restoreTarget, { recursive: true });
      }

      const result = await restic.restore(
        storage,
        repoName,
        resticPassword,
        snapshotId,
        restoreTarget,
        {
          include: paths && paths.length > 0 ? paths : undefined,
        }
      );

      if (!result.success) {
        markRestoreOperationTerminal(operation, "failed", result.message);
        return;
      }

      if (method === "download") {
        const archivePath = join(getTempDir(), `restore-${id}.tar.gz`);
        const archiveSuccess = await createArchive(restoreTarget, archivePath);

        if (!archiveSuccess) {
          markRestoreOperationTerminal(operation, "failed", "Failed to create archive");
          return;
        }

        operation.archivePath = archivePath;

        try {
          spawn("rm", ["-rf", restoreTarget]);
        } catch {
          // Ignore cleanup errors
        }
      }

      markRestoreOperationTerminal(operation, "completed", result.message);
    } catch (error) {
      markRestoreOperationTerminal(
        operation,
        "failed",
        error instanceof Error ? error.message : "Unknown error"
      );
    }
  })();

  return c.json({
    id,
    status: "pending",
    message: "Restore operation started",
  });
});

restore.get("/:id", (c) => {
  const id = c.req.param("id");
  const operation = restoreOperations.get(id);

  if (!operation) {
    return c.json({ error: `Restore operation "${id}" not found` }, 404);
  }

  return c.json({
    id: operation.id,
    storage: operation.storage,
    repo: operation.repo,
    snapshotId: operation.snapshotId,
    paths: operation.paths,
    method: operation.method,
    target: operation.target,
    status: operation.status,
    startTime: operation.startTime,
    endTime: operation.endTime,
    message: operation.message,
    downloadReady: operation.status === "completed" && operation.method === "download",
  });
});

restore.get("/:id/download", async (c) => {
  const id = c.req.param("id");
  const operation = restoreOperations.get(id);

  if (!operation) {
    return c.json({ error: `Restore operation "${id}" not found` }, 404);
  }

  if (operation.status !== "completed") {
    return c.json({ error: "Restore operation not completed" }, 400);
  }

  if (operation.method !== "download" || !operation.archivePath) {
    return c.json({ error: "This restore operation does not support download" }, 400);
  }

  if (!existsSync(operation.archivePath)) {
    return c.json({ error: "Archive file not found" }, 404);
  }

  const stat = statSync(operation.archivePath);
  const filename = `restore-${operation.snapshotId.slice(0, 8)}.tar.gz`;

  const nodeStream = createReadStream(operation.archivePath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;

  c.header("Content-Type", "application/gzip");
  c.header("Content-Disposition", `attachment; filename="${filename}"`);
  c.header("Content-Length", stat.size.toString());

  // Shorten retention once the client starts downloading the archive.
  scheduleRestoreCleanup(id, DOWNLOAD_COMPLETION_TTL_MS);

  return c.body(webStream);
});

restore.get("/", (c) => {
  const operations = Array.from(restoreOperations.values())
    .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
    .slice(0, 50)
    .map((op) => ({
      id: op.id,
      storage: op.storage,
      repo: op.repo,
      snapshotId: op.snapshotId,
      method: op.method,
      status: op.status,
      startTime: op.startTime,
      endTime: op.endTime,
    }));

  return c.json({ operations });
});

export default restore;
