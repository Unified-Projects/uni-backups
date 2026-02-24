import { Hono } from "hono";
import { serve } from "bun";
import { getWorkerConfig } from "./config";
import { HeartbeatService } from "./services/heartbeat";
import { JobProcessor } from "./services/processor";
import { HealthChecker } from "./services/health-checker";
import { FencingService } from "./services/fencing";
import { loadConfig } from "@uni-backups/shared/config";
import { getRedisConnection, closeRedisConnections } from "@uni-backups/shared/redis";

let heartbeatService: HeartbeatService | null = null;
let jobProcessor: JobProcessor | null = null;
let healthChecker: HealthChecker | null = null;
let fencingService: FencingService | null = null;

function createHealthServer(config: ReturnType<typeof getWorkerConfig>) {
  const app = new Hono();

  app.get("/health", (c) => {
    if (!heartbeatService?.isRunning() || !jobProcessor?.isRunning()) {
      return c.json(
        {
          status: "unhealthy",
          worker: config.id,
          heartbeat: heartbeatService?.isRunning() ?? false,
          processor: jobProcessor?.isRunning() ?? false,
        },
        503
      );
    }

    const state = heartbeatService.getState();

    return c.json({
      status: "healthy",
      worker: config.id,
      name: config.name,
      groups: config.groups,
      currentJobs: state.currentJobs,
      metrics: state.metrics,
    });
  });

  app.get("/ready", (c) => {
    if (!heartbeatService?.isRunning() || !jobProcessor?.isRunning()) {
      return c.json({ ready: false }, 503);
    }
    return c.json({ ready: true });
  });

  app.get("/live", (c) => {
    return c.json({ alive: true });
  });

  app.get("/status", (c) => {
    const state = heartbeatService?.getState() ?? {
      running: false,
      currentJobs: [],
      metrics: { jobsProcessed: 0, jobsFailed: 0, lastJobTime: 0 },
    };

    return c.json({
      worker: {
        id: config.id,
        name: config.name,
        hostname: config.hostname,
        groups: config.groups,
      },
      state: {
        heartbeatRunning: heartbeatService?.isRunning() ?? false,
        processorRunning: jobProcessor?.isRunning() ?? false,
        currentJobs: state.currentJobs,
        metrics: state.metrics,
      },
    });
  });

  return app;
}

async function main() {
  console.log(`[Worker] Starting Uni-Backups Worker...`);

  const workerConfig = getWorkerConfig();
  console.log(`[Worker] Worker ID: ${workerConfig.id}`);
  console.log(`[Worker] Worker Name: ${workerConfig.name}`);
  console.log(`[Worker] Worker Groups: ${workerConfig.groups.join(", ")}`);

  try {
    loadConfig();
    console.log(`[Worker] Configuration loaded`);
  } catch (error) {
    console.error(`[Worker] Failed to load configuration:`, error);
    process.exit(1);
  }

  try {
    const redis = getRedisConnection();
    await redis.ping();
    console.log(`[Worker] Redis connection established`);
  } catch (error) {
    console.error(`[Worker] Failed to connect to Redis:`, error);
    process.exit(1);
  }

  heartbeatService = new HeartbeatService(workerConfig);
  await heartbeatService.start();
  console.log(`[Worker] Heartbeat service started`);

  jobProcessor = new JobProcessor(workerConfig, heartbeatService);
  await jobProcessor.initialize();
  console.log(`[Worker] Job processor started`);

  healthChecker = new HealthChecker(workerConfig);
  await healthChecker.start();
  console.log(`[Worker] Health checker started`);

  fencingService = new FencingService(workerConfig);
  console.log(`[Worker] Fencing service initialized`);

  const app = createHealthServer(workerConfig);
  const server = serve({
    fetch: app.fetch,
    port: workerConfig.healthPort,
  });

  console.log(`[Worker] Health server listening on port ${workerConfig.healthPort}`);
  console.log(`[Worker] Worker started successfully`);

  const shutdown = async (signal: string) => {
    console.log(`[Worker] Received ${signal}, shutting down gracefully...`);

    if (jobProcessor) {
      await jobProcessor.pause();
    }

    // Wait for current jobs to complete (with timeout)
    const shutdownTimeout = 30000; // 30 seconds
    const startTime = Date.now();

    while (
      heartbeatService?.getState().currentJobs.length &&
      Date.now() - startTime < shutdownTimeout
    ) {
      console.log(
        `[Worker] Waiting for ${heartbeatService.getState().currentJobs.length} jobs to complete...`
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (healthChecker) {
      await healthChecker.stop();
    }

    if (jobProcessor) {
      await jobProcessor.stop();
    }

    if (heartbeatService) {
      await heartbeatService.stop();
    }

    if (fencingService) {
      fencingService.clearLocalTokens();
    }

    await closeRedisConnections();

    server.stop();

    console.log(`[Worker] Shutdown complete`);
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  process.on("uncaughtException", (error) => {
    console.error(`[Worker] Uncaught exception:`, error);
    shutdown("uncaughtException");
  });

  process.on("unhandledRejection", (reason) => {
    console.error(`[Worker] Unhandled rejection:`, reason);
    shutdown("unhandledRejection");
  });
}

main().catch((error) => {
  console.error(`[Worker] Fatal error:`, error);
  process.exit(1);
});
