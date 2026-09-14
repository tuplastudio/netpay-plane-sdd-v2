# NetPay Plane — dummy-gateway (pasarela de pago simulada, independiente)
# Build context: raíz del monorepo (workspace pnpm). Ver docs/15-ops.md T-OPS-03.
#   docker build -f apps/dummy-gateway/Dockerfile -t netpay-dummy-gateway .

FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/commerce-api/package.json apps/commerce-api/package.json
COPY apps/commerce-api/prisma apps/commerce-api/prisma
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
RUN pnpm --filter @netpay/dummy-gateway... build

FROM base AS runtime
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo /repo
EXPOSE 4100

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "require('http').get('http://localhost:4100/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "apps/dummy-gateway/dist/src/main.js"]
