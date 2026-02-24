#!/bin/bash
#
# Uni-Backups Test Runner
# Runs all test suites with proper infrastructure management
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

show_help() {
    cat << EOF
Uni-Backups Test Runner

Usage: ./run-tests.sh [OPTIONS] [TEST_SUITE]

Options:
    -h, --help              Show this help message
    -u, --unit              Run unit tests only
    -i, --integration       Run integration tests only
    -s, --system            Run system tests only
    -c, --chaos             Run chaos tests only (requires Docker)
    -e, --e2e               Run E2E tests only
    -a, --all               Run all tests (default)
    --coverage              Generate coverage reports
    --ci                    CI mode (exit on failure, no interactive prompts)
    --setup                 Start test infrastructure only
    --teardown              Stop test infrastructure only
    --restart               Restart test infrastructure

Test Suites:
    unit                    Unit tests (packages/shared, packages/queue)
    integration             Integration tests (apps/api, apps/worker)
    system                  System tests (failover, concurrent, retention)
    chaos                   Chaos tests (network partition, resource exhaustion)
    e2e                     End-to-end tests (web UI)
    full                    Full test suite with infrastructure

Examples:
    ./run-tests.sh                      # Run all tests
    ./run-tests.sh --unit               # Run only unit tests
    ./run-tests.sh --setup --system --teardown  # Run system tests with infra
    ./run-tests.sh --ci --all           # CI mode: run all tests

EOF
}

# Parse arguments
CI_MODE=false
RUN_COVERAGE=false
TEST_SUITE="all"

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        -u|--unit)
            TEST_SUITE="unit"
            shift
            ;;
        -i|--integration)
            TEST_SUITE="integration"
            shift
            ;;
        -s|--system)
            TEST_SUITE="system"
            shift
            ;;
        -c|--chaos)
            TEST_SUITE="chaos"
            shift
            ;;
        -e|--e2e)
            TEST_SUITE="e2e"
            shift
            ;;
        -a|--all)
            TEST_SUITE="all"
            shift
            ;;
        --coverage)
            RUN_COVERAGE=true
            shift
            ;;
        --ci)
            CI_MODE=true
            shift
            ;;
        --setup)
            TEST_SUITE="setup"
            shift
            ;;
        --teardown)
            TEST_SUITE="teardown"
            shift
            ;;
        --restart)
            TEST_SUITE="restart"
            shift
            ;;
        *)
            log_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Check dependencies
check_dependencies() {
    log_info "Checking dependencies..."

    if ! command -v pnpm &> /dev/null; then
        log_error "pnpm is not installed. Please install pnpm first."
        exit 1
    fi

    if ! command -v docker &> /dev/null; then
        log_warn "Docker is not installed. Some tests may fail."
    fi

    log_success "Dependencies check passed"
}

