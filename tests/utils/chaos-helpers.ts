/**
 * Chaos Engineering Helpers
 *
 * Utilities for injecting failures, network issues, and other chaos
 * into the system for thorough testing of error handling and recovery.
 */

import { spawn, ChildProcess, exec } from "child_process";
import { promisify } from "util";
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from "fs";
import { join, dirname } from "path";
import {
  pauseContainer,
  unpauseContainer,
  killContainer,
  execInContainer,
  waitForHealthy,
  getContainerStatus,
  disconnectFromNetwork,
  connectToNetwork,
} from "./container-helpers";

const execAsync = promisify(exec);

/**
 * Toxiproxy configuration
 */
export interface ToxiproxyConfig {
  host: string;
  port: number;
}

/**
 * Proxy definition for Toxiproxy
 */
export interface ProxyDefinition {
  name: string;
  listen: string;
  upstream: string;
  enabled?: boolean;
}

/**
 * Toxic definition
 */
export interface ToxicDefinition {
  name: string;
  type: "latency" | "bandwidth" | "slow_close" | "timeout" | "reset_peer" | "slicer" | "limit_data";
  stream: "upstream" | "downstream";
  toxicity: number; // 0.0 to 1.0
  attributes: Record<string, number | string>;
}

/**
 * Chaos worker process wrapper
 */
export interface ChaosWorker {
  pid: number;
  process: ChildProcess;
  containerName?: string;
  kill: (signal?: NodeJS.Signals) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  isRunning: () => boolean;
}

/**
 * Network fault controller
 */
export interface NetworkFault {
  proxyName: string;
  toxicName?: string;
  addLatency: (ms: number, jitter?: number) => Promise<void>;
  dropPackets: (percent: number) => Promise<void>;
  limitBandwidth: (bytesPerSecond: number) => Promise<void>;
  disconnect: () => Promise<void>;
  reconnect: () => Promise<void>;
  reset: () => Promise<void>;
  timeout: (timeoutMs: number) => Promise<void>;
}

/**
 * Split-brain scenario configuration
 */
export interface SplitBrainScenario {
  groupId: string;
  partition1: string[];
  partition2: string[];
  heal: () => Promise<void>;
}

/**
 * Default Toxiproxy configuration
 */
const DEFAULT_TOXIPROXY: ToxiproxyConfig = {
  host: process.env.TOXIPROXY_HOST || "localhost",
  port: parseInt(process.env.TOXIPROXY_PORT || "8474", 10),
};

/**
 * Toxiproxy client for managing proxies and toxics
 */
export class ToxiproxyClient {
  private baseUrl: string;

  constructor(config: ToxiproxyConfig = DEFAULT_TOXIPROXY) {
    this.baseUrl = `http://${config.host}:${config.port}`;
  }

  private async fetch(
    path: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
    return response;
  }

  /**
   * Check if Toxiproxy is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await this.fetch("/version");
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * List all proxies
   */
  async listProxies(): Promise<Record<string, ProxyDefinition>> {
    const response = await this.fetch("/proxies");
    if (!response.ok) {
      throw new Error(`Failed to list proxies: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Get a specific proxy
   */
  async getProxy(name: string): Promise<ProxyDefinition | null> {
    try {
      const response = await this.fetch(`/proxies/${name}`);
      if (!response.ok) return null;
      return response.json();
    } catch {
      return null;
    }
  }

  /**
   * Create a new proxy
   */
  async createProxy(proxy: ProxyDefinition): Promise<void> {
    const response = await this.fetch("/proxies", {
      method: "POST",
      body: JSON.stringify(proxy),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to create proxy: ${body}`);
    }
  }

