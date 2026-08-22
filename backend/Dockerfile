# Multi-stage production container for NABIN Backend
FROM node:20-alpine AS base

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source code
COPY src ./src
COPY migrations ./migrations

# Security: Run as non-root user
USER node

# Expose service port
EXPOSE 4000

ENV NODE_ENV=production
ENV PORT=4000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/api/health || exit 1

CMD ["node", "src/server.js"]
