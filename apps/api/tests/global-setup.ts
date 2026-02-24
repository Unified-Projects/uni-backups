/**
 * Global setup for API integration tests
 * Sets up environment variables and waits for services to be ready
 */

export async function setup() {
  console.log('[Global Setup] Setting up API integration test environment...');

  // Set default environment variables for integration tests
  process.env.REDIS_HOST = process.env.REDIS_HOST || 'localhost';
  process.env.REDIS_PORT = process.env.REDIS_PORT || '6379';
  process.env.REDIS_PASSWORD = process.env.REDIS_PASSWORD || 'testpass123';
  process.env.REDIS_DB = process.env.REDIS_DB || '15';
  process.env.REDIS_KEY_PREFIX = process.env.REDIS_KEY_PREFIX || 'uni-backups:';
  process.env.RESTIC_PASSWORD = process.env.RESTIC_PASSWORD || 'test-password';

  // SFTP test config
  process.env.SFTP_HOST = process.env.SFTP_HOST || 'localhost';
  process.env.SFTP_PORT = process.env.SFTP_PORT || '2222';
  process.env.SFTP_USER = process.env.SFTP_USER || 'user';
  process.env.SFTP_PASSWORD = process.env.SFTP_PASSWORD || 'password';

  // S3/MinIO test config
  process.env.S3_ENDPOINT = process.env.S3_ENDPOINT || 'http://localhost:9000';
  process.env.S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || 'minioadmin';
  process.env.S3_SECRET_KEY = process.env.S3_SECRET_KEY || 'minioadmin';
  process.env.S3_BUCKET = process.env.S3_BUCKET || 'backups';

  // REST server test config
  process.env.REST_SERVER_URL = process.env.REST_SERVER_URL || 'http://localhost:8000';

  // Database test config
  process.env.POSTGRES_HOST = process.env.POSTGRES_HOST || 'localhost';
  process.env.POSTGRES_PORT = process.env.POSTGRES_PORT || '5432';
  process.env.POSTGRES_USER = process.env.POSTGRES_USER || 'testuser';
  process.env.POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD || 'testpass';
  process.env.POSTGRES_DATABASE = process.env.POSTGRES_DATABASE || 'testdb';

  process.env.MARIADB_HOST = process.env.MARIADB_HOST || 'localhost';
  process.env.MARIADB_PORT = process.env.MARIADB_PORT || '3306';
  process.env.MARIADB_USER = process.env.MARIADB_USER || 'testuser';
  process.env.MARIADB_PASSWORD = process.env.MARIADB_PASSWORD || 'testpass';
  process.env.MARIADB_DATABASE = process.env.MARIADB_DATABASE || 'testdb';

  // Local storage for testing
  process.env.LOCAL_BACKUP_PATH = process.env.LOCAL_BACKUP_PATH || '/tmp/uni-backups-test';
  process.env.TEST_DATA_PATH = process.env.TEST_DATA_PATH || '/tmp/uni-backups-test-data';

  console.log('[Global Setup] Environment variables set');
}

export async function teardown() {
  console.log('[Global Teardown] Cleaning up API integration test environment...');
  console.log('[Global Teardown] Done');
}
