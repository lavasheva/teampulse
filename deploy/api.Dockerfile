FROM node:24-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

FROM base AS build
RUN npm install -g pnpm@10.17.1
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/analytics/package.json packages/analytics/package.json
RUN pnpm --filter @teampulse/api... install --frozen-lockfile
COPY apps/api/tsconfig.json apps/api/tsconfig.json
COPY apps/api/prisma apps/api/prisma
COPY apps/api/src apps/api/src
COPY packages/shared/src packages/shared/src
COPY packages/analytics/src packages/analytics/src
COPY packages/analytics/tsconfig.json packages/analytics/tsconfig.json
RUN pnpm --filter @teampulse/api db:generate && pnpm --filter @teampulse/api build

FROM base AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app/apps/api
# Prisma CLI is included for the separate migration job; no credentials or test fixtures.
COPY --from=build --chown=node:node /app/node_modules /app/node_modules
COPY --from=build --chown=node:node /app/apps/api/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/package.json ./package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./dist
COPY --from=build --chown=node:node /app/apps/api/prisma ./prisma
COPY --from=build --chown=node:node /app/packages/analytics /app/packages/analytics
COPY --from=build --chown=node:node /app/packages/shared /app/packages/shared
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 CMD node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
