if (!process.env.UNI_BACKUPS_RESTIC_PASSWORD) {
  process.env.UNI_BACKUPS_RESTIC_PASSWORD = "test-password";
}

// Align BullMQ and Redis clients to the same DB for tests
if (!process.env.REDIS_DB) {
  process.env.REDIS_DB = "15";
}
