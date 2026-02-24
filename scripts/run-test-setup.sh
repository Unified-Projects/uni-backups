#!/bin/bash
# Interactive Test Environment Setup for Uni-Backups
# Starts ALL test infrastructure for manual testing of backup/restore operations

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Config file for full test environment
TEST_CONFIG_FILE="$PROJECT_DIR/config/backups.test-full.yml"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.test-full.yml"

case "${1:-help}" in
    start|up)
        echo -e "${CYAN}"
        echo "========================================================"
        echo "       Uni-Backups Interactive Test Environment         "
        echo "========================================================"
        echo -e "${NC}"

        # Create comprehensive test config
        log_info "Creating comprehensive test configuration..."

        cat > "$TEST_CONFIG_FILE" << 'YAML'
# Full Test Environment Configuration
# Contains jobs for ALL storage types and databases

storage:
  # Local filesystem storage
  local-test:
    type: local
    path: /backups/repos

  # S3/MinIO storage
  s3-test:
    type: s3
    endpoint: http://minio:9000
    bucket: uni-backups-test
    region: us-east-1
    access_key_id: minioadmin
    secret_access_key: minioadmin123
    path: backups

  # SFTP storage
  sftp-test:
    type: sftp
    host: sftp
    port: 2222
    user: testuser
    password: testpass123
    path: /data/backups

  # REST server storage
  rest-test:
    type: rest
    url: http://rest-server:8000
    path: uni-backups

jobs:
  # ============ Folder/Volume Backups ============

  # Local storage backup
  test-local-folder:
    type: folder
    source: /backups/source/local-test
    storage: local-test
    repo: local-folder-backup
    schedule: "*/10 * * * *"
    retention:
      last: 5
      daily: 7
    tags:
      - test
      - local
      - folder

  # S3 storage backup
  test-s3-folder:
    type: folder
    source: /backups/source/s3-test
    storage: s3-test
    repo: s3-folder-backup
    retention:
      last: 5
    tags:
      - test
      - s3
      - folder

  # SFTP storage backup
  test-sftp-folder:
    type: folder
    source: /backups/source/sftp-test
    storage: sftp-test
    repo: sftp-folder-backup
    retention:
      last: 5
    tags:
      - test
      - sftp
      - folder

  # REST server backup
  test-rest-folder:
    type: folder
    source: /backups/source/rest-test
    storage: rest-test
    repo: rest-folder-backup
    retention:
      last: 5
    tags:
      - test
      - rest
      - folder

  # ============ Database Backups ============

  # PostgreSQL backup
  test-postgres:
    type: postgres
    host: postgres
    port: 5432
    database: testdb
    user: testuser
    password: testpass123
    storage: local-test
    repo: postgres-backup
    retention:
      last: 5
      daily: 7
    tags:
      - test
      - postgres
      - database

  # MariaDB backup
  test-mariadb:
    type: mariadb
    host: mariadb
    port: 3306
    database: testdb
    user: testuser
    password: testpass123
    storage: local-test
    repo: mariadb-backup
    retention:
      last: 5
      daily: 7
    tags:
      - test
      - mariadb
      - database

  # Redis backup
  test-redis:
    type: redis
    host: redis
    port: 6379
    password: testpass123
    storage: local-test
    repo: redis-backup
    retention:
      last: 5
    tags:
      - test
      - redis
      - database
