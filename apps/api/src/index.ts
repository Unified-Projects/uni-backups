import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { getCorsConfig } from "@uni-backups/shared/config";
import { getRedisConnection, closeRedisConnections } from "@uni-backups/shared/redis";
import { initScheduler, stopScheduler } from "./services/scheduler";

import storageRoutes from "./routes/storage";
import jobsRoutes from "./routes/jobs";
import reposRoutes from "./routes/repos";
import restoreRoutes from "./routes/restore";
import scheduleRoutes from "./routes/schedule";
import workersRoutes from "./routes/workers";
import clusterRoutes from "./routes/cluster";

const app = new Hono();

app.use("*", logger());

const corsConfig = getCorsConfig();
if (corsConfig.enabled) {
  app.use(
    "*",
    cors({
      origin: corsConfig.origins,
      credentials: true,
    })
  );
}

app.get("/health", async (c) => {
  try {
    const redis = getRedisConnection();
    await redis.ping();

    return c.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      redis: "connected",
    });
  } catch (error) {
    return c.json(
      {
        status: "degraded",
        timestamp: new Date().toISOString(),
        redis: "disconnected",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      503
    );
  }
});

app.route("/api/storage", storageRoutes);
app.route("/api/jobs", jobsRoutes);
app.route("/api/repos", reposRoutes);
app.route("/api/restore", restoreRoutes);
app.route("/api/schedule", scheduleRoutes);
app.route("/api/workers", workersRoutes);
app.route("/api/cluster", clusterRoutes);

app.get("/", (c) => {
  return c.json({
    name: "Uni-Backups API",
    version: "0.1.0",
    endpoints: {
      health: "/health",
      storage: "/api/storage",
      jobs: "/api/jobs",
      repos: "/api/repos",
      restore: "/api/restore",
      schedule: "/api/schedule",
      workers: "/api/workers",
      cluster: "/api/cluster",
    },
  });
});

async function init() {
  console.log("[API] Initializing services...");

  try {
    const redis = getRedisConnection();
    await redis.ping();
    console.log("[API] Redis connection established");
  } catch (error) {
    console.error("[API] Failed to connect to Redis:", error);
    console.warn("[API] Starting without Redis - some features will be unavailable");
  }

  try {
    await initScheduler();
    console.log("[API] Scheduler initialized");
  } catch (error) {
    console.error("[API] Failed to initialize scheduler:", error);
  }
}

async function shutdown(signal: string) {
  console.log(`[API] Received ${signal}, shutting down gracefully...`);

  try {
    await stopScheduler();
    await closeRedisConnections();
    console.log("[API] Shutdown complete");
  } catch (error) {
    console.error("[API] Error during shutdown:", error);
  }

  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

const PORT = 3001;

init().then(() => {
  console.log(`[API] Uni-Backups API starting on port ${PORT}...`);
});

export default {
  port: PORT,
  fetch: app.fetch,
};
