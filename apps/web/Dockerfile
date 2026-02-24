# Web Dockerfile - Next.js frontend
FROM node:25-alpine AS base

# Dependencies stage
FROM base AS deps
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files for all workspace packages
COPY package.json pnpm-workspace.yaml turbo.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/ui/package.json ./packages/ui/
COPY packages/shared/package.json ./packages/shared/
COPY packages/queue/package.json ./packages/queue/

# Update pnpm-workspace.yaml to only include our packages
RUN printf 'packages:\n  - "apps/web"\n  - "packages/*"\n' > pnpm-workspace.yaml

# Install dependencies
RUN pnpm install

# Copy source
COPY apps/web ./apps/web
COPY packages/ui ./packages/ui
COPY packages/shared ./packages/shared
COPY packages/queue ./packages/queue

# Development stage
FROM base AS dev
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy node_modules and source from deps stage
COPY --from=deps /app ./

WORKDIR /app/apps/web
CMD ["pnpm", "run", "dev"]

# Builder stage
FROM deps AS builder
WORKDIR /app

# Build arguments for Next.js public environment variables
# Empty string = use relative URLs (paths in api.ts already include /api/ prefix)
ARG NEXT_PUBLIC_API_URL=

# Build with NEXT_PUBLIC env vars available
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
WORKDIR /app/apps/web
RUN pnpm build

# Production stage
FROM base AS production
WORKDIR /app

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy built files
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=10s --start-period=30s --retries=3 \
    CMD wget -q --spider http://0.0.0.0:3000/ || exit 1

CMD ["node", "apps/web/server.js"]
