# Uni-Backups Deployment Guide

## Quick Start

```bash
# 1. Copy the example config
mkdir -p config
cp config/backups.example.yml config/backups.yml

# 2. Edit config/backups.yml — add your storage and jobs

# 3. Run
docker compose up -d
```

Web UI at `http://localhost`

The restic encryption password is set per-storage in `backups.yml` (see [Restic Password](#restic-password)). A global fallback env var is also supported.

---

## Minimal Docker Compose

Single worker setup for most deployments:

```yaml
services:
  haproxy:
    image: haproxy:2.9-alpine
    ports:
      - "80:80"
    volumes:
      - ./config/haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg:ro
    depends_on:
      web:
        condition: service_started
      api:
        condition: service_healthy
    networks:
      - uni-backups
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost/haproxy-health"]
      interval: 10s
      timeout: 5s
      retries: 3

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis-data:/data
    networks:
      - uni-backups
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  web:
    image: unifiedprojects/uni-backups-web:latest
    environment:
      - NEXT_PUBLIC_API_URL=/api
    depends_on:
      api:
        condition: service_healthy
    networks:
      - uni-backups

  api:
    image: unifiedprojects/uni-backups-api:latest
    environment:
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - UNI_BACKUPS_CONFIG_FILE=/app/config/backups.yml
    volumes:
      - ./config:/app/config:ro
      - /var/lib/docker/volumes:/backups/volumes:ro
      - uni-backups-temp:/tmp/uni-backups
      - uni-backups-cache:/tmp/restic-cache
    depends_on:
      redis:
        condition: service_healthy
    networks:
      - uni-backups
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  worker:
    image: unifiedprojects/uni-backups-worker:latest
    environment:
      - WORKER_ID=worker-1
      - WORKER_NAME=Worker 1
      - WORKER_GROUPS=default
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - UNI_BACKUPS_CONFIG_FILE=/app/config/backups.yml
    volumes:
      - ./config:/app/config:ro
      - /var/lib/docker/volumes:/backups/volumes:ro
      - worker-temp:/tmp/uni-backups
      - worker-cache:/tmp/restic-cache
    depends_on:
      redis:
        condition: service_healthy
    networks:
      - uni-backups
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3002/health"]
      interval: 30s
      timeout: 10s
      retries: 3

networks:
  uni-backups:
    driver: bridge

volumes:
  redis-data:
  uni-backups-temp:
  uni-backups-cache:
  worker-temp:
  worker-cache:
```

---

## Configuration File (backups.yml)

Two top-level sections: `storage` (where backups go) and `jobs` (what to backup).

### Restic Password

Each storage entry holds its own restic encryption password. This is the password restic uses to encrypt/decrypt snapshots in that repository.

```yaml
storage:
  hetzner:
    type: sftp
    host: uXXXXXX.your-storagebox.de
    user: uXXXXXX
    key_file: /run/secrets/storagebox_id_ed25519
    path: /backups
    restic_password_file: /run/secrets/restic_password   # recommended
    # restic_password: plain-text-password               # not recommended
```

If you prefer a single global password across all storage entries, set `UNI_BACKUPS_RESTIC_PASSWORD` in the environment. Per-storage config takes priority over the env var.

---

### Storage Backends

#### Local Filesystem

```yaml
storage:
  local:
    type: local
    path: /backups/local
    restic_password_file: /run/secrets/restic_password
```

Mount a host directory or external drive:
```yaml
volumes:
  - /mnt/external-drive:/backups/local
```

---

#### SFTP (Hetzner Storage Box, any SSH server)

SSH key auth (recommended):
```yaml
storage:
  hetzner:
    type: sftp
    host: uXXXXXX.your-storagebox.de
    user: uXXXXXX
    key_file: /run/secrets/storagebox_id_ed25519
    path: /backups
    restic_password_file: /run/secrets/restic_password
```

Password auth:
```yaml
storage:
  hetzner:
    type: sftp
    host: uXXXXXX.your-storagebox.de
    port: 22
    user: uXXXXXX
    password_file: /run/secrets/storagebox_password
    path: /backups
    restic_password_file: /run/secrets/restic_password
```

---

#### S3 / S3-Compatible (AWS, Hetzner Object Storage, MinIO, Backblaze B2)

```yaml
storage:
  s3-bucket:
    type: s3
    endpoint: https://s3.amazonaws.com              # AWS
    # endpoint: https://fsn1.your-objectstorage.com # Hetzner
    # endpoint: https://s3.us-west-000.backblazeb2.com # Backblaze B2
    bucket: my-backups
    region: us-east-1
    access_key_file: /run/secrets/s3_access_key
    secret_key_file: /run/secrets/s3_secret_key
    path: ""  # optional prefix in bucket
    restic_password_file: /run/secrets/restic_password
```

---

#### REST Server

```yaml
storage:
  rest-server:
    type: rest
    url: https://rest.example.com/my-repo
    user: myuser
    password_file: /run/secrets/rest_password
    restic_password_file: /run/secrets/restic_password
```

No auth:
```yaml
storage:
  rest-server:
    type: rest
    url: http://rest-server:8000
    restic_password_file: /run/secrets/restic_password
```

---

#### RClone (Google Drive, Azure Blob, Dropbox, OneDrive, WebDAV, FTP, and 40+ more)

Requires `rclone` installed in the worker image. Config can be a file or inline key/value pairs.

Config file:
```yaml
storage:
  gdrive:
    type: rclone
    remote: gdrive
    path: restic-backups
    config_file: /run/secrets/rclone.conf
    restic_password_file: /run/secrets/restic_password
```

Inline config (no config file needed):
```yaml
storage:
  b2:
    type: rclone
    remote: b2
    path: my-bucket/backups
    config:
      type: b2
      account: YOUR_ACCOUNT_ID
      key: YOUR_APP_KEY
    restic_password_file: /run/secrets/restic_password
```

The inline config keys map to `RCLONE_CONFIG_<REMOTE>_<KEY>` env vars at runtime. Remote names with hyphens are uppercased and converted to underscores.

---

### Backup Jobs

> **Note:** Jobs created or edited through the web UI are in-memory only. They do not persist to `backups.yml` and will be lost on container restart. Define jobs in `backups.yml` for permanent configuration.

#### Docker Volumes

```yaml
jobs:
  app-data:
    type: volume
    source: /var/lib/docker/volumes/myapp_data/_data
    storage: hetzner
    repo: app-volumes
    schedule: "0 2 * * *"
    retention:
      daily: 7
      weekly: 4
      monthly: 12
    exclude:
      - "*.tmp"
      - "*.log"
    tags:
      - production
```

Finding volume paths:
```bash
docker volume ls
docker volume inspect myapp_data --format '{{ .Mountpoint }}'
# /var/lib/docker/volumes/myapp_data/_data
```

#### Folder Backup

```yaml
jobs:
  configs:
    type: folder
    source: /etc/myapp
    storage: hetzner
    repo: configs
    schedule: "0 */6 * * *"
    retention:
      daily: 7
```

Mount the folder into the worker container:
```yaml
worker:
  volumes:
    - /etc/myapp:/backups/myapp-config:ro
```

Then use `/backups/myapp-config` as source.

#### PostgreSQL

```yaml
jobs:
  postgres-main:
    type: postgres
    host: postgres
    port: 5432
    database: myapp
    user: postgres
    password_file: /run/secrets/pg_password
    storage: hetzner
    repo: databases
    schedule: "0 */4 * * *"
    retention:
      hourly: 6
      daily: 7
      weekly: 4
```

#### MariaDB / MySQL

```yaml
jobs:
  mariadb-main:
    type: mariadb
    host: mariadb
    port: 3306
    database: myapp
    user: root
    password_file: /run/secrets/mysql_password
    storage: hetzner
    repo: databases
    schedule: "0 */4 * * *"
    retention:
      daily: 7
```

#### Redis

```yaml
jobs:
  redis-cache:
    type: redis
    host: redis
    port: 6379
    password_file: /run/secrets/redis_password  # optional
    storage: hetzner
    repo: redis
    schedule: "0 3 * * *"
    retention:
      daily: 7
```

---

## Volume Access

The worker needs read access to whatever you're backing up.

### Docker Volumes

Default mount in docker-compose:
```yaml
volumes:
  - /var/lib/docker/volumes:/backups/volumes:ro
```

This exposes all Docker volumes at `/backups/volumes/<volume-name>/_data`.

In your job config:
```yaml
jobs:
  my-volume:
    type: volume
    source: /backups/volumes/myapp_data/_data
```

### Named Volume Specific Mount

```yaml
worker:
  volumes:
    - myapp_data:/backups/myapp-data:ro
    - another_volume:/backups/another:ro
```

### Host Directories

```yaml
worker:
  volumes:
    - /home/user/documents:/backups/documents:ro
    - /var/log:/backups/logs:ro
```

### Remote NFS/CIFS

Mount on the host first, then pass through:
```bash
mount -t nfs nas:/share /mnt/nas
```

```yaml
worker:
  volumes:
    - /mnt/nas:/backups/nas:ro
```

---

## Schedules (Cron Syntax)

```
┌───────── minute (0-59)
│ ┌─────── hour (0-23)
│ │ ┌───── day of month (1-31)
│ │ │ ┌─── month (1-12)
│ │ │ │ ┌─ day of week (0-6, Sun=0)
│ │ │ │ │
* * * * *
```

Examples:
```yaml
schedule: "0 2 * * *"      # Daily at 2:00 AM
schedule: "0 */4 * * *"    # Every 4 hours
schedule: "30 1 * * 0"     # Sunday at 1:30 AM
schedule: "0 0 1 * *"      # First of month at midnight
schedule: null             # Manual only
```

---

## Retention Policies

```yaml
retention:
  hourly: 6      # Keep last 6 hourly snapshots
  daily: 7       # Keep last 7 daily
  weekly: 4      # Keep last 4 weekly
  monthly: 12    # Keep last 12 monthly
  yearly: 2      # Keep last 2 yearly
```

Restic deduplicates data across snapshots. Multiple jobs can share the same repo.

---

## Secrets Management

### Docker Secrets

```yaml
# docker-compose.yml
secrets:
  restic_password:
    file: ./secrets/restic_password.txt
  pg_password:
    file: ./secrets/pg_password.txt
  storagebox_id_ed25519:
    file: ./secrets/storagebox_id_ed25519

services:
  worker:
    secrets:
      - restic_password
      - pg_password
      - storagebox_id_ed25519
```

In config:
```yaml
storage:
  hetzner:
    key_file: /run/secrets/storagebox_id_ed25519
    restic_password_file: /run/secrets/restic_password

jobs:
  postgres:
    password_file: /run/secrets/pg_password
```

### Environment Variable Fallback

If you don't want per-storage restic passwords, set a global fallback:
```bash
UNI_BACKUPS_RESTIC_PASSWORD=change-this-password
```

Per-storage `restic_password` / `restic_password_file` always takes priority over this env var.

---

## HAProxy Config

`config/haproxy.cfg`:
```
global
    log stdout format raw local0
    maxconn 4096

defaults
    mode http
    log global
    option httplog
    option dontlognull
    option forwardfor
    timeout connect 5s
    timeout client 60s
    timeout server 60s

frontend http_front
    bind *:80

    acl is_haproxy_health path /haproxy-health
    http-request return status 200 content-type text/plain string "OK" if is_haproxy_health

    acl is_api path_beg /api
    use_backend api_backend if is_api

    default_backend web_backend

backend web_backend
    option httpchk GET /
    http-check expect status 200
    server web web:3000 check inter 5s fall 3 rise 2

backend api_backend
    option httpchk
    http-check send meth GET uri /health ver HTTP/1.1 hdr Host api
    http-check expect status 200
    server api api:3001 check inter 5s fall 3 rise 2

```

---

## Building Images for Transfer

Build x86_64 images and package for transfer to a server:

```bash
docker buildx build --platform linux/amd64 -t unifiedprojects/uni-backups-web:latest --target production -f apps/web/Dockerfile .
docker buildx build --platform linux/amd64 -t unifiedprojects/uni-backups-api:latest --target production -f apps/api/Dockerfile .
docker buildx build --platform linux/amd64 -t unifiedprojects/uni-backups-worker:latest --target production -f apps/worker/Dockerfile .

docker save \
  unifiedprojects/uni-backups-web:latest \
  unifiedprojects/uni-backups-api:latest \
  unifiedprojects/uni-backups-worker:latest \
  | gzip > uni-backups-images.tar.gz
```

On the server:
```bash
gunzip -c uni-backups-images.tar.gz | docker load
docker images | grep uni-backups
```

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `UNI_BACKUPS_CONFIG_FILE` | Path to backups.yml | `/app/config/backups.yml` |
| `UNI_BACKUPS_RESTIC_PASSWORD` | Global restic encryption password (fallback — per-storage config takes priority) | — |
| `UNI_BACKUPS_RESTIC_PASSWORD_FILE` | Path to file containing the global restic password | — |
| `UNI_BACKUPS_RESTIC_CACHE_DIR` | Override restic cache directory for all repos | `/tmp/restic-cache` |
| `REDIS_HOST` | Redis hostname | `redis` |
| `REDIS_PORT` | Redis port | `6379` |
| `WORKER_ID` | Unique worker identifier | `worker-1` |
| `WORKER_NAME` | Display name in UI | `Worker 1` |
| `WORKER_GROUPS` | Comma-separated worker groups | `default` |

---

## Troubleshooting

### Check logs
```bash
docker compose logs -f worker
docker compose logs -f api
```

### Test storage connection
Run a manual backup from the UI and check worker logs.

### Permission denied on volumes
Ensure volumes are mounted with `:ro` and the paths exist on the host.

### Restic repo not initialized
First backup to a new repo auto-initializes it. Check worker logs for errors.

### Network issues with SFTP/S3/rclone
The worker needs outbound access on the relevant ports. Check firewall rules and DNS.

### RClone not found
The worker image must have `rclone` installed. Check with `docker exec <worker> rclone version`.
