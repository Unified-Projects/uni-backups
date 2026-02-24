# API Dockerfile - Uses pnpm for dependency resolution, bun for runtime

# Stage 1: Install dependencies with pnpm
FROM node:22-alpine AS deps
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy all source files needed for workspace resolution
COPY package.json pnpm-workspace.yaml ./
COPY apps/api ./apps/api
COPY packages/shared ./packages/shared
COPY packages/queue ./packages/queue

# Install dependencies (workspace packages become symlinks to local dirs)
RUN pnpm install --ignore-scripts

# Stage 2: Bun runtime base with system dependencies
FROM oven/bun:1 AS base

# Install restic and database clients
RUN apt-get update && apt-get install -y --no-install-recommends \
    restic \
    openssh-client \
    sshpass \
    postgresql-client \
    default-mysql-client \
    redis-tools \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Development stage
FROM base AS dev
WORKDIR /app

# Copy node_modules and source from deps stage
COPY --from=deps /app ./

WORKDIR /app/apps/api
CMD ["bun", "run", "--watch", "src/index.ts"]

# Builder stage
FROM base AS builder
WORKDIR /app

# Copy everything from deps stage (includes node_modules with working symlinks)
COPY --from=deps /app ./

# Build
WORKDIR /app/apps/api
RUN bun build src/index.ts --outdir dist --target bun

# Production stage
FROM base AS production
WORKDIR /app

# Create non-root user
RUN groupadd --gid 1001 appuser && \
    useradd --uid 1001 --gid appuser --shell /bin/bash --create-home appuser

# Copy built files
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages

# Create directories for temp files and cache
RUN mkdir -p /tmp/uni-backups /tmp/restic-cache && \
    chown -R appuser:appuser /tmp/uni-backups /tmp/restic-cache

USER appuser

ENV NODE_ENV=production
ENV UNI_BACKUPS_TEMP_DIR=/tmp/uni-backups
ENV UNI_BACKUPS_RESTIC_CACHE_DIR=/tmp/restic-cache

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

CMD ["bun", "run", "dist/index.js"]
