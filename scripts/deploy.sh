#!/usr/bin/env bash
# Despliega el stack de producción en un Droplet de DigitalOcean.
#
# Modos:
#   ./scripts/deploy.sh                     # usa $APP_HOST, asume prod
#   APP_HOST=1.2.3.4 ./scripts/deploy.sh    # deploy contra ese host
#   ./scripts/deploy.sh --rebuild           # rebuild + up (sin prune)
#   ./scripts/deploy.sh --logs              # tail -f de los servicios
#   ./scripts/deploy.sh --stop             # para el stack
#   ./scripts/deploy.sh --status           # estado + healthchecks resumidos
#   ./scripts/deploy.sh --rollback         # vuelve al tag/commit anterior
#   ./scripts/deploy.sh --migrate           # corre prisma migrate deploy
#
# Variables de entorno relevantes (en el host o en este shell):
#   APP_HOST                IP del Droplet (obligatoria).
#   APP_USER                Usuario SSH (default: deployer).
#   APP_PORT                Puerto SSH (default: 22).
#   APP_DIR                 Carpeta del repo en el Droplet (default: /opt/netpay).
#   APP_REF                 Git ref a desplegar (default: HEAD del remoto).
#   SSH_KEY                 Ruta a la SSH key (default: ~/.ssh/id_ed25519).
#   SKIP_MIGRATE=1          saltar prisma migrate deploy (no recomendado).
#
# Antes de correrlo por primera vez, lee `docs/DEPLOY_DIGITALOCEAN.md` y
# asegura que en el Droplet existen `infra/.env.prod` (los secretos reales)
# y `~/.ssh/authorized_keys` con tu key.

set -euo pipefail

# ---- args -------------------------------------------------------------------
CMD="up"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --rebuild) CMD="rebuild"; shift ;;
    --logs)    CMD="logs";    shift ;;
    --stop)    CMD="stop";    shift ;;
    --status)  CMD="status";  shift ;;
    --rollback) CMD="rollback"; shift ;;
    --migrate) CMD="migrate"; shift ;;
    -h|--help)
      sed -n '2,32p' "$0"
      exit 0
      ;;
    *)
      echo "Argumento desconocido: $1" >&2
      exit 2
      ;;
  esac
done

# ---- variables --------------------------------------------------------------
APP_HOST="${APP_HOST:?APP_HOST es obligatorio (IP o DNS del Droplet)}"
APP_USER="${APP_USER:-deployer}"
APP_PORT="${APP_PORT:-22}"
APP_DIR="${APP_DIR:-/opt/netpay}"
APP_REF="${APP_REF:-}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
COMPOSE_FILE="infra/compose.prod.yaml"

REMOTE="$APP_USER@$APP_HOST"
SSH_OPTS=(-i "$SSH_KEY" -p "$APP_PORT" -o StrictHostKeyChecking=accept-new -o LogLevel=ERROR)

run() { ssh "${SSH_OPTS[@]}" "$REMOTE" "$@"; }
sync() { rsync -az --delete --exclude ".git" --exclude "node_modules" --exclude ".next" --exclude ".data" --exclude "__pycache__" -e "ssh ${SSH_OPTS[*]}" "$@" >/dev/null; }

# ---- helpers ----------------------------------------------------------------
ensure_remote() {
  run "command -v docker >/dev/null 2>&1 || { echo 'Falta docker en el Droplet'; exit 1; }"
  run "command -v docker-compose-plugin >/dev/null 2>&1 || docker compose version >/dev/null 2>&1 || { echo 'Falta docker compose plugin'; exit 1; }"
}

ensure_secrets() {
  # .env.prod DEBE existir en el Droplet antes de correr `up`. Si no está,
  # fallamos aquí con un mensaje que dice qué hacer.
  run "test -s ${APP_DIR}/${COMPOSE_FILE%/*}/.env.prod || { echo \"Falta ${APP_DIR}/${COMPOSE_FILE%/*}/.env.prod en el Droplet. Edita infra/.env.prod con los secretos reales y vuelve a correr.\"; exit 1; }"
}

