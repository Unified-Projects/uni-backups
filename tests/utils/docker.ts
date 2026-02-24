/**
 * Docker utilities for test infrastructure management
 */

import { exec } from "child_process";
import { promisify } from "util";
import { resolve } from "path";

const execAsync = promisify(exec);

const COMPOSE_FILE = resolve(__dirname, "../compose/services.yml");

export interface DockerComposeOptions {
  projectName?: string;
  services?: string[];
  timeout?: number;
}

/**
 * Start test infrastructure services
 */
export async function startServices(
  options: DockerComposeOptions = {}
): Promise<void> {
  const { projectName = "uni-backups-test", services = [], timeout = 120 } = options;

  const servicesArg = services.length > 0 ? services.join(" ") : "";
  const cmd = `docker compose -f ${COMPOSE_FILE} -p ${projectName} up -d --wait ${servicesArg}`;

  console.log(`Starting test services: ${cmd}`);

  try {
    await execAsync(cmd, { timeout: timeout * 1000 });
    console.log("Test services started successfully");
  } catch (error) {
    console.error("Failed to start test services:", error);
    throw error;
  }
}

/**
 * Stop test infrastructure services
 */
export async function stopServices(
  options: DockerComposeOptions = {}
): Promise<void> {
  const { projectName = "uni-backups-test" } = options;

  const cmd = `docker compose -f ${COMPOSE_FILE} -p ${projectName} down -v --remove-orphans`;

  console.log(`Stopping test services: ${cmd}`);

  try {
    await execAsync(cmd, { timeout: 60000 });
    console.log("Test services stopped successfully");
  } catch (error) {
    console.error("Failed to stop test services:", error);
    // Don't throw - cleanup should be best-effort
  }
}

/**
 * Get logs from a specific service
 */
export async function getServiceLogs(
  service: string,
  options: DockerComposeOptions = {}
): Promise<string> {
  const { projectName = "uni-backups-test" } = options;

  const cmd = `docker compose -f ${COMPOSE_FILE} -p ${projectName} logs ${service}`;

  try {
    const { stdout } = await execAsync(cmd);
    return stdout;
  } catch (error) {
    console.error(`Failed to get logs for ${service}:`, error);
    return "";
  }
}

/**
 * Wait for a service to be healthy
 */
export async function waitForService(
  url: string,
  timeoutMs = 60000,
  pollIntervalMs = 2000
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        console.log(`Service at ${url} is healthy`);
        return;
      }
    } catch {
      // Continue polling
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Service at ${url} did not become healthy within ${timeoutMs}ms`);
}

/**
 * Execute a command inside a container
 */
export async function execInContainer(
  service: string,
  command: string,
  options: DockerComposeOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  const { projectName = "uni-backups-test" } = options;

  const cmd = `docker compose -f ${COMPOSE_FILE} -p ${projectName} exec -T ${service} ${command}`;

  try {
    const result = await execAsync(cmd);
    return result;
  } catch (error: any) {
    return { stdout: error.stdout || "", stderr: error.stderr || "" };
  }
}

/**
 * Copy files from container to host
 */
export async function copyFromContainer(
  service: string,
  containerPath: string,
  hostPath: string,
  options: DockerComposeOptions = {}
): Promise<void> {
  const { projectName = "uni-backups-test" } = options;

  const cmd = `docker compose -f ${COMPOSE_FILE} -p ${projectName} cp ${service}:${containerPath} ${hostPath}`;

  await execAsync(cmd);
}

/**
 * Copy files from host to container
 */
export async function copyToContainer(
  service: string,
  hostPath: string,
  containerPath: string,
  options: DockerComposeOptions = {}
): Promise<void> {
  const { projectName = "uni-backups-test" } = options;

  const cmd = `docker compose -f ${COMPOSE_FILE} -p ${projectName} cp ${hostPath} ${service}:${containerPath}`;

  await execAsync(cmd);
}

/**
 * Check if services are running
 */
export async function areServicesRunning(
  options: DockerComposeOptions = {}
): Promise<boolean> {
  const { projectName = "uni-backups-test" } = options;

  try {
    const cmd = `docker compose -f ${COMPOSE_FILE} -p ${projectName} ps --format json`;
    const { stdout } = await execAsync(cmd);

    if (!stdout.trim()) {
      return false;
    }

    // Parse JSON output (each line is a separate JSON object)
    const containers = stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    return containers.every(
      (c: any) => c.State === "running" || c.State === "exited"
    );
  } catch {
    return false;
  }
}

/**
 * Get the mapped port for a service
 */
export async function getMappedPort(
  service: string,
  containerPort: number,
  options: DockerComposeOptions = {}
): Promise<number> {
  const { projectName = "uni-backups-test" } = options;

  const cmd = `docker compose -f ${COMPOSE_FILE} -p ${projectName} port ${service} ${containerPort}`;

  try {
    const { stdout } = await execAsync(cmd);
    const match = stdout.match(/:(\d+)$/);
    if (match) {
      return parseInt(match[1], 10);
    }
  } catch {
    // Fall through
  }

  throw new Error(`Could not get mapped port for ${service}:${containerPort}`);
}
