# Changelog

All notable changes to Uni-Backups will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
