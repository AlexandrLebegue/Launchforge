# ─────────────────────────────────────────────────────────────────────────────
# LaunchForge — Multi-stage Dockerfile
# Inspired by AlexandrLebegue/domotique_ia
#
# Stages:
#   1. base          — Node 20 Alpine with shared tooling
#   2. client-deps   — Install frontend dependencies
#   3. client-build  — Build Vite/React frontend → client/dist
#   4. server-deps   — Install backend dependencies
#   5. server-build  — Compile TypeScript backend → dist/
#   6. runner        — Minimal production image (no dev deps)
# ─────────────────────────────────────────────────────────────────────────────

# ── 1. Base ──────────────────────────────────────────────────────────────────
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

# ── 2. Client deps ───────────────────────────────────────────────────────────
FROM base AS client-deps
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci --prefer-offline

# ── 3. Client build ──────────────────────────────────────────────────────────
FROM client-deps AS client-build
WORKDIR /app/client
COPY client/ ./
RUN npm run build
# Result: /app/client/dist

# ── 4. Server deps ───────────────────────────────────────────────────────────
FROM base AS server-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --prefer-offline --omit=dev

# ── 5. Server build ──────────────────────────────────────────────────────────
FROM base AS server-build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci --prefer-offline
COPY src/ ./src/
RUN npm run build
# Result: /app/dist

# ── 6. Runner (production) ───────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Non-root user (same pattern as domotique_ia)
RUN addgroup --system --gid 1001 launchforge \
 && adduser  --system --uid 1001 --ingroup launchforge appuser

# Backend: compiled JS + prod node_modules
COPY --from=server-deps   /app/node_modules ./node_modules
COPY --from=server-build  /app/dist         ./dist

# Frontend: pre-built static files served by Express
COPY --from=client-build  /app/client/dist  ./client/dist

# package.json needed by some deps (sql.js wasm lookup etc.)
COPY package.json ./

# Persist SQLite database between restarts
RUN mkdir -p /app/data && chown appuser:launchforge /app/data
VOLUME ["/app/data"]

USER appuser

EXPOSE 3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "dist/index.js"]
