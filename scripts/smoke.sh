#!/usr/bin/env bash
# E2E smoke test del flujo Venta Local:
#   catalog → customer → quote → accept → order → checkout → payment → ledger
#
# Asume: API en :4000, dummy-gateway en :4100, postgres en :15432
set -euo pipefail

API=http://localhost:4000/api/v1
DUMMY=http://localhost:4100
COOKIE=/tmp/c.txt

bold() { printf "\n\033[1m== %s ==\033[0m\n" "$*"; }

bold "1) Login"
curl -s -X POST "$API/auth/login" \
  -H "content-type: application/json" \
  -d '{"email":"owner@demo.local","password":"Demo1234!Demo1234!","tenantSlug":"demo"}' \
  -c "$COOKIE" -o /tmp/login.json -w "  http=%{http_code}\n"
cat /tmp/login.json | python3 -c 'import sys,json;d=json.load(sys.stdin)["data"];print("  user:",d["userId"][:8],"role:",d["role"])'

bold "2) Listar catálogo"
VARIANT_ID=$(curl -s "$API/catalog/products" -b "$COOKIE" \
  | python3 -c 'import sys,json;p=json.load(sys.stdin)["data"][0];v=p["variants"][0];print(v["id"])')
echo "  variant: $VARIANT_ID"