YAML

        log_success "Test configuration created: $TEST_CONFIG_FILE"

        # Start test infrastructure first
        log_info "Starting test infrastructure (full profile)..."
        docker compose -f tests/compose/services.yml --profile full up -d --wait || true

        # Verify infrastructure is healthy (init containers may have exited which causes --wait to return non-zero)
        sleep 2
        HEALTHY_COUNT=$(docker compose -f tests/compose/services.yml --profile full ps --format json 2>/dev/null | grep -c '"Health":"healthy"' || echo "0")
        if [ "$HEALTHY_COUNT" -lt 5 ]; then
            log_error "Failed to start test infrastructure (only $HEALTHY_COUNT services healthy)"
            exit 1
        fi
        log_success "Test infrastructure started ($HEALTHY_COUNT services healthy)"

        log_info "Creating test source directories..."
        mkdir -p test-data/source/{local-test,s3-test,sftp-test,rest-test}
        mkdir -p test-data/{repos,temp,cache}

        # Create sample files in each source directory
        for dir in local-test s3-test sftp-test rest-test; do
            echo "Test file for $dir - created at $(date)" > "test-data/source/$dir/test-file.txt"
            echo '{"test": true, "storage": "'$dir'", "timestamp": "'$(date -Iseconds)'"}' > "test-data/source/$dir/config.json"
            mkdir -p "test-data/source/$dir/subdir"
            echo "Nested file content for testing" > "test-data/source/$dir/subdir/nested.txt"
            dd if=/dev/urandom of="test-data/source/$dir/binary-file.bin" bs=1024 count=100 2>/dev/null
        done

        log_success "Sample test data created"

        # Create docker-compose for apps
        log_info "Creating Docker Compose configuration..."

        cat > "$COMPOSE_FILE" << 'COMPOSE'
version: "3.8"

services:
  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes --requirepass testpass123
    expose:
      - "6379"
    networks:
      - test-network
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "testpass123", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
      target: production
    expose:
      - "3001"
    environment:
      - UNI_BACKUPS_URL=http://haproxy
      - UNI_BACKUPS_API_PORT=3001
      - UNI_BACKUPS_RESTIC_PASSWORD=test-password
      - UNI_BACKUPS_CONFIG_FILE=/app/config/backups.test-full.yml
      - UNI_BACKUPS_TEMP_DIR=/tmp/uni-backups
      - UNI_BACKUPS_RESTIC_CACHE_DIR=/tmp/restic-cache
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - REDIS_PASSWORD=testpass123
    volumes:
      - ./config:/app/config:ro
      - ./test-data/source:/backups/source
      - ./test-data/repos:/backups/repos
      - ./test-data/temp:/tmp/uni-backups
      - ./test-data/cache:/tmp/restic-cache
    networks:
      - test-network
    depends_on:
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s

  worker-1:
    build:
      context: .
      dockerfile: apps/worker/Dockerfile
      target: production
    expose:
      - "3002"
    environment:
      - WORKER_ID=worker-1
      - WORKER_NAME=Worker 1
      - WORKER_GROUPS=default
      - WORKER_PORT=3002
      - UNI_BACKUPS_RESTIC_PASSWORD=test-password
      - UNI_BACKUPS_CONFIG_FILE=/app/config/backups.test-full.yml
      - UNI_BACKUPS_TEMP_DIR=/tmp/uni-backups
      - UNI_BACKUPS_RESTIC_CACHE_DIR=/tmp/restic-cache
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - REDIS_PASSWORD=testpass123
    volumes:
      - ./config:/app/config:ro
      - ./test-data/source:/backups/source
      - ./test-data/repos:/backups/repos
      - worker-1-temp:/tmp/uni-backups
      - worker-1-cache:/tmp/restic-cache
    networks:
      - test-network
    depends_on:
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3002/health"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s

  worker-2:
    build:
      context: .
      dockerfile: apps/worker/Dockerfile
      target: production
    expose:
      - "3002"
    environment:
      - WORKER_ID=worker-2
      - WORKER_NAME=Worker 2
      - WORKER_GROUPS=default
      - WORKER_PORT=3002
      - UNI_BACKUPS_RESTIC_PASSWORD=test-password
      - UNI_BACKUPS_CONFIG_FILE=/app/config/backups.test-full.yml
      - UNI_BACKUPS_TEMP_DIR=/tmp/uni-backups
      - UNI_BACKUPS_RESTIC_CACHE_DIR=/tmp/restic-cache
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - REDIS_PASSWORD=testpass123
    volumes:
      - ./config:/app/config:ro
      - ./test-data/source:/backups/source
      - ./test-data/repos:/backups/repos
      - worker-2-temp:/tmp/uni-backups
      - worker-2-cache:/tmp/restic-cache
    networks:
      - test-network
    depends_on:
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3002/health"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
      target: production
      args:
        # Empty = use relative URLs (api.ts paths include /api/ prefix)
        NEXT_PUBLIC_API_URL: ""
    expose:
      - "3000"
    environment:
      - NODE_ENV=production
    networks:
      - test-network
    depends_on:
      api:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://0.0.0.0:3000/"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s

  haproxy:
    image: haproxy:2.9-alpine
    ports:
      - "80:80"
    volumes:
      - ./config/haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg:ro
    networks:
      - test-network
    depends_on:
      api:
        condition: service_healthy
      web:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O /dev/null http://localhost/haproxy-health || exit 1"]
      interval: 5s
      timeout: 5s
      retries: 5

