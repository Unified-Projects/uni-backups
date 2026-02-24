// Ensure integration-style tests have required secrets without leaking into production
if (!process.env.UNI_BACKUPS_RESTIC_PASSWORD) {
  process.env.UNI_BACKUPS_RESTIC_PASSWORD = "test-password";
}

// Keep Redis isolation predictable during local runs
if (!process.env.REDIS_DB) {
  process.env.REDIS_DB = "15";
}