  /**
   * Delete a proxy
   */
  async deleteProxy(name: string): Promise<void> {
    const response = await this.fetch(`/proxies/${name}`, {
      method: "DELETE",
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to delete proxy: ${response.statusText}`);
    }
  }

  /**
   * Enable a proxy
   */
  async enableProxy(name: string): Promise<void> {
    const response = await this.fetch(`/proxies/${name}`, {
      method: "POST",
      body: JSON.stringify({ enabled: true }),
    });
    if (!response.ok) {
      throw new Error(`Failed to enable proxy: ${response.statusText}`);
    }
  }

  /**
   * Disable a proxy (blocks all traffic)
   */
  async disableProxy(name: string): Promise<void> {
    const response = await this.fetch(`/proxies/${name}`, {
      method: "POST",
      body: JSON.stringify({ enabled: false }),
    });
    if (!response.ok) {
      throw new Error(`Failed to disable proxy: ${response.statusText}`);
    }
  }

  /**
   * List toxics for a proxy
   */
  async listToxics(proxyName: string): Promise<ToxicDefinition[]> {
    const response = await this.fetch(`/proxies/${proxyName}/toxics`);
    if (!response.ok) {
      throw new Error(`Failed to list toxics: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Add a toxic to a proxy
   */
  async addToxic(proxyName: string, toxic: ToxicDefinition): Promise<void> {
    const response = await this.fetch(`/proxies/${proxyName}/toxics`, {
      method: "POST",
      body: JSON.stringify(toxic),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to add toxic: ${body}`);
    }
  }

  /**
   * Remove a toxic from a proxy
   */
  async removeToxic(proxyName: string, toxicName: string): Promise<void> {
    const response = await this.fetch(
      `/proxies/${proxyName}/toxics/${toxicName}`,
      { method: "DELETE" }
    );
    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to remove toxic: ${response.statusText}`);
    }
  }

  /**
   * Remove all toxics from a proxy
   */
  async removeAllToxics(proxyName: string): Promise<void> {
    const toxics = await this.listToxics(proxyName);
    for (const toxic of toxics) {
      await this.removeToxic(proxyName, toxic.name);
    }
  }

  /**
   * Reset all proxies and toxics
   */
  async resetAll(): Promise<void> {
    const response = await this.fetch("/reset", { method: "POST" });
    if (!response.ok) {
      throw new Error(`Failed to reset: ${response.statusText}`);
    }
  }
}

// Global Toxiproxy client instance
let toxiproxyClient: ToxiproxyClient | null = null;

/**
 * Get or create Toxiproxy client
 */
export function getToxiproxy(config?: ToxiproxyConfig): ToxiproxyClient {
  if (!toxiproxyClient || config) {
    toxiproxyClient = new ToxiproxyClient(config);
  }
  return toxiproxyClient;
}

/**
 * Spawn a worker process that can be controlled for chaos testing
 */
export async function spawnWorkerProcess(
  config: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    containerName?: string;
  }
): Promise<ChaosWorker> {
  const { command, args = [], env = {}, cwd, containerName } = config;

  const process = spawn(command, args, {
    env: { ...globalThis.process.env, ...env },
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });

  const worker: ChaosWorker = {
    pid: process.pid!,
    process,
    containerName,

    async kill(signal: NodeJS.Signals = "SIGKILL"): Promise<void> {
      if (containerName) {
        await killContainer(containerName, signal);
      } else {
        process.kill(signal);
      }
    },

    async pause(): Promise<void> {
      if (containerName) {
        await pauseContainer(containerName);
      } else {
        process.kill("SIGSTOP");
      }
    },

    async resume(): Promise<void> {
      if (containerName) {
        await unpauseContainer(containerName);
      } else {
        process.kill("SIGCONT");
      }
    },

    isRunning(): boolean {
      return !process.killed && process.exitCode === null;
    },
  };

  return worker;
}

/**
 * Create a network fault controller for a service
 */
export async function createNetworkFault(
  proxyName: string,
  config?: ToxiproxyConfig
): Promise<NetworkFault> {
  const client = getToxiproxy(config);
  let toxicCounter = 0;

  const fault: NetworkFault = {
    proxyName,

    async addLatency(ms: number, jitter: number = 0): Promise<void> {
      const name = `latency_${++toxicCounter}`;
      await client.addToxic(proxyName, {
        name,
        type: "latency",
        stream: "upstream",
        toxicity: 1.0,
        attributes: { latency: ms, jitter },
      });
      this.toxicName = name;
    },

    async dropPackets(percent: number): Promise<void> {
      // Toxiproxy doesn't have a direct packet drop toxic
      // Use reset_peer with toxicity as a percentage
      const name = `reset_${++toxicCounter}`;
      await client.addToxic(proxyName, {
        name,
        type: "reset_peer",
        stream: "upstream",
        toxicity: percent / 100,
        attributes: {},
      });
      this.toxicName = name;
    },

    async limitBandwidth(bytesPerSecond: number): Promise<void> {
      const name = `bandwidth_${++toxicCounter}`;
      await client.addToxic(proxyName, {
        name,
        type: "bandwidth",
        stream: "upstream",
        toxicity: 1.0,
        attributes: { rate: bytesPerSecond },
      });
      this.toxicName = name;
    },

    async disconnect(): Promise<void> {
      await client.disableProxy(proxyName);
    },

    async reconnect(): Promise<void> {
      await client.enableProxy(proxyName);
    },

    async reset(): Promise<void> {
      await client.removeAllToxics(proxyName);
      await client.enableProxy(proxyName);
    },

    async timeout(timeoutMs: number): Promise<void> {
      const name = `timeout_${++toxicCounter}`;
      await client.addToxic(proxyName, {
        name,
        type: "timeout",
        stream: "upstream",
        toxicity: 1.0,
        attributes: { timeout: timeoutMs },
      });
      this.toxicName = name;
    },
  };

  return fault;
}

/**
 * Inject network latency on a service
 */
export async function injectNetworkLatency(
  proxyName: string,
  latencyMs: number,
  jitterMs: number = 0
): Promise<() => Promise<void>> {
  const client = getToxiproxy();
  const toxicName = `latency_${Date.now()}`;

  await client.addToxic(proxyName, {
    name: toxicName,
    type: "latency",
    stream: "upstream",
    toxicity: 1.0,
    attributes: { latency: latencyMs, jitter: jitterMs },
  });

  return async () => {
    await client.removeToxic(proxyName, toxicName);
  };
}

/**
 * Drop network packets with probability
 */
export async function dropNetworkPackets(
  proxyName: string,
  percent: number
): Promise<() => Promise<void>> {
  const client = getToxiproxy();
  const toxicName = `reset_${Date.now()}`;

  await client.addToxic(proxyName, {
    name: toxicName,
    type: "reset_peer",
    stream: "upstream",
    toxicity: percent / 100,
    attributes: {},
  });

  return async () => {
    await client.removeToxic(proxyName, toxicName);
  };
}

/**
 * Disconnect a service completely
 */
export async function disconnectService(
  proxyName: string
): Promise<() => Promise<void>> {
  const client = getToxiproxy();
  await client.disableProxy(proxyName);

  return async () => {
    await client.enableProxy(proxyName);
  };
}

/**
 * Corrupt a file at a specific offset
 */
export async function corruptFileAtOffset(
  filePath: string,
  offset: number,
  bytes: Buffer
): Promise<{ originalBytes: Buffer; restore: () => void }> {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const content = readFileSync(filePath);
  const originalBytes = Buffer.from(content.subarray(offset, offset + bytes.length));

  // Corrupt the file
  bytes.copy(content, offset);
  writeFileSync(filePath, content);

  return {
    originalBytes,
    restore: () => {
      const current = readFileSync(filePath);
      originalBytes.copy(current, offset);
      writeFileSync(filePath, current);
    },
  };
}

/**
 * Fill disk to a specific percentage
 */
export async function fillDiskToPercent(
  mountPoint: string,
  percent: number,
  options: {
    containerName?: string;
    maxSizeMB?: number;
  } = {}
): Promise<() => Promise<void>> {
  const { containerName, maxSizeMB = 1024 } = options;
  const fillFile = join(mountPoint, ".disk-fill-test");

  if (containerName) {
    // Create fill file inside container
    const sizeToFill = Math.floor((maxSizeMB * percent) / 100);
    await execInContainer(containerName, [
      "dd",
      "if=/dev/zero",
      `of=${fillFile}`,
      "bs=1M",
      `count=${sizeToFill}`,
    ]);

    return async () => {
      await execInContainer(containerName, ["rm", "-f", fillFile]);
    };
  }

  // Local disk fill
  const dir = dirname(fillFile);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const sizeToFill = Math.floor((maxSizeMB * 1024 * 1024 * percent) / 100);
  const buffer = Buffer.alloc(Math.min(sizeToFill, 100 * 1024 * 1024)); // Max 100MB chunks
  writeFileSync(fillFile, buffer);

  return async () => {
    if (existsSync(fillFile)) {
      rmSync(fillFile);
    }
  };
}

/**
 * Simulate Redis disconnection
 */
export async function simulateRedisDisconnect(
  durationMs: number,
  options: {
    proxyName?: string;
    containerName?: string;
  } = {}
): Promise<void> {
  const { proxyName = "redis", containerName } = options;

  if (containerName) {
    await pauseContainer(containerName);
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    await unpauseContainer(containerName);
  } else {
    const client = getToxiproxy();
    await client.disableProxy(proxyName);
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    await client.enableProxy(proxyName);
  }
}

/**
 * Wait for a job to be requeued
 */
export async function waitForJobRequeue(
  jobId: string,
  checkFn: () => Promise<boolean>,
  timeout: number = 30000
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await checkFn()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return false;
}

/**
 * Inject storage timeout using Toxiproxy
 */
export async function injectStorageTimeout(
  proxyName: string,
  timeoutMs: number
): Promise<() => Promise<void>> {
  const client = getToxiproxy();
  const toxicName = `timeout_${Date.now()}`;

  await client.addToxic(proxyName, {
    name: toxicName,
    type: "timeout",
    stream: "upstream",
    toxicity: 1.0,
    attributes: { timeout: timeoutMs },
  });

  return async () => {
    await client.removeToxic(proxyName, toxicName);
  };
}

/**
 * Simulate a split-brain scenario by partitioning workers
 */
export async function simulateSplitBrain(
  groupId: string,
  workers: string[],
  options: {
    networkName?: string;
  } = {}
): Promise<SplitBrainScenario> {
  const { networkName = "test-network" } = options;

  // Split workers into two partitions
  const midpoint = Math.ceil(workers.length / 2);
  const partition1 = workers.slice(0, midpoint);
  const partition2 = workers.slice(midpoint);

  // Disconnect partition2 from the network
  for (const worker of partition2) {
    await disconnectFromNetwork(worker, networkName);
  }

  return {
    groupId,
    partition1,
    partition2,
    async heal(): Promise<void> {
      for (const worker of partition2) {
        await connectToNetwork(worker, networkName);
        await waitForHealthy(worker);
      }
    },
  };
}

/**
 * Kill a worker mid-operation and verify recovery
 */
export async function killWorkerMidOperation(
  worker: ChaosWorker,
  delayMs: number,
  signal: NodeJS.Signals = "SIGKILL"
): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  await worker.kill(signal);
}

/**
 * Simulate database connection drop
 */
export async function simulateDatabaseConnectionDrop(
  proxyName: string,
  durationMs: number
): Promise<void> {
  const client = getToxiproxy();
  await client.disableProxy(proxyName);
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  await client.enableProxy(proxyName);
}

/**
 * Stress test utilities
 */
export const stressTest = {
  /**
   * Generate CPU load
   */
  async generateCPULoad(
    containerName: string,
    cores: number = 1,
    durationSeconds: number = 30
  ): Promise<void> {
    await execInContainer(containerName, [
      "stress",
      "--cpu",
      String(cores),
      "--timeout",
      `${durationSeconds}s`,
    ]);
  },

  /**
   * Generate memory pressure
   */
  async generateMemoryPressure(
    containerName: string,
    memoryMB: number,
    durationSeconds: number = 30
  ): Promise<void> {
    await execInContainer(containerName, [
      "stress",
      "--vm",
      "1",
      "--vm-bytes",
      `${memoryMB}M`,
      "--timeout",
      `${durationSeconds}s`,
    ]);
  },

  /**
   * Generate I/O load
   */
  async generateIOLoad(
    containerName: string,
    workers: number = 1,
    durationSeconds: number = 30
  ): Promise<void> {
    await execInContainer(containerName, [
      "stress",
      "--io",
      String(workers),
      "--timeout",
      `${durationSeconds}s`,
    ]);
  },
};

/**
 * Standard proxy configurations for common services
 */
export const STANDARD_PROXIES: Record<string, ProxyDefinition> = {
  postgres: {
    name: "postgres",
    listen: "0.0.0.0:15432",
    upstream: "postgres:5432",
  },
  mariadb: {
    name: "mariadb",
    listen: "0.0.0.0:13306",
    upstream: "mariadb:3306",
  },
  redis: {
    name: "redis",
    listen: "0.0.0.0:16379",
    upstream: "redis:6379",
  },
  minio: {
    name: "minio",
    listen: "0.0.0.0:19000",
    upstream: "minio:9000",
  },
  sftp: {
    name: "sftp",
    listen: "0.0.0.0:12222",
    upstream: "sftp:2222",
  },
  rest: {
    name: "rest",
    listen: "0.0.0.0:18000",
    upstream: "rest-server:8000",
  },
};

/**
 * Initialize all standard proxies
 */
export async function initializeStandardProxies(): Promise<void> {
  const client = getToxiproxy();

  for (const proxy of Object.values(STANDARD_PROXIES)) {
    const existing = await client.getProxy(proxy.name);
    if (!existing) {
      await client.createProxy(proxy);
    }
  }
}

/**
 * Clean up all chaos artifacts
 */
export async function cleanupChaos(): Promise<void> {
  const client = getToxiproxy();

  try {
    await client.resetAll();
  } catch {
    // Toxiproxy might not be available
  }
}

/**
 * Chaos scenario builder for complex test scenarios
 */
export class ChaosScenario {
  private actions: Array<() => Promise<void>> = [];
  private cleanupActions: Array<() => Promise<void>> = [];

