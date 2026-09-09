# NetPay Plane — web (Next.js, output standalone)
# Build context: raíz del monorepo (workspace pnpm). Ver docs/15-ops.md T-OPS-03.
#   docker build -f apps/web/Dockerfile -t netpay-web .

FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/commerce-api/package.json apps/commerce-api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/dummy-gateway/package.json apps/dummy-gateway/package.json
COPY apps/commerce-worker/package.json apps/commerce-worker/package.json
COPY apps/agent-service/package.json apps/agent-service/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/config/package.json packages/config/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# `rewrites()` en next.config.mjs lee API_INTERNAL_URL para armar el destino
# del proxy /api/v1/*; Next.js resuelve ese valor en `next build`, no en
# runtime, así que tiene que llegar como build arg, no solo como env del
# contenedor en marcha.
ARG API_INTERNAL_URL=http://localhost:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL
RUN pnpm --filter @netpay/web... build

# `output: "standalone"` (next.config.mjs) deja un server.js con solo los
# node_modules que realmente usa en runtime — imagen final mucho más chica.
FROM base AS runtime
WORKDIR /repo
ENV NODE_ENV=production
# Docker inyecta HOSTNAME=<container id> por defecto, y el server.js standalone
# de Next.js escucha en `process.env.HOSTNAME` en vez de todas las interfaces
# si esa variable trae algo — lo deja escuchando solo en la IP del contenedor,
# no en 127.0.0.1 (falla el healthcheck aunque el puerto publicado sí funcione).
ENV HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "require('http').get('http://localhost:3000/login',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
