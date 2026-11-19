FROM node:24-bookworm-slim AS build
RUN npm install -g pnpm@10.17.1
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm --filter @teampulse/web... install --frozen-lockfile
COPY packages/shared packages/shared
COPY apps/web apps/web
ENV VITE_DATA_SOURCE=api
RUN pnpm --filter @teampulse/web build

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 CMD wget -q -O /dev/null http://127.0.0.1:8081/healthz || exit 1
