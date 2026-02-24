import { hostname } from "os";

export interface WorkerConfig {
  id: string;
  name: string;
  groups: string[];
  hostname: string;
  healthPort: number;
  heartbeatInterval: number;
  heartbeatTimeout: number;
  concurrency: number;
}

export function getWorkerConfig(): WorkerConfig {
  const id = process.env.WORKER_ID || `worker-${hostname()}-${process.pid}`;
  const name = process.env.WORKER_NAME || id;
  const groupsStr = process.env.WORKER_GROUPS || "default";
  const groups = groupsStr.split(",").map((g) => g.trim()).filter(Boolean);

  return {
    id,
    name,
    groups,
    hostname: hostname(),
    healthPort: parseInt(process.env.WORKER_HEALTH_PORT || "3002", 10),
    heartbeatInterval: parseInt(process.env.WORKER_HEARTBEAT_INTERVAL || "5000", 10),
    heartbeatTimeout: parseInt(process.env.WORKER_HEARTBEAT_TIMEOUT || "30000", 10),
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || "2", 10),
  };
}
