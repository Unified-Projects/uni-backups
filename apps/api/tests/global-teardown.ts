/**
 * Global teardown for integration tests
 * Stops Docker Compose services after all tests complete
 */

import { exec } from "child_process";
import { promisify } from "util";
import { resolve } from "path";

const execAsync = promisify(exec);

const COMPOSE_FILE = resolve(__dirname, "../../../tests/compose/services.yml");
const PROJECT_NAME = "uni-backups-integration-test";

export default async function globalTeardown(): Promise<void> {
  console.log("\n=== Stopping Integration Test Infrastructure ===\n");

  const cmd = `docker compose -f ${COMPOSE_FILE} -p ${PROJECT_NAME} down -v --remove-orphans`;
  console.log(`Running: ${cmd}\n`);

  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: 120000 });
    if (stdout) console.log(stdout);
    if (stderr) console.log(stderr);
  } catch (error: any) {
    // Don't fail teardown - just log the error
    console.error("Warning: Failed to stop Docker services:", error.message);
    if (error.stdout) console.log(error.stdout);
    if (error.stderr) console.error(error.stderr);
  }

  console.log("\n=== Integration Test Infrastructure Stopped ===\n");
}