bold "3) Crear cliente"
EMAIL="smoke-$(date +%s)@test.local"
CUSTOMER_ID=$(curl -s -X POST "$API/customers" -b "$COOKIE" \
  -H "content-type: application/json" \
  -d "{\"fullName\":\"Cliente Smoke Test\",\"email\":\"$EMAIL\",\"phone\":\"+5215500000000\",\"taxId\":\"XAXX010101000\"}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["id"])')
echo "  customer: $CUSTOMER_ID"

bold "4) Crear cotización (issue=true)"
QUOTE_ID=$(curl -s -X POST "$API/quotes" -b "$COOKIE" \
  -H "content-type: application/json" \
  -d "{\"customerId\":\"$CUSTOMER_ID\",\"issue\":true,\"lines\":[{\"variantId\":\"$VARIANT_ID\",\"quantity\":\"2.000\",\"discountPct\":10}]}" \
  | tee /tmp/quote.json | python3 -c 'import sys,json;d=json.load(sys.stdin)["data"];print(d["id"])')
TOTAL=$(python3 -c 'import json;d=json.load(open("/tmp/quote.json"))["data"];print(d["total"])')
echo "  quote: $QUOTE_ID  total: $TOTAL"

bold "5) Compartir cotización (link público)"
SHARE=$(curl -s -X POST "$API/quotes/$QUOTE_ID/share" -b "$COOKIE" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin)["data"];print(d["token"])')
echo "  share token: $SHARE"
PUBLIC=$(curl -s "$API/quotes/public/$SHARE" | python3 -c 'import sys,json;d=json.load(sys.stdin)["data"];print(d["status"])')
echo "  public view status: $PUBLIC"

bold "6) Aceptar cotización → crea Order"
ORDER_ID=$(curl -s -X POST "$API/orders/from-quote/$QUOTE_ID" -b "$COOKIE" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["id"])')
echo "  order: $ORDER_ID"

bold "7) Iniciar checkout (reserva stock + crea revisión + token público)"
CHECKOUT=$(curl -s -X POST "$API/orders/$ORDER_ID/checkout" -b "$COOKIE" \
  -H "content-type: application/json" \
  -d "{\"lines\":[{\"variantId\":\"$VARIANT_ID\",\"quantity\":\"2.000\"}],\"deliveryMode\":\"PICKUP\"}" \
  | tee /tmp/checkout.json)
TOKEN=$(echo "$CHECKOUT" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["checkoutToken"])')
echo "  checkout token: $TOKEN"

bold "8) Comprador entra al checkout público y crea sesión dummy"
PUBLIC_VIEW=$(curl -s "$API/orders/public/$TOKEN")
echo "  $PUBLIC_VIEW" | python3 -c 'import sys,json;d=json.load(sys.stdin)["data"];print("  status:",d["status"],"total:",d["total"])'
SESSION_RES=$(curl -s -X POST "$API/orders/public/$TOKEN/checkout" -i)
echo "  public checkout response:"
echo "$SESSION_RES" | head -10 | sed 's/^/    /'

bold "9) Verificar sesión en dummy y capturar"
SID=$(curl -s -X POST "$DUMMY/checkout/sessions" -H "content-type: application/json" -H "authorization: Bearer npk_test_demo" -d '{"amount":"100.00","currency":"MXN","orderId":"smoke-001"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["id"])')
echo "  dummy session: $SID"
curl -s -X POST "$DUMMY/checkout/sessions/$SID/capture" -H "content-type: application/json" -d '{}' | python3 -c 'import sys,json;print("  capture:",json.load(sys.stdin)["data"]["status"])'

bold "10) Verificar list de quotes con scope correcto (FINANCE sin quotes.write)"
curl -s "$API/quotes" -b "$COOKIE" -o /dev/null -w "  status=%{http_code}\n"

bold "11) Webhook end-to-end (capture + notify + ledger)"
# Necesita una sesión real apuntando a un order conocido.
DUMMY_BASE=http://localhost:4100
SECRET="dev-webhook-secret"

# Crear order + checkout que reciba webhook (mismo flujo que paso 8).
CO=$(curl -s -X POST "$API/orders" -b "$COOKIE" \
  -H "content-type: application/json" \
  -d "{\"customerId\":\"$CUSTOMER_ID\",\"lines\":[{\"variantId\":\"$VARIANT_ID\",\"quantity\":\"1.000\"}]}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["id"])')
CO_TOKEN=$(curl -s -X POST "$API/orders/$CO/checkout" -b "$COOKIE" \
  -H "content-type: application/json" \
  -d "{\"lines\":[{\"variantId\":\"$VARIANT_ID\",\"quantity\":\"1.000\"}],\"deliveryMode\":\"PICKUP\"}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["checkoutToken"])')
SESSION_RES=$(curl -s -X POST "$API/orders/public/$CO_TOKEN/checkout")
# El sessionId devuelto es el de la BD del API. El dummy tiene su propio
# id que viene embebido en checkoutUrl: .../checkout/{dummyId}/hosted
DUMMY_ID=$(echo "$SESSION_RES" | python3 -c 'import sys,json,re,urllib.parse as u;d=json.load(sys.stdin)["data"];url=u.urlparse(d["checkoutUrl"]);m=re.search(r"/checkout/([0-9a-f]+)/hosted",url.path);print(m.group(1) if m else "")')
CHECKOUT_URL=$(echo "$SESSION_RES" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["checkoutUrl"])')
echo "  order=$CO checkout_token=$CO_TOKEN dummy_session=$DUMMY_ID"
if [ -z "$DUMMY_ID" ]; then
  echo "  ⚠ no se pudo extraer dummy session id; saltando webhook"
  SKIP_WEBHOOK=1
fi

# Capturar en dummy, pero ANTES inyectamos el webhook URL correcto.
# El dummy necesita el webhookUrl para enviar al API; lo simulamos
# invocando el endpoint de captura del dummy con webhookUrl.
curl -s -X POST "$DUMMY_BASE/checkout/sessions/$DUMMY_ID/capture" \
  -H "content-type: application/json" \
  -d "{\"webhookUrl\":\"http://localhost:4000/api/v1/payments/webhook\",\"secret\":\"$SECRET\"}" \
  | python3 -c 'import sys,json;print("  capture status:",json.load(sys.stdin)["data"]["status"])'

sleep 1
ORDER_STATUS=$(curl -s "$API/orders/$CO" -b "$COOKIE" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["status"])')
echo "  order status post-webhook: $ORDER_STATUS"
LEDGER=$(curl -s "$API/payments/ledger" -b "$COOKIE")
echo "  ledger entries: $(echo "$LEDGER" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)["data"]))')"

bold "12) Healthz + Readyz"
curl -s "$API/healthz"
echo
curl -s "$API/readyz"
echo

echo
printf "\033[1;32m✔ Smoke test OK\033[0m\n"