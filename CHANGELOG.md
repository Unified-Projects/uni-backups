# Changelog

All notable changes to Uni-Backups will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-02-27

### Added

- RClone storage backend support with `type: rclone` in storage config
- Inline rclone config via `config` key/value map (injected as `RCLONE_CONFIG_*` env vars at runtime, no rclone.conf required)
- Per-storage restic password fields: `restic_password`, `restic_password_file`, `cache_dir` on all storage types
- New API endpoints: `GET /jobs/config/dirty` and `POST /jobs/config/save`
- "Save to Config" button in Jobs page when in-memory config has unsaved changes (polls dirty flag every 5 seconds)
- "Use source path" shortcut button on Restore page to auto-populate target path from backup source
- Loading spinners on Save, Delete, Run, and Update buttons during pending mutations
- File browser loading overlay with spinner during directory navigation (preserves current listing while fetching)
- `data-testid` attributes on file browser table and breadcrumb for E2E targeting
- `isConfigDirty()` and `saveConfig()` exported from shared config loader
- Integration test suite for rclone storage backend
- E2E `FileBrowserNavigation Isolation` test suite

### Fixed

- Restore download endpoint: properly converts Node.js `ReadableStream` to Web `ReadableStream` via `Readable.toWeb()`
- API no longer returns HTTP 500 when no global restic password is configured; storage-level password is used as fallback
- Archive cleanup delay increased from 1 minute to 5 minutes to accommodate large downloads

### Changed

- `restic.password` renamed to `restic.restic_password` in `backups.yml`
- `restic.password_file` renamed to `restic.restic_password_file` in `backups.yml`
- Repo stats timeout (`REPO_TIMEOUT_MS`) increased from 4 seconds to 150 seconds
- API client fetch timeout increased to 150 seconds via `AbortController`
- Snapshot timestamps now show time of day (`toLocaleString()` instead of `toLocaleDateString()`)
- `rclone` added to Dockerfile installs for API, worker, and test images

## [0.1.2] - 2026-02-26

### Fixed

- Snapshot listing now correctly parses restic JSON array output
- Empty repositories now return empty snapshot list instead of error
- Scheduler now uses unique keys to allow multiple jobs with the same cron pattern
- Fixed job naming consistency (using hyphen instead of colon)
- Job status now correctly shows "completed" in addition to "success"
- Added "pending" status support for scheduled jobs
- File browser now filters out entries with empty names or invalid dates
- Restore page now pre-populates target path from URL parameters

### Added

- E2E test for multiple backup runs accumulating snapshots
- URL pre-population for restore page path parameter

### Changed

- Relaxed chaos test assertion for packet loss scenarios

## [0.1.1] - 2026-02-25

### Fixed

- Jobs now correctly show as "completed" (or "success") instead of always marked as "failed"
- Schedule page now displays job names and error messages in recent runs table
- Workers page now uses configured API URL instead of hardcoded localhost:3001
- Restore page now uses configured API URL instead of hardcoded localhost:3001
- Snapshot browser now displays error messages when file listing fails

## [0.1.0] - 2026-02-17

### Added

- Initial release of Uni-Backups
- Core backup management using restic
- Volume backup support for Docker volumes
- Database backup support (PostgreSQL, MySQL/MariaDB)
- Multi-backend storage support (SFTP, S3-compatible, Azure, GCS, B2, REST)
- Scheduled backup jobs with cron expressions
- Retention policy management (daily, weekly, monthly, yearly)
- Web interface for backup management
- REST API for programmatic access
- Worker service for running backup jobs
- Docker-based development environment
- Turborepo monorepo setup
- Comprehensive test suite (unit, integration, system, e2e, chaos)
- Backup restore functionality
- Backup job history and status tracking

### Docker Images

- `uni-backups-console` - Web interface
- `uni-backups-controller` - API server
- `uni-backups-worker` - Backup worker
