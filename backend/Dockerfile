# Multi-stage production container for NABIN Backend
# Build context is the repository root (dockerContext in render.yaml).
FROM node:22-alpine AS base

WORKDIR /app

# Install dependencies
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

# Copy source code and the canonical migration set
COPY backend/src ./backend/src
COPY backend/scripts ./backend/scripts
COPY supabase/migrations ./supabase/migrations

# Security: Run as non-root user
USER node

WORKDIR /app/backend

# Expose service port
EXPOSE 4000

ENV NODE_ENV=production
ENV PORT=4000
ENV MIGRATIONS_DIR=/app/supabase/migrations

# Healthcheck probes readiness (503 while PostgreSQL is unreachable), not liveness.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/api/ready || exit 1

# Fail closed: if the schema is not fully applied the process must not serve traffic.
CMD ["sh", "-c", "node scripts/migrate.js && node src/server.js"]
