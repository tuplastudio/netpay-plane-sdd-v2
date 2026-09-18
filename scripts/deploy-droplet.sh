#!/usr/bin/env bash
# Despliegue del backend en el Droplet (se ejecuta EN el droplet, como root).
#
# Uso desde la máquina local:
#   doctl compute ssh dev --ssh-command "bash -s" < scripts/deploy-droplet.sh
#   # o: scp scripts/deploy-droplet.sh root@165.227.200.148:/tmp/ && ssh root@165.227.200.148 bash /tmp/deploy-droplet.sh
#
# Qué hace:
#   1. Trae main a /opt/netpay-build (clon git) y lo copia a /opt/netpay (contexto
#      del compose), conservando .env* del droplet.
#   2. Fija en /opt/netpay/.env las URLs públicas estables (sin ngrok), los
#      métodos de pago y AGENT_SECRET_KEY si faltaba. Deja backup del .env.
#   3. Aplica la migración 0011 (CheckoutSession.paymentMethod) en Neon.
#   4. Rebuild + up de commerce-api, dummy-gateway y agent-v2 (el web vive en Vercel).
#   5. Verifica healthz y que el proxy dummy-proxy solo sirva el hosted.
set -euo pipefail

echo "== [1] git pull en /opt/netpay-build"
cd /opt/netpay-build && git fetch origin && git reset --hard origin/main && git log --oneline -1

echo "== [2] rsync a /opt/netpay (conserva .env)"
rsync -a --delete --exclude .git --exclude node_modules --exclude .next --exclude .data \
  --exclude '.env' --exclude '.env.*' --exclude 'infra/.env' --exclude 'infra/.env.*' \
  /opt/netpay-build/ /opt/netpay/

echo "== [3] .env"
cd /opt/netpay
cp -n .env ".env.bak-$(date +%Y%m%d%H%M%S)"
sed -i -E 's#^PUBLIC_BASE_URL=.*#PUBLIC_BASE_URL=https://easysell.web.tupla.dev#' .env
if grep -q '^API_PUBLIC_URL=' .env; then
  sed -i -E 's#^API_PUBLIC_URL=.*#API_PUBLIC_URL=https://api-easysell.tupla.dev#' .env
else
  echo 'API_PUBLIC_URL=https://api-easysell.tupla.dev' >> .env
fi
grep -q '^PAYMENT_METHODS=' .env || echo 'PAYMENT_METHODS=CARD,SPEI,OXXO' >> .env
grep -q '^DUMMY_PUBLIC_URL=' .env || echo 'DUMMY_PUBLIC_URL=https://easysell.web.tupla.dev/pay' >> .env
grep -q '^AGENT_SECRET_KEY=' .env || echo "AGENT_SECRET_KEY=$(openssl rand -hex 32)" >> .env
if grep -q '^CORS_EXTRA_ORIGINS=' .env; then
  sed -i -E 's#^CORS_EXTRA_ORIGINS=.*#CORS_EXTRA_ORIGINS=https://easysell.web.tupla.dev#' .env
fi
grep -nE '^(PUBLIC_BASE_URL|API_PUBLIC_URL|PAYMENT_METHODS|DUMMY_PUBLIC_URL|CORS_EXTRA_ORIGINS|AGENT_URL)=' .env

echo "== [4] migración 0011 en Neon"
NEON="$(docker exec netpay_commerce_api sh -c 'echo $DATABASE_URL')"
NEON="${NEON%%\?*}?sslmode=require"
docker exec -i netpay_postgres psql "$NEON" -v ON_ERROR_STOP=1 \
  -c 'ALTER TABLE "CheckoutSession" ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT;' \
  -c "select column_name from information_schema.columns where table_name='CheckoutSession' and column_name in ('paymentMethod','refundedTotal');"

echo "== [5] build"
docker compose -f infra/compose.yaml --profile full build commerce-api dummy-gateway agent-v2 2>&1 | tail -15

echo "== [6] up"
docker compose -f infra/compose.yaml --profile full up -d commerce-api dummy-gateway agent-v2
sleep 25
docker compose -f infra/compose.yaml --profile full ps --format '{{.Name}} {{.Status}}'

echo "== [7] verificación"
docker exec netpay_commerce_api sh -c 'echo PUBLIC_BASE_URL=$PUBLIC_BASE_URL API_PUBLIC_URL=$API_PUBLIC_URL DUMMY_PUBLIC_URL=$DUMMY_PUBLIC_URL PAYMENT_METHODS=$PAYMENT_METHODS'
curl -s -m 10 https://api-easysell.tupla.dev/api/v1/healthz; echo
curl -s -m 10 -o /dev/null -w 'dummy-proxy healthz (esperado 404): %{http_code}\n' https://api-easysell.tupla.dev/api/v1/payments/dummy-proxy/healthz
docker logs netpay_agent_v2 --tail 5 2>&1 | cut -c1-200 || true
echo "== DONE"
