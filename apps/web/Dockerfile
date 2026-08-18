FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# Next.js's standalone server.js binds to process.env.HOSTNAME, and
# Docker auto-sets HOSTNAME to the container id (not an address) —
# without this override the server only accepts connections addressed
# to that specific container IP, which every other container can still
# reach via the `web` service name, but 127.0.0.1/localhost inside this
# same container (e.g. the healthcheck below) cannot.
ENV HOSTNAME=0.0.0.0
# Non-root (round-6 REVIEW finding, same as apps/api) — Next.js's own
# standalone-output docs use this uid/gid convention. No --chown — the
# server only reads these files at runtime (default COPY perms are
# already world-readable); owning its own code would hand a post-RCE
# attacker write access to persist across the restart: unless-stopped
# policy below (round-7 REVIEW finding, same as apps/api's Dockerfile).
RUN groupadd -r -g 1001 nodejs && useradd -r -g nodejs -u 1001 nextjs
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/scripts/check-secrets.mjs ./scripts/check-secrets.mjs
USER nextjs
EXPOSE 3000
CMD ["sh", "-c", "node scripts/check-secrets.mjs && node server.js"]
