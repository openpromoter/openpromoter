# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.34.6 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/app/package.json apps/app/
COPY packages/db/package.json packages/db/
COPY packages/ui/package.json packages/ui/
COPY packages/emails/package.json packages/emails/
COPY packages/sdk/package.json packages/sdk/
COPY packages/mcp/package.json packages/mcp/
COPY packages/cli/package.json packages/cli/
RUN pnpm install --frozen-lockfile --filter @openpromoter/app...

FROM deps AS build
COPY . .
# build-only placeholders: modules are imported during `next build`, nothing connects
ENV NEXT_TELEMETRY_DISABLED=1 DATABASE_URL=postgres://build:build@127.0.0.1:1/build BETTER_AUTH_SECRET=build-only-placeholder
RUN pnpm --filter @openpromoter/app build \
 && pnpm --filter @openpromoter/app exec esbuild scripts/docker-start.ts --bundle --platform=node --format=esm --target=node22 \
      --outfile=/repo/start.mjs --external:../server.js \
      --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 MIGRATIONS_DIR=/app/drizzle
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /repo/apps/app/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/app/.next/static ./apps/app/.next/static
COPY --from=build --chown=app:app /repo/apps/app/public ./apps/app/public
COPY --from=build --chown=app:app /repo/packages/db/drizzle ./drizzle
COPY --from=build --chown=app:app /repo/start.mjs ./apps/app/scripts/start.mjs
USER app
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=40s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
WORKDIR /app/apps/app
CMD ["node", "scripts/start.mjs"]