cleanup_artifacts() {
    log_info "Cleaning up previous test artifacts..."
    rm -rf test-results/*
    rm -rf test-data/temp/*
    rm -rf test-data/cache/*
    rm -rf test-data/repos/*
    log_success "Test artifacts cleaned"
}

cleanup_test_data() {
    log_info "Cleaning up test data between suites (repos, temp)..."
    rm -rf test-data/repos/*
    rm -rf test-data/temp/*
    log_success "Test data cleaned"
}

# Setup test infrastructure
setup_infrastructure() {
    log_info "Setting up test infrastructure..."

    if ! command -v docker &> /dev/null; then
        log_error "Docker is required for infrastructure setup"
        return 1
    fi

    # Create necessary directories
    mkdir -p tests/compose

    # Start core services first (these have health checks)
    log_info "Starting core services..."
    docker compose -f tests/compose/docker-compose.yml up -d \
        redis redis-restore \
        minio rest-server sftp \
        postgres postgres-restore \
        mariadb mariadb-restore \
        --wait

    # Run init containers (these exit after completing)
    log_info "Running initialization containers..."
    docker compose -f tests/compose/docker-compose.yml up -d \
        redis-data-init redis-restore-data-init redis-init minio-init || true

    # Wait for init containers to complete and databases to fully initialize
    log_info "Waiting for services to be ready..."
    sleep 10

    log_success "Infrastructure setup complete"
    log_info "Services running:"
    docker compose -f tests/compose/docker-compose.yml ps
}

# Teardown test infrastructure
teardown_infrastructure() {
    log_info "Tearing down test infrastructure..."

    # Tear down chaos services first (if running) - include both chaos and chaos-workers profiles
    docker compose -f tests/compose/docker-compose.yml -f tests/compose/chaos-services.yml --profile chaos --profile chaos-workers down -v 2>/dev/null || true
    # Tear down core services
    docker compose -f tests/compose/docker-compose.yml down -v 2>/dev/null || true

    log_success "Infrastructure teardown complete"
}

# Restart infrastructure
restart_infrastructure() {
    teardown_infrastructure
    setup_infrastructure
}

# Run unit tests
run_unit_tests() {
    log_info "Running unit tests..."

    if [[ "$RUN_COVERAGE" == true ]]; then
        pnpm test:unit -- --coverage
    else
        pnpm test:unit
    fi

    log_success "Unit tests completed"
}

# Run integration tests
run_integration_tests() {
    log_info "Running integration tests..."

    if ! command -v docker &> /dev/null; then
        log_error "Docker is required for integration tests"
        exit 1
    fi

    # Ensure infrastructure is running (idempotent - won't restart if already running)
    setup_infrastructure

    # Build and run test-runner container for integration tests
    log_info "Running integration tests in Docker container..."
    docker compose -f tests/compose/docker-compose.yml build test-runner

    # Run integration tests in the test-runner container
    docker compose -f tests/compose/docker-compose.yml run --rm test-runner pnpm -C apps/api test:integration

    log_success "Integration tests completed"
}

# Run system tests
run_system_tests() {
    log_info "Running system tests..."

    if ! command -v docker &> /dev/null; then
        log_error "Docker is required for system tests"
        exit 1
    fi

    # Ensure infrastructure is running
    setup_infrastructure

    # Build shared package first (required for test imports)
    log_info "Building shared package..."
    pnpm --filter @uni-backups/shared build

    # Build test-runner if needed
    docker compose -f tests/compose/docker-compose.yml build test-runner

    # Run system tests in the test-runner container
    docker compose -f tests/compose/docker-compose.yml run --rm test-runner pnpm test:system

    log_success "System tests completed"
}

# Run chaos tests
run_chaos_tests() {
    log_info "Running chaos tests..."

    if ! command -v docker &> /dev/null; then
        log_error "Docker is required for chaos tests"
        exit 1
    fi

    # Ensure infrastructure is running first
    setup_infrastructure

    # Start chaos services (Toxiproxy infrastructure only, not the test runner)
    # Use --profile chaos to start toxiproxy without chaos-test-runner
    # (chaos-test-runner has its own vitest command that would conflict with our run below)
    # Note: no --wait here because toxiproxy-setup is an init container that exits after
    # configuring proxies, and --wait fails on exited services. The chaos global-setup.ts
    # has its own retry logic to wait for toxiproxy availability.
    log_info "Starting chaos services (toxiproxy)..."
    docker compose -f tests/compose/docker-compose.yml -f tests/compose/chaos-services.yml --profile chaos up -d
    # Give toxiproxy a moment to start before the test runner tries to connect
    sleep 3

    # Build and start chaos worker containers (needed for worker-failure chaos tests)
    # Note: chaos workers have no depends_on (redis is already running from setup_infrastructure)
    log_info "Building and starting chaos workers..."
    docker compose -f tests/compose/docker-compose.yml -f tests/compose/chaos-services.yml --profile chaos-workers up -d --build --wait

    # Verify chaos workers are actually running and healthy
    log_info "Verifying chaos workers are healthy..."
    for i in {1..30}; do
        WORKERS_HEALTHY=$(docker compose -f tests/compose/docker-compose.yml -f tests/compose/chaos-services.yml ps --format json 2>/dev/null | jq -s '[.[] | select(.Service | startswith("chaos-worker")) | select(.Health == "healthy")] | length' 2>/dev/null || echo "0")
        if [ "$WORKERS_HEALTHY" -ge 3 ]; then
            log_info "All chaos workers are healthy"
            break
        fi
        if [ $i -eq 30 ]; then
            log_error "Chaos workers failed to become healthy"
            docker compose -f tests/compose/docker-compose.yml -f tests/compose/chaos-services.yml --profile chaos-workers logs
        fi
        sleep 2
    done

    # Run chaos tests using test-runner with toxiproxy-routed connections
    # Override service hosts/ports to route through toxiproxy proxies
    log_info "Running chaos tests..."
    docker compose -f tests/compose/docker-compose.yml -f tests/compose/chaos-services.yml --profile test run --rm --build \
        -v /var/run/docker.sock:/var/run/docker.sock \
        -e TOXIPROXY_HOST=toxiproxy \
        -e TOXIPROXY_PORT=8474 \
        -e REDIS_HOST=toxiproxy \
        -e REDIS_PORT=16379 \
        -e POSTGRES_HOST=toxiproxy \
        -e POSTGRES_PORT=15432 \
        -e MARIADB_HOST=toxiproxy \
        -e MARIADB_PORT=13306 \
        -e MINIO_ENDPOINT=toxiproxy:19000 \
        -e REST_SERVER_URL=http://toxiproxy:18000 \
        -e SFTP_HOST=toxiproxy \
        -e SFTP_PORT=12222 \
        -e TEST_TYPE=chaos \
        test-runner \
        pnpm vitest run --config tests/vitest.chaos.config.ts

    log_success "Chaos tests completed"
}

# Run E2E tests
run_e2e_tests() {
    log_info "Running E2E tests..."

    if ! command -v docker &> /dev/null; then
        log_error "Docker is required for E2E tests"
        exit 1
    fi

    # Ensure infrastructure is running
    setup_infrastructure

    # Build and run test-runner for E2E tests
    docker compose -f tests/compose/docker-compose.yml build test-runner

    # Run E2E tests in Docker with servers started
    # The command starts API, Web, and Worker, waits for them, then runs Playwright
    docker compose -f tests/compose/docker-compose.yml run --rm \
        -e UNI_BACKUPS_CONFIG_FILE=/app/config/backups.test-full.yml \
        -e UNI_BACKUPS_CORS_ORIGINS=http://localhost:3000 \
        test-runner bash -c "
        set -e

        echo 'Flushing stale worker state from Redis...'
        redis-cli -h redis -p 6379 -a testpass123 KEYS 'uni-backups:workers:*' 2>/dev/null | xargs -r redis-cli -h redis -p 6379 -a testpass123 DEL 2>/dev/null || true
        redis-cli -h redis -p 6379 -a testpass123 KEYS 'uni-backups:worker_groups:*' 2>/dev/null | xargs -r redis-cli -h redis -p 6379 -a testpass123 DEL 2>/dev/null || true
        redis-cli -h redis -p 6379 -a testpass123 KEYS 'uni-backups:jobs:history:*' 2>/dev/null | xargs -r redis-cli -h redis -p 6379 -a testpass123 DEL 2>/dev/null || true
        redis-cli -h redis -p 6379 -a testpass123 DEL 'uni-backups:jobs:history:all' 2>/dev/null || true
        redis-cli -h redis -p 6379 -a testpass123 KEYS 'bull:*' 2>/dev/null | xargs -r redis-cli -h redis -p 6379 -a testpass123 DEL 2>/dev/null || true

        echo 'Creating source directories for folder backup jobs...'
        mkdir -p /backups/source/local-test /backups/source/s3-test /backups/source/sftp-test /backups/source/rest-test
        mkdir -p /backups/repos
        echo 'test-data' > /backups/source/local-test/test-file.txt
        echo 'test-data' > /backups/source/s3-test/test-file.txt
        echo 'test-data' > /backups/source/sftp-test/test-file.txt
        echo 'test-data' > /backups/source/rest-test/test-file.txt

        echo 'Starting API server...'
        pnpm --filter @uni-backups/api start &
        API_PID=\$!

        echo 'Starting Web server...'
        cp -r /app/apps/web/.next/static /app/apps/web/.next/standalone/apps/web/.next/static 2>/dev/null || true
        cp -r /app/apps/web/public /app/apps/web/.next/standalone/apps/web/public 2>/dev/null || true
        PORT=3000 HOSTNAME=0.0.0.0 node /app/apps/web/.next/standalone/apps/web/server.js &
        WEB_PID=\$!

        echo 'Starting Worker...'
        pnpm --filter @uni-backups/worker start &
        WORKER_PID=\$!

        echo 'Waiting for servers to be ready...'
        for i in {1..30}; do
            if curl -s http://localhost:3001/health > /dev/null 2>&1 && curl -s http://localhost:3000 > /dev/null 2>&1; then
                echo 'Servers are ready!'
                break
            fi
            if [ \$i -eq 30 ]; then
                echo 'Servers failed to start in time'
                kill \$API_PID \$WEB_PID \$WORKER_PID 2>/dev/null || true
                exit 1
            fi
            sleep 2
        done

        echo 'Waiting for worker to register...'
        for i in {1..30}; do
            WORKER_RESP=\$(curl -s http://localhost:3001/api/workers 2>/dev/null || echo '{}')
            if echo "\$WORKER_RESP" | grep -q '"id"'; then
                echo 'Worker is ready'
                break
            fi
            if [ \$i -eq 30 ]; then
                echo 'Warning: worker not confirmed ready after 60s, proceeding anyway'
            fi
            sleep 2
        done

        echo 'Pre-running test-redis backup to ensure snapshots exist for restore tests...'
        curl -s -X POST http://localhost:3001/api/jobs/test-redis/run -H 'Content-Type: application/json' -d '{}' || true
        sleep 30
        echo 'Pre-run backup wait complete.'

        echo 'Running E2E tests...'
        TEST_BASE_URL=http://localhost:3000 TEST_API_URL=http://localhost:3001 CI=true pnpm --filter @uni-backups/web test:e2e
        TEST_EXIT_CODE=\$?

        echo 'Stopping servers...'
        kill \$API_PID \$WEB_PID \$WORKER_PID 2>/dev/null || true

        exit \$TEST_EXIT_CODE
    "

    log_success "E2E tests completed"
}

# Main execution
main() {
    echo ""
    echo "========================================"
    echo "  Uni-Backups Test Runner"
    echo "========================================"
    echo ""

    check_dependencies
    cleanup_artifacts

    # Handle infrastructure commands
    case $TEST_SUITE in
        setup)
            setup_infrastructure
            exit 0
            ;;
        teardown)
            teardown_infrastructure
            exit 0
            ;;
        restart)
            restart_infrastructure
            exit 0
            ;;
    esac

    # Run tests based on suite
    case $TEST_SUITE in
        unit)
            run_unit_tests
            ;;
        integration)
            run_integration_tests
            ;;
        system)
            run_system_tests
            ;;
        chaos)
            run_chaos_tests
            ;;
        e2e)
            run_e2e_tests
            ;;
        all)
            log_info "Running full test suite..."

            setup_infrastructure

            run_unit_tests

            cleanup_test_data

            run_e2e_tests

            run_integration_tests
            run_system_tests
            run_chaos_tests

            log_success "All tests completed!"
            ;;
    esac

    if [[ "$RUN_COVERAGE" == true ]]; then
        echo ""
        echo "========================================"
        echo "  Coverage Reports"
        echo "========================================"
        echo ""
        log_info "Generating coverage reports..."

        # Show coverage summary
        find . -name "coverage-summary.json" -exec cat {} \; 2>/dev/null | head -100 || true

        log_info "Coverage reports generated in ./coverage directories"
    fi

    echo ""
    log_success "Test run complete!"
}

# Trap for cleanup - only teardown if not already done by error handler
TEARDOWN_DONE=false
cleanup_on_error() {
    local exit_code=$?
    if [[ $exit_code -ne 0 && "$TEARDOWN_DONE" == "false" ]]; then
        log_info "Tests failed with exit code $exit_code, tearing down infrastructure..."
        teardown_infrastructure
        TEARDOWN_DONE=true
    fi
    exit $exit_code
}

cleanup_on_exit() {
    if [[ "$TEARDOWN_DONE" == "false" ]]; then
        teardown_infrastructure
    fi
}

trap 'cleanup_on_error' ERR
trap 'cleanup_on_exit' EXIT

# Run main
main
