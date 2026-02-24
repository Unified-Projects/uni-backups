/**
 * Docker Container Helpers
 *
 * Utilities for managing Docker containers during chaos testing.
 * Provides functions to pause, kill, restart, and inspect containers.
 */

import { spawn, exec, ChildProcess } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * Result of executing a command in a container
 */
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Container status information
 */
export interface ContainerStatus {
  id: string;
  name: string;
  state: "running" | "paused" | "exited" | "restarting" | "dead" | "created" | "removing";
  health?: "healthy" | "unhealthy" | "starting" | "none";
  startedAt?: Date;
  exitCode?: number;
}

/**
 * Container resource stats
 */
export interface ContainerStats {
  cpuPercent: number;
  memoryUsage: number;
  memoryLimit: number;
  memoryPercent: number;
  networkRx: number;
  networkTx: number;
}

/**
 * Get the container ID from a container name
 */
export async function getContainerId(name: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      `docker ps -aq --filter "name=${name}" --format "{{.ID}}"`
    );
    const id = stdout.trim();
    return id || null;
  } catch {
    return null;
  }
}

/**
 * Check if a container exists
 */
export async function containerExists(name: string): Promise<boolean> {
  const id = await getContainerId(name);
  return id !== null;
}

/**
 * Check if a container is running
 */