  /**
   * Add a delay
   */
  delay(ms: number): this {
    this.actions.push(() => new Promise((r) => setTimeout(r, ms)));
    return this;
  }

  /**
   * Add network latency
   */
  async addLatency(proxyName: string, ms: number): Promise<this> {
    const cleanup = await injectNetworkLatency(proxyName, ms);
    this.cleanupActions.push(cleanup);
    return this;
  }

  /**
   * Disconnect a service
   */
  disconnect(proxyName: string): this {
    this.actions.push(async () => {
      const cleanup = await disconnectService(proxyName);
      this.cleanupActions.push(cleanup);
    });
    return this;
  }

  /**
   * Pause a container
   */
  pauseContainer(name: string): this {
    this.actions.push(async () => {
      await pauseContainer(name);
      this.cleanupActions.push(() => unpauseContainer(name));
    });
    return this;
  }

  /**
   * Kill a container
   */
  killContainer(name: string, signal: string = "SIGKILL"): this {
    this.actions.push(() => killContainer(name, signal));
    return this;
  }

  /**
   * Execute the scenario
   */
  async execute(): Promise<void> {
    for (const action of this.actions) {
      await action();
    }
  }

  /**
   * Clean up after scenario
   */
  async cleanup(): Promise<void> {
    for (const cleanup of this.cleanupActions.reverse()) {
      try {
        await cleanup();
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
