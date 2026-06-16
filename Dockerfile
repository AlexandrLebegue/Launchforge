# ─────────────────────────────────────────────────────────────────────────────
# LaunchForge — Multi-stage Dockerfile
# Inspired by AlexandrLebegue/domotique_ia
#
# Stages:
#   1. base          — Node 20 Alpine + build tools (needed for better-sqlite3)
#   2. client-deps   — Install frontend dependencies
#   3. client-build  — Build Vite/React frontend → client/dist
#   4. server-deps   — Install & compile backend prod deps (incl. better-sqlite3)
#   5. server-build  — Compile TypeScript backend → dist/
#   6. runner        — Minimal production image (no dev deps, no build tools)
#
# better-sqlite3 is a native Node addon — it needs python3 + make + g++ to
# compile during `npm ci`. The build tools are only in the build stages;
# the final runner image stays lean.
# ─────────────────────────────────────────────────────────────────────────────

# ── 1. Base (shared — includes native build tools) ───────────────────────────
FROM node:20-alpine AS base
# libc6-compat: glibc shim for musl (Alpine); build-base + python3: compile
# better-sqlite3 native addon
RUN apk add --no-cache libc6-compat build-base python3
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
# VITE_ADMIN_EMAILS est lu au BUILD du front (Vite inline les import.meta.env).
# Passé via build-arg en prod pour afficher le lien /admin dans la sidebar.
ARG VITE_ADMIN_EMAILS=""
ENV VITE_ADMIN_EMAILS=$VITE_ADMIN_EMAILS
RUN npm run build
# Result: /app/client/dist

# ── 4. Server deps (prod only — compiles better-sqlite3 native module) ────────
FROM base AS server-deps
WORKDIR /app
COPY package*.json ./
# --omit=dev keeps only production deps in node_modules
RUN npm ci --prefer-offline --omit=dev
# Result: /app/node_modules (includes prebuilt better-sqlite3 .node binary)

# ── 5. Server build (TypeScript → JS) ────────────────────────────────────────
FROM base AS server-build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci --prefer-offline
COPY src/ ./src/
RUN npm run build
# Result: /app/dist

# ── 6. Runner (production — lean, no build tools) ────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

# Runtime-only native libs (better-sqlite3 needs these at runtime on Alpine)
RUN apk add --no-cache libc6-compat

ENV NODE_ENV=production
ENV PORT=3000

# Non-root user (same pattern as domotique_ia)
RUN addgroup --system --gid 1001 launchforge \
 && adduser  --system --uid 1001 --ingroup launchforge appuser

# Backend: compiled JS + prod node_modules (incl. better-sqlite3 .node binary)
COPY --from=server-deps  /app/node_modules ./node_modules
COPY --from=server-build /app/dist         ./dist

# Frontend: pre-built static files served by Express
COPY --from=client-build /app/client/dist  ./client/dist

# package.json needed for module resolution
COPY package.json ./

# Persistent SQLite data directory — mount a volume here
RUN mkdir -p /app/data && chown appuser:launchforge /app/data
VOLUME ["/app/data"]

USER appuser

EXPOSE 3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "dist/index.js"]