export async function isContainerRunning(name: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync(
      `docker ps -q --filter "name=${name}" --filter "status=running"`
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Get container status
 */
export async function getContainerStatus(name: string): Promise<ContainerStatus | null> {
  try {
    const { stdout } = await execAsync(
      `docker inspect --format '{{json .}}' ${name}`
    );
    const info = JSON.parse(stdout);

    const state = info.State;
    let containerState: ContainerStatus["state"] = "created";

    if (state.Paused) containerState = "paused";
    else if (state.Running) containerState = "running";
    else if (state.Restarting) containerState = "restarting";
    else if (state.Dead) containerState = "dead";
    else if (state.Status === "removing") containerState = "removing";
    else if (state.Status === "exited") containerState = "exited";

    let health: ContainerStatus["health"] = "none";
    if (info.State.Health) {
      health = info.State.Health.Status as ContainerStatus["health"];
    }

    return {
      id: info.Id.substring(0, 12),
      name: info.Name.replace(/^\//, ""),
      state: containerState,
      health,
      startedAt: state.StartedAt ? new Date(state.StartedAt) : undefined,
      exitCode: state.ExitCode,
    };
  } catch {
    return null;
  }
}

/**
 * Pause a running container
 */
export async function pauseContainer(name: string): Promise<void> {
  const running = await isContainerRunning(name);
  if (!running) {
    throw new Error(`Container ${name} is not running`);
  }

  await execAsync(`docker pause ${name}`);
}

/**
 * Unpause a paused container
 */
export async function unpauseContainer(name: string): Promise<void> {
  const status = await getContainerStatus(name);
  if (!status) {
    throw new Error(`Container ${name} not found`);
  }
  if (status.state !== "paused") {
    throw new Error(`Container ${name} is not paused (state: ${status.state})`);
  }

  await execAsync(`docker unpause ${name}`);
}

/**
 * Stop a container
 */
export async function stopContainer(
  name: string,
  timeout: number = 10
): Promise<void> {
  await execAsync(`docker stop -t ${timeout} ${name}`);
}

/**
 * Start a stopped container
 */
export async function startContainer(name: string): Promise<void> {
  await execAsync(`docker start ${name}`);
}

/**
 * Restart a container
 */
export async function restartContainer(
  name: string,
  timeout: number = 10
): Promise<void> {
  await execAsync(`docker restart -t ${timeout} ${name}`);
}

/**
 * Kill a container with a specific signal
 */
export async function killContainer(
  name: string,
  signal: string = "SIGKILL"
): Promise<void> {
  await execAsync(`docker kill --signal=${signal} ${name}`);
}

/**
 * Remove a container
 */
export async function removeContainer(
  name: string,
  options: { force?: boolean; volumes?: boolean } = {}
): Promise<void> {
  const flags: string[] = [];
  if (options.force) flags.push("-f");
  if (options.volumes) flags.push("-v");

  await execAsync(`docker rm ${flags.join(" ")} ${name}`);
}

/**
 * Execute a command in a container
 */
export async function execInContainer(
  name: string,
  command: string[],
  options: {
    user?: string;
    workdir?: string;
    env?: Record<string, string>;
    interactive?: boolean;
  } = {}
): Promise<ExecResult> {
  const flags: string[] = [];

  if (options.user) flags.push(`-u ${options.user}`);
  if (options.workdir) flags.push(`-w ${options.workdir}`);
  if (options.env) {
    for (const [key, value] of Object.entries(options.env)) {
      flags.push(`-e ${key}=${value}`);
    }
  }
  if (options.interactive) flags.push("-it");

  const cmdStr = command.map((c) => `"${c.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(" ");
  const fullCmd = `docker exec ${flags.join(" ")} ${name} ${cmdStr}`;

  try {
    const { stdout, stderr } = await execAsync(fullCmd);
    return { stdout, stderr, exitCode: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout || "",
      stderr: error.stderr || error.message,
      exitCode: error.code || 1,
    };
  }
}

/**
 * Get container logs
 */
export async function getContainerLogs(
  name: string,
  options: {
    tail?: number;
    since?: string;
    until?: string;
    timestamps?: boolean;
  } = {}
): Promise<string> {
  const flags: string[] = [];

  if (options.tail !== undefined) flags.push(`--tail ${options.tail}`);
  if (options.since) flags.push(`--since ${options.since}`);
  if (options.until) flags.push(`--until ${options.until}`);
  if (options.timestamps) flags.push("--timestamps");

  const { stdout, stderr } = await execAsync(
    `docker logs ${flags.join(" ")} ${name} 2>&1`
  );
  return stdout + stderr;
}

/**
 * Wait for container to be healthy
 */
export async function waitForHealthy(
  name: string,
  timeout: number = 60000,
  pollInterval: number = 1000
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const status = await getContainerStatus(name);

    if (!status) {
      return false;
    }

    if (status.state === "running") {
      // If no health check defined, consider running as healthy
      if (status.health === "none" || status.health === "healthy") {
        return true;
      }
    }

    if (status.state === "exited" || status.state === "dead") {
      return false;
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  return false;
}

/**
 * Wait for container to stop
 */
export async function waitForStopped(
  name: string,
  timeout: number = 30000,
  pollInterval: number = 500
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const running = await isContainerRunning(name);
    if (!running) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  return false;
}

/**
 * Get container resource statistics
 */
export async function getContainerStats(name: string): Promise<ContainerStats | null> {
  try {
    const { stdout } = await execAsync(
      `docker stats --no-stream --format "{{json .}}" ${name}`
    );
    const stats = JSON.parse(stdout);

    const cpuPercent = parseFloat(stats.CPUPerc?.replace("%", "") || "0");

    // Parse memory usage (e.g., "100MiB / 1GiB")
    const memParts = stats.MemUsage?.split(" / ") || ["0", "0"];
    const memoryUsage = parseMemory(memParts[0]);
    const memoryLimit = parseMemory(memParts[1]);
    const memoryPercent = parseFloat(stats.MemPerc?.replace("%", "") || "0");

    const netParts = stats.NetIO?.split(" / ") || ["0", "0"];
    const networkRx = parseMemory(netParts[0]);
    const networkTx = parseMemory(netParts[1]);

    return {
      cpuPercent,
      memoryUsage,
      memoryLimit,
      memoryPercent,
      networkRx,
      networkTx,
    };
  } catch {
    return null;
  }
}

/**
 * Parse memory string to bytes
 */
function parseMemory(str: string): number {
  const match = str.match(/^([\d.]+)\s*(B|KiB|MiB|GiB|KB|MB|GB)?$/i);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = (match[2] || "B").toUpperCase();

  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1000,
    KIB: 1024,
    MB: 1000 * 1000,
    MIB: 1024 * 1024,
    GB: 1000 * 1000 * 1000,
    GIB: 1024 * 1024 * 1024,
  };

  return value * (multipliers[unit] || 1);
}

/**
 * List containers matching a filter
 */
export async function listContainers(
  filter?: {
    name?: string;
    status?: string;
    label?: string;
  }
): Promise<ContainerStatus[]> {
  const filters: string[] = [];

  if (filter?.name) filters.push(`--filter "name=${filter.name}"`);
  if (filter?.status) filters.push(`--filter "status=${filter.status}"`);
  if (filter?.label) filters.push(`--filter "label=${filter.label}"`);

  const { stdout } = await execAsync(
    `docker ps -a ${filters.join(" ")} --format "{{.Names}}"`
  );

  const names = stdout.trim().split("\n").filter(Boolean);
  const statuses: ContainerStatus[] = [];

  for (const name of names) {
    const status = await getContainerStatus(name);
    if (status) {
      statuses.push(status);
    }
  }

  return statuses;
}

/**
 * Copy files to/from container
 */
export async function copyToContainer(
  name: string,
  srcPath: string,
  destPath: string
): Promise<void> {
  await execAsync(`docker cp ${srcPath} ${name}:${destPath}`);
}

export async function copyFromContainer(
  name: string,
  srcPath: string,
  destPath: string
): Promise<void> {
  await execAsync(`docker cp ${name}:${srcPath} ${destPath}`);
}

/**
 * Create a network partition by disconnecting a container
 */
export async function disconnectFromNetwork(
  containerName: string,
  networkName: string
): Promise<void> {
  await execAsync(`docker network disconnect ${networkName} ${containerName}`);
}

/**
 * Reconnect a container to a network
 */
export async function connectToNetwork(
  containerName: string,
  networkName: string
): Promise<void> {
  await execAsync(`docker network connect ${networkName} ${containerName}`);
}

/**
 * Get networks a container is connected to
 */
export async function getContainerNetworks(name: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      `docker inspect --format '{{json .NetworkSettings.Networks}}' ${name}`
    );
    const networks = JSON.parse(stdout);
    return Object.keys(networks);
  } catch {
    return [];
  }
}

/**
 * Simulate OOM kill by setting memory limit and then using memory
 */
export async function simulateOOMKill(
  containerName: string,
  memoryLimitMB: number = 64
): Promise<void> {
  // First update the container's memory limit
  await execAsync(`docker update --memory=${memoryLimitMB}m ${containerName}`);

  // Then execute a command that uses all available memory
  try {
    await execInContainer(containerName, [
      "sh",
      "-c",
      "dd if=/dev/zero of=/dev/null bs=1M &",
    ]);
  } catch {
    // Container may have been killed
  }
}

/**
 * Stress test a container's resources
 */
export async function stressContainer(
  name: string,
  options: {
    cpu?: number; // Number of CPU workers
    memory?: string; // Memory to allocate (e.g., "256M")
    duration?: number; // Duration in seconds
  } = {}
): Promise<ChildProcess> {
  const { cpu = 1, memory = "64M", duration = 60 } = options;

  const command = [
    "stress",
    "--cpu",
    String(cpu),
    "--vm",
    "1",
    "--vm-bytes",
    memory,
    "--timeout",
    `${duration}s`,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn("docker", ["exec", name, ...command], {
      stdio: "ignore",
      detached: true,
    });

    proc.on("error", reject);
    proc.unref();
    resolve(proc);
  });
}

/**
 * Wait for a specific log message in a container
 */
export async function waitForLogMessage(
  name: string,
  pattern: string | RegExp,
  timeout: number = 30000
): Promise<boolean> {
  const startTime = Date.now();
  const regex = typeof pattern === "string" ? new RegExp(pattern) : pattern;

  while (Date.now() - startTime < timeout) {
    const logs = await getContainerLogs(name, { tail: 100 });
    if (regex.test(logs)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return false;
}

/**
 * Get the IP address of a container
 */
export async function getContainerIP(
  name: string,
  network?: string
): Promise<string | null> {
  try {
    const networkName = network || "bridge";
    const { stdout } = await execAsync(
      `docker inspect --format '{{.NetworkSettings.Networks.${networkName}.IPAddress}}' ${name}`
    );
    const ip = stdout.trim();
    return ip || null;
  } catch {
    return null;
  }
}

/**
 * Docker Compose helpers
 */
export const compose = {
  /**
   * Start services defined in a compose file
   */
  async up(
    composeFile: string,
    options: {
      services?: string[];
      profile?: string;
      build?: boolean;
      detach?: boolean;
      wait?: boolean;
    } = {}
  ): Promise<void> {
    const flags: string[] = ["-f", composeFile];
    if (options.profile) flags.push("--profile", options.profile);

    const upFlags: string[] = [];
    if (options.build) upFlags.push("--build");
    if (options.detach) upFlags.push("-d");
    if (options.wait) upFlags.push("--wait");

    const services = options.services?.join(" ") || "";

    await execAsync(
      `docker compose ${flags.join(" ")} up ${upFlags.join(" ")} ${services}`
    );
  },

  /**
   * Stop and remove services
   */
  async down(
    composeFile: string,
    options: {
      volumes?: boolean;
      profile?: string;
    } = {}
  ): Promise<void> {
    const flags: string[] = ["-f", composeFile];
    if (options.profile) flags.push("--profile", options.profile);

    const downFlags: string[] = [];
    if (options.volumes) downFlags.push("-v");

    await execAsync(
      `docker compose ${flags.join(" ")} down ${downFlags.join(" ")}`
    );
  },

  /**
   * Restart a specific service
   */
  async restart(composeFile: string, service: string): Promise<void> {
    await execAsync(`docker compose -f ${composeFile} restart ${service}`);
  },

  /**
   * Execute a command in a service
   */
  async exec(
    composeFile: string,
    service: string,
    command: string[]
  ): Promise<ExecResult> {
    const cmdStr = command.map((c) => `"${c.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(" ");

    try {
      const { stdout, stderr } = await execAsync(
        `docker compose -f ${composeFile} exec -T ${service} ${cmdStr}`
      );
      return { stdout, stderr, exitCode: 0 };
    } catch (error: any) {
      return {
        stdout: error.stdout || "",
        stderr: error.stderr || error.message,
        exitCode: error.code || 1,
      };
    }
  },

  /**
   * Get logs for a service
   */
  async logs(
    composeFile: string,
    service: string,
    options: { tail?: number } = {}
  ): Promise<string> {
    const flags: string[] = [];
    if (options.tail) flags.push(`--tail=${options.tail}`);

    const { stdout, stderr } = await execAsync(
      `docker compose -f ${composeFile} logs ${flags.join(" ")} ${service}`
    );
    return stdout + stderr;
  },
};