# ---- comandos --------------------------------------------------------------
cmd_up() {
  ensure_remote
  ensure_secrets

  echo "→ Subiendo código al Droplet…"
  sync ./ "$REMOTE:$APP_DIR/"

  echo "→ git fetch + reset a la ref…"
  if [ -n "${APP_REF:-}" ]; then
    run "cd $APP_DIR && git fetch --all --prune && git reset --hard origin/${APP_REF}"
  else
    # Si estamos sincronizando sin git, deja lo que subió rsync y avanza.
    run "cd $APP_DIR || true"
  fi

  echo "→ Build imágenes (cambios de código)…"
  run "cd $APP_DIR && docker compose -f $COMPOSE_FILE build --pull"

  echo "→ Up (servicios)…"
  run "cd $APP_DIR && docker compose -f $COMPOSE_FILE up -d --remove-orphans"

  if [ "${SKIP_MIGRATE:-0}" = "1" ]; then
    echo "→ SKIP_MIGRATE=1: saltando prisma migrate deploy"
  else
    echo "→ prisma migrate deploy…"
    run "cd $APP_DIR && docker compose -f $COMPOSE_FILE exec -T commerce-api pnpm prisma migrate deploy"
  fi

  echo "→ Estado y healthchecks…"
  run "cd $APP_DIR && docker compose -f $COMPOSE_FILE ps"
  run "cd $APP_DIR && bash -lc 'for s in web commerce-api dummy-gateway agent-v2; do printf \"%-14s \" \"\$s:\"; docker compose -f $COMPOSE_FILE exec -T \$s wget -qO- http://localhost:3000/login >/dev/null 2>&1 || docker compose -f $COMPOSE_FILE exec -T \$s curl -fsS http://localhost:8000/healthz >/dev/null 2>&1 || curl -fsS http://localhost:3000/login >/dev/null 2>&1 || true; done; true'"
  echo "✓ Hecho. Verifica https://${APP_HOST}"
}

cmd_rebuild() {
  ensure_remote
  ensure_secrets
  echo "→ Re-build sin caché y up…"
  sync ./ "$REMOTE:$APP_DIR/"
  run "cd $APP_DIR && docker compose -f $COMPOSE_FILE build --pull --no-cache"
  run "cd $APP_DIR && docker compose -f $COMPOSE_FILE up -d --remove-orphans"
  if [ "${SKIP_MIGRATE:-0}" != "1" ]; then
    run "cd $APP_DIR && docker compose -f $COMPOSE_FILE exec -T commerce-api pnpm prisma migrate deploy"
  fi
  echo "✓ Rebuild completo."
}

cmd_logs() {
  run "cd $APP_DIR && docker compose -f $COMPOSE_FILE logs -f --tail=100"
}

cmd_stop() {
  ensure_remote
  echo "→ Parando stack…"
  run "cd $APP_DIR && docker compose -f $COMPOSE_FILE stop"
  echo "✓ Stack detenido (los volúmenes siguen vivos)."
}

cmd_status() {
  ensure_remote
  echo "→ Servicios…"
  run "cd $APP_DIR && docker compose -f $COMPOSE_FILE ps"
  echo
  echo "→ Healthchecks…"
  run "cd $APP_DIR && bash -lc '
    for s in web commerce-api dummy-gateway agent-v2; do
      printf \"%-14s \" \"\$s:\"
      case \$s in
        web)           docker compose -f $COMPOSE_FILE exec -T \$s wget -qO- http://localhost:3000/login >/dev/null 2>&1 && echo OK || echo FAIL ;;
        commerce-api)  docker compose -f $COMPOSE_FILE exec -T \$s wget -qO- http://localhost:4000/api/v1/healthz >/dev/null 2>&1 && echo OK || echo FAIL ;;
        dummy-gateway) docker compose -f $COMPOSE_FILE exec -T \$s wget -qO- http://localhost:4100/healthz >/dev/null 2>&1 && echo OK || echo FAIL ;;
        agent-v2)      docker compose -f $COMPOSE_FILE exec -T \$s python3 -c \"import urllib.request,sys; sys.exit(0 if urllib.request.urlopen(\\\"http://localhost:8010/healthz\\\", timeout=3).status==200 else 1)\" && echo OK || echo FAIL ;;
      esac
    done
  '"
}

cmd_migrate() {
  ensure_remote
  echo "→ prisma migrate deploy…"
  run "cd $APP_DIR && docker compose -f $COMPOSE_FILE exec -T commerce-api pnpm prisma migrate deploy"
}

cmd_rollback() {
  ensure_remote
  : "${APP_PREV_REF:?APP_PREV_REF es obligatorio (ref a la que volver)}"
  echo "→ Rollback a $APP_PREV_REF…"
  run "cd $APP_DIR && git fetch --all && git reset --hard $APP_PREV_REF"
  cmd_rebuild
}

case "$CMD" in
  up)       cmd_up ;;
  rebuild)  cmd_rebuild ;;
  logs)     cmd_logs ;;
  stop)     cmd_stop ;;
  status)   cmd_status ;;
  migrate)  cmd_migrate ;;
  rollback) cmd_rollback ;;
esac
