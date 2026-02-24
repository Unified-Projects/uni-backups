/**
 * Per-File Setup for Chaos Engineering Tests
 *
 * Runs before each test file to ensure clean state.
 */

import { beforeEach, afterEach } from "vitest";
import { getToxiproxy } from "../utils/chaos-helpers";

// Reset toxics before each test
beforeEach(async () => {
  try {
    const toxiproxy = getToxiproxy();
    await toxiproxy.resetAll();
  } catch (error) {
    // Toxiproxy might not be available in some test environments
    console.log("[Chaos Setup] Could not reset toxics:", error);
  }
});

afterEach(async () => {
  try {
    const toxiproxy = getToxiproxy();
    await toxiproxy.resetAll();
  } catch (error) {
    // Toxiproxy might not be available in some test environments
  }
});
