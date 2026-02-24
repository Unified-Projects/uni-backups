/**
 * Global Teardown for Chaos Engineering Tests
 *
 * Runs once after all chaos tests to clean up:
 * - Reset all Toxiproxy toxics
 * - Re-enable all proxies
 * - Clean up any temporary files
 */

import { getToxiproxy, cleanupChaos } from "../utils/chaos-helpers";

export async function teardown(): Promise<void> {
  console.log("\n[Chaos Global Teardown] Cleaning up chaos testing infrastructure...\n");

  try {
    // Clean up all chaos artifacts
    await cleanupChaos();
    console.log("[Chaos Global Teardown] All toxics and chaos state reset");
  } catch (error) {
    console.log("[Chaos Global Teardown] Cleanup warning:", error);
  }

  console.log("\n[Chaos Global Teardown] Cleanup complete!\n");
}

export default teardown;
