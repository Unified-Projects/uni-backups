/**
 * Setup for Data Integrity Tests
 *
 * Configures the environment for thorough data integrity verification.
 */

import { beforeAll } from "vitest";

// Set restic password for integrity tests
beforeAll(() => {
  process.env.UNI_BACKUPS_RESTIC_PASSWORD = process.env.UNI_BACKUPS_RESTIC_PASSWORD || "test-password";
  process.env.RESTIC_PASSWORD = process.env.UNI_BACKUPS_RESTIC_PASSWORD;
});
