# NetPay Plane — commerce-api (NestJS + Prisma + PostgreSQL)
# Build context: raíz del monorepo (workspace pnpm). Ver docs/15-ops.md T-OPS-03.
#   docker build -f apps/commerce-api/Dockerfile -t netpay-commerce-api .

FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
# Prisma necesita libssl para su query engine nativo.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

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
RUN pnpm --filter @netpay/commerce-api prisma:generate
RUN pnpm --filter @netpay/commerce-api... build

FROM base AS runtime
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo /repo
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "require('http').get('http://localhost:4000/api/v1/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "apps/commerce-api/dist/src/main.js"]
