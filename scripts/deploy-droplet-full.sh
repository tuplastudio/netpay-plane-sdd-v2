#!/usr/bin/env bash
# Despliegue COMPLETO de todos los servicios de PRODUCCIÓN en el Droplet.
#
# Diferencias vs scripts/deploy-droplet.sh:
#   - Usa infra/compose.prod.yaml (producción con Neon + CloudAMQP + DO Spaces),
#     NO infra/compose.yaml (dev compose con Postgres/RabbitMQ/MinIO locales).
#   - NO toca /opt/netpay/infra/.env.prod (ya está configurado en el droplet).
#   - Redeploya los 8 servicios de negocio: commerce-api, commerce-worker,
#     dummy-gateway, agent-v2, agent-service, web, agent-imssbienestar,
#     agent-imssbienestar-ui. NO toca flagsmith ni flagsmith-db (self-hosted,
#     solo se reinician si su imagen cambia, lo cual es raro).
#   - NO corre migraciones automáticamente (la 0011 ya se aplicó; correrla
#     cada deploy es ruido). Las migraciones se aplican a mano cuando hay
#     un schema nuevo commiteado.
#
# Uso desde la máquina local:
#   bash scripts/deploy-droplet-full.sh
#
# Requiere:
#   - doctl autenticado y droplet "dev" accesible por SSH.
set -euo pipefail

DROPLET_NAME="${DROPLET_NAME:-dev}"
SSH_TARGET="${SSH_TARGET:-}"
COMPOSE_FILE="infra/compose.prod.yaml"

# Servicios a (re)desplegar. Orden importa: dependencias primero.
SERVICES=(
  dummy-gateway
  commerce-api
  commerce-worker
  agent-v2
  agent-service
  web
  agent-imssbienestar
  agent-imssbienestar-ui
)

run_on_droplet() {
  local attempt=0
  local max_attempts=5
  local delay=10
  while (( attempt < max_attempts )); do
    if [[ -n "$SSH_TARGET" ]]; then
      if ssh "$SSH_TARGET" "$@"; then return 0; fi
    else
      if doctl compute ssh "$DROPLET_NAME" --ssh-command "$*"; then return 0; fi
    fi
    attempt=$((attempt+1))
    echo "  [ssh retry $attempt/$max_attempts en ${delay}s...]"
    sleep $delay
    delay=$((delay*2))
  done
  echo "ERROR: no se pudo conectar al droplet tras $max_attempts intentos" >&2
  return 1
}

echo "== [0] verificar conectividad con droplet ($DROPLET_NAME)"
run_on_droplet "echo OK; docker --version; docker compose version"

echo "== [1] git pull en /opt/netpay-build"
run_on_droplet "cd /opt/netpay-build && git fetch origin && git reset --hard origin/main && git log --oneline -1"

echo "== [2] rsync a /opt/netpay (preserva .env.prod y bases locales)"
run_on_droplet "rsync -a --delete --exclude .git --exclude node_modules --exclude .next --exclude .data \
  --exclude .vercel --exclude .playwright-mcp --exclude .pnpm-store --exclude .runtime \
  --exclude '.env' --exclude '.env.*' --exclude 'infra/.env' --exclude 'infra/.env.*' \
  /opt/netpay-build/ /opt/netpay/"

echo "== [3] verificar .env.prod intacto"
run_on_droplet "grep -nE '^(PUBLIC_BASE_URL|API_PUBLIC_URL|AGENT_INTERNAL_KEY|IMSSBIENESTAR_INTERNAL_KEY|AGENT_SECRET_KEY|FLAGSMITH_DB_PASSWORD|SESSION_SECRET_REF|TOKEN_ENCRYPTION_KEY_REF|OPENROUTER_KEY_REF|DATABASE_URL)=' /opt/netpay/infra/.env.prod | head -20"

echo "== [4] limpiar contenedores huérfanos previos del run anterior"
run_on_droplet "cd /opt/netpay && docker compose --env-file /opt/netpay/infra/.env.prod -f $COMPOSE_FILE rm -f -s ${SERVICES[*]} 2>/dev/null || true"

echo "== [5] build de los ${#SERVICES[@]} servicios"
run_on_droplet "cd /opt/netpay && docker compose --env-file /opt/netpay/infra/.env.prod -f $COMPOSE_FILE build ${SERVICES[*]} 2>&1 | tail -25"

echo "== [6] up de los servicios"
run_on_droplet "cd /opt/netpay && docker compose --env-file /opt/netpay/infra/.env.prod -f $COMPOSE_FILE up -d ${SERVICES[*]}"

echo "== [7] esperar warm-up (migrations + healthchecks)"
sleep 35

echo "== [8] estado de los contenedores"
run_on_droplet "cd /opt/netpay && docker compose --env-file /opt/netpay/infra/.env.prod -f $COMPOSE_FILE ps --format 'table {{.Name}}\t{{.Status}}\t{{.Ports}}'"

echo "== [9] healthchecks públicos"
run_on_droplet "curl -s -m 10 -o /dev/null -w 'commerce-api healthz: %{http_code}\n' http://127.0.0.1:14000/api/v1/healthz || true"
run_on_droplet "curl -s -m 10 -o /dev/null -w 'web login:          %{http_code}\n' http://127.0.0.1:13000/login || true"
run_on_droplet "docker exec netpay_dummy_gateway wget -q -O - http://127.0.0.1:4100/healthz; echo"

echo "== [10] tail de logs por servicio"
for svc in "${SERVICES[@]}"; do
  echo "--- $svc ---"
  run_on_droplet "docker logs netpay_${svc//-/_} --tail 3 2>&1 | tail -3" || true
done

echo "== DONE"