networks:
  test-network:
    name: compose_test-network
    external: true

volumes:
  worker-1-temp:
  worker-1-cache:
  worker-2-temp:
  worker-2-cache:
COMPOSE

        # Build and start apps
        log_info "Building and starting API, Workers, and Web services..."
        docker compose -f "$COMPOSE_FILE" up -d --build

        log_info "Waiting for services to be ready..."

        # Wait for HAProxy (which depends on API and web being healthy)
        for i in {1..90}; do
            if curl -s http://localhost/haproxy-health > /dev/null 2>&1; then
                break
            fi
            echo -n "."
            sleep 2
        done
        echo ""

        # Verify API is accessible through HAProxy
        log_info "Verifying API through HAProxy..."
        for i in {1..30}; do
            if curl -s http://localhost/api/health > /dev/null 2>&1; then
                log_success "API accessible via HAProxy"
                break
            fi
            echo -n "."
            sleep 2
        done
        echo ""

        # Wait for workers to register
        log_info "Waiting for workers to register..."
        sleep 10

        # Print summary
        echo ""
        echo -e "${GREEN}========================================================"
        echo "          Test Environment Ready!                        "
        echo "========================================================${NC}"
        echo ""
        echo -e "${CYAN}Application (via HAProxy on port 80):${NC}"
        echo "  Web Dashboard:      http://localhost/"
        echo "  API Endpoint:       http://localhost/api"
        echo ""
        echo -e "${YELLOW}Test Infrastructure Services:${NC}"
        echo "  MinIO (S3):         http://localhost:9000"
        echo "    Console:          http://localhost:9001"
        echo "    User:             minioadmin"
        echo "    Password:         minioadmin123"
        echo ""
        echo "  SFTP:               localhost:2222"
        echo "    User:             testuser"
        echo "    Password:         testpass123"
        echo ""
        echo "  REST Server:        http://localhost:8000"
        echo ""
        echo "  PostgreSQL:         localhost:5432"
        echo "    User:             testuser"
        echo "    Password:         testpass123"
        echo "    Database:         testdb"
        echo ""
        echo "  PostgreSQL Restore: localhost:5433"
        echo "    Database:         restoredb"
        echo ""
        echo "  MariaDB:            localhost:3306"
        echo "    User:             testuser"
        echo "    Password:         testpass123"
        echo "    Database:         testdb"
        echo ""
        echo "  MariaDB Restore:    localhost:3307"
        echo "    Database:         restoredb"
        echo ""
        echo "  Redis:              localhost:6379"
        echo "    Password:         testpass123"
        echo ""
        echo "  Redis Restore:      localhost:6380"
        echo ""
        echo -e "${YELLOW}Available Test Jobs:${NC}"
        echo "  Folder Backups:"
        echo "    - test-local-folder  (local storage)"
        echo "    - test-s3-folder     (MinIO/S3 storage)"
        echo "    - test-sftp-folder   (SFTP storage)"
        echo "    - test-rest-folder   (REST server storage)"
        echo ""
        echo "  Database Backups:"
        echo "    - test-postgres      (PostgreSQL -> local storage)"
        echo "    - test-mariadb       (MariaDB -> local storage)"
        echo "    - test-redis         (Redis -> local storage)"
        echo ""
        echo -e "${YELLOW}Quick Commands:${NC}"
        echo "  View logs:          $0 logs"
        echo "  View API logs:      $0 logs api"
        echo "  View worker logs:   $0 logs worker-1"
        echo "  Check status:       $0 status"
        echo ""
        echo "  Run a backup job:"
        echo "    curl -X POST http://localhost/api/jobs/test-local-folder/run"
        echo ""
        echo "  List all jobs:"
        echo "    curl http://localhost/api/jobs | jq"
        echo ""
        echo "  Check cluster health:"
        echo "    curl http://localhost/api/cluster/status | jq"
        echo ""
        echo "  Stop environment:   $0 stop"
        echo "  Clean everything:   $0 clean"
        echo ""
        ;;

    stop|down)
        log_info "Stopping test environment..."
        docker compose -f "$COMPOSE_FILE" down 2>/dev/null || true
        docker compose -f tests/compose/services.yml --profile full down 2>/dev/null || true
        log_success "Test environment stopped"
        ;;

    logs)
        if [ -n "$2" ]; then
            docker compose -f "$COMPOSE_FILE" logs -f "$2"
        else
            docker compose -f "$COMPOSE_FILE" logs -f
        fi
        ;;

    status)
        echo -e "${CYAN}Application Services:${NC}"
        docker compose -f "$COMPOSE_FILE" ps 2>/dev/null || echo "App services not running"
        echo ""
        echo -e "${CYAN}Infrastructure Services:${NC}"
        docker compose -f tests/compose/services.yml --profile full ps 2>/dev/null || echo "Infrastructure not running"
        echo ""
        echo -e "${CYAN}HAProxy Health:${NC}"
        curl -s http://localhost/haproxy-health 2>/dev/null || echo "HAProxy not responding"
        echo ""
        echo -e "${CYAN}API Health:${NC}"
        curl -s http://localhost/api/health 2>/dev/null | jq . || echo "API not responding"
        echo ""
        echo -e "${CYAN}Cluster Status:${NC}"
        curl -s http://localhost/api/cluster/status 2>/dev/null | jq . || echo "Cluster status unavailable"
        ;;

    restart)
        log_info "Restarting ${2:-all services}..."
        docker compose -f "$COMPOSE_FILE" restart ${2:-}
        ;;

    clean)
        log_info "Cleaning up test environment..."
        docker compose -f "$COMPOSE_FILE" down -v 2>/dev/null || true
        docker compose -f tests/compose/services.yml --profile full down -v 2>/dev/null || true
        rm -f "$COMPOSE_FILE" 2>/dev/null || true
        rm -f "$TEST_CONFIG_FILE" 2>/dev/null || true
        rm -rf test-data/repos/* test-data/temp/* test-data/cache/* 2>/dev/null || true
        log_success "Test environment cleaned"
        ;;

    help|*)
        echo -e "${CYAN}Uni-Backups Interactive Test Environment${NC}"
        echo ""
        echo "This script sets up a complete test environment with all storage"
        echo "backends (S3, SFTP, REST, local) and databases (PostgreSQL, MariaDB,"
        echo "Redis) for manual testing of backup and restore operations."
        echo ""
        echo "Usage: $0 <command> [args]"
        echo ""
        echo "Commands:"
        echo "  start, up     Start full test environment with all services"
        echo "  stop, down    Stop all test services"
        echo "  restart       Restart services (optional: service name)"
        echo "  logs          View logs (optional: service name)"
        echo "  status        Show service status and health"
        echo "  clean         Stop and remove all test data and volumes"
        echo "  help          Show this help"
        echo ""
        echo "Examples:"
        echo "  $0 start              # Start everything"
        echo "  $0 logs api           # View API logs"
        echo "  $0 logs worker-1      # View Worker 1 logs"
        echo "  $0 status             # Check status"
        echo "  $0 restart api        # Restart API only"
        echo "  $0 clean              # Clean up everything"
        echo ""
        ;;
esac