/**
 * Global Setup for Chaos Engineering Tests
 *
 * Runs once before all chaos tests to set up:
 * - Docker network verification
 * - Toxiproxy availability check
 * - Chaos worker container availability
 */

import { getToxiproxy, initializeStandardProxies } from "../utils/chaos-helpers";

export async function setup(): Promise<void> {
  console.log("\n[Chaos Global Setup] Initializing chaos testing infrastructure...\n");

  // Check if running in Docker (chaos tests require Docker)
  const isDocker = process.env.RUNNING_IN_DOCKER === "true";
  const toxiproxyHost = process.env.TOXIPROXY_HOST || (isDocker ? "toxiproxy" : "localhost");
  const toxiproxyPort = parseInt(process.env.TOXIPROXY_PORT || "8474", 10);

  // Verify Toxiproxy is available
  const toxiproxy = getToxiproxy({ host: toxiproxyHost, port: toxiproxyPort });
  const maxRetries = 30;
  let retries = 0;

  while (retries < maxRetries) {
    const available = await toxiproxy.isAvailable();
    if (available) {
      console.log(`[Chaos Global Setup] Toxiproxy is available at ${toxiproxyHost}:${toxiproxyPort}`);
      break;
    }
    retries++;
    console.log(`[Chaos Global Setup] Waiting for Toxiproxy (attempt ${retries}/${maxRetries})...`);
    await new Promise((r) => setTimeout(r, 2000));
  }

  if (retries >= maxRetries) {
    throw new Error(
      `Toxiproxy is not available at ${toxiproxyHost}:${toxiproxyPort}. ` +
      "Please start the chaos infrastructure with: " +
      "docker compose -f tests/compose/services.yml -f tests/compose/chaos-services.yml --profile chaos up -d"
    );
  }

  // Initialize standard proxies
  try {
    await initializeStandardProxies();
    console.log("[Chaos Global Setup] Standard proxies initialized");
  } catch (error) {
    console.log("[Chaos Global Setup] Proxies may already exist, continuing...");
  }

  // Reset all toxics to start fresh
  await toxiproxy.resetAll();
  console.log("[Chaos Global Setup] All toxics reset to clean state");

  console.log("\n[Chaos Global Setup] Chaos testing infrastructure ready!\n");
}

export default setup;
