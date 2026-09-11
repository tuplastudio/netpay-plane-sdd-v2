# Despliegue en DigitalOcean (Droplet + Neon + CloudAMQP + DO Spaces)

Runbook operativo para el stack en producción. Asume:

- Un Droplet Ubuntu 22.04 LTS (recomendado: `s-2vcpu-4gb` o superior).
- Dominio propio apuntando al Droplet (los healthchecks de WhatsApp / webhooks
  de pago lo exigen).
- Cuenta de Neon.tech con un proyecto creado y la DATABASE_URL en mano.
- Cuenta de CloudAMQP con un cluster (gratis "Little Lemur" alcanza para
  empezar; en producción conviene el plan `Tigershark`).
- Spaces bucket creado y la access key/secret a mano.
- API key de OpenRouter (https://openrouter.ai/keys).

## 1. Crear y preparar el Droplet

```bash
# Desde tu laptop con doctl configurado.
doctl compute droplet create netpay-prod \
  --region nyc3 \
  --size s-2vcpu-4gb \
  --image ubuntu-22-04-x64 \
  --ssh-keys <tu-key-fingerprint> \
  --tag-names netpay,prod \
  --enable-monitoring \
  --enable-backups
```

Configurar DNS (ej. `app.tu-dominio.com` y `api.tu-dominio.com`) al IP del Droplet.

## 2. Instalar Docker + Docker Compose plugin

```bash
ssh root@<ip>
apt-get update && apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
usermod -aG docker deployer
```

Crear usuario `deployer` (sin root para SSH) y copiar tu SSH key.

## 3. Clonar el repo

```bash
sudo -iu deployer
git clone https://github.com/<org>/netpay-plane-sdd-v2 /opt/netpay
cd /opt/netpay
```

## 4. Configurar la base de datos en Neon

Desde la consola de Neon:

1. Crear proyecto ( región sugerida: la misma del Droplet ).
2. Branch `main` queda por defecto; tomar el connection string **pooler**
   (host termina en `-pooler.neon.tech`).
3. Asegurar `?sslmode=require` y `?pgbouncer=true&connect_timeout=10`.
4. Crear la base (SQL editor): `CREATE DATABASE netpay`.

Desde tu laptop, probar la conexión:

```bash
psql "$(cat infra/.env.prod | grep '^DATABASE_URL=' | cut -d= -f2-)" -c '\dt'
```

## 5. Configurar el bucket en DigitalOcean Spaces

```bash
doctl spaces create netpay-attachments --region nyc3
doctl spaces keys create netpay-prod   # guarda access/secret en el .env.prod
```

El endpoint público para la región `nyc3` es `https://nyc3.digitaloceanspaces.com`.

## 6. Configurar CloudAMQP

Tomar la URL del cluster en formato
`amqps://<user>:<pass>@<host>.cloudamqp.com/<vhost>` (mismo nombre de usuario
que el vhost por defecto en planes gratis). Va en `BROKER_URL`.

## 7. Generar secretos del agente y de sesión

```bash
# 64 chars aleatorios para SESSION_SECRET_REF:
openssl rand -base64 64 | tr -d '\n='
# 32 bytes (44 chars base64 sin padding) para TOKEN_ENCRYPTION_KEY_REF:
openssl rand -base64 32 | tr -d '\n='
# Para AGENT_SECRET_KEY (cifra la OpenRouter key por tenant):
openssl rand -base64 32 | tr -d '\n='
# AGENT_INTERNAL_KEY (>=32 chars):
openssl rand -base64 32 | tr -d '\n='
```

## 8. Completar `infra/.env.prod` en el Droplet

Edita el archivo (NO versionado, solo en el Droplet) con los valores reales:

```ini
# Dominio público (cambia 'tu-dominio' por el real):
PUBLIC_BASE_URL=https://app.tu-dominio.com
API_SELF_URL=https://api.tu-dominio.com

# Neon (pooler):
DATABASE_URL=postgresql://<neon-user>:<neon-pass>@<host>-pooler.neon.tech/neondb?sslmode=require&pgbouncer=true&connect_timeout=10
DATABASE_URL_DUMMY=postgresql://...  # opcional: dummy gateway usa DB propia

# CloudAMQP:
BROKER_URL=amqps://<user>:<pass>@<host>.cloudamqp.com/<vhost>

# DO Spaces:
OBJECT_STORAGE_ENDPOINT=https://nyc3.digitaloceanspaces.com
OBJECT_STORAGE_ACCESS_KEY=<spaces-access-key>
OBJECT_STORAGE_SECRET_KEY_REF=<spaces-secret>
OBJECT_STORAGE_BUCKET=netpay-attachments

# Secrets generados:
SESSION_SECRET_REF=<64+ chars base64>
TOKEN_ENCRYPTION_KEY_REF=<32 bytes base64>
AGENT_INTERNAL_KEY=<32+ chars>
AGENT_SECRET_KEY=<32 bytes base64>
AGENT_API_KEY_REF=<npk_...>          # del bootstrap inicial (ver más abajo)

# OpenRouter:
OPENROUTER_KEY_REF=sk-or-v1-...

# WhatsApp (cuando conectes un número real):
META_APP_ID=...
META_APP_SECRET_REF=...
META_VERIFY_TOKEN_REF=...
```

`app.tu-dominio.com` y `api.tu-dominio.com` resuelven al IP del Droplet (A
records en el panel DNS del dominio).

## 9. Reverse proxy con Caddy (TLS automático)

Instalar Caddy dentro del Droplet (sin contenedor, performance):

```bash
sudo apt install -y caddy
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
app.tu-dominio.com {
  reverse_proxy 127.0.0.1:3000
}
api.tu-dominio.com {
  reverse_proxy 127.0.0.1:4000
  reverse_proxy /uploads/* http://localhost:4000
}
EOF
sudo systemctl reload caddy
```

(Caddy emite y renueva los certificados Let's Encrypt sin pasos extra.)

## 10. Primer deploy

Desde tu laptop:

```bash
export APP_HOST=app.tu-dominio.com
export APP_USER=deployer
export SSH_KEY=~/.ssh/id_ed25519
pnpm deploy
```

El script:

1. Sube el código vía `rsync`.
2. `docker compose -f infra/compose.prod.yaml build`.
3. `docker compose ... up -d`.
4. Corre `prisma migrate deploy` contra Neon.
5. Muestra estado y healthchecks.

## 11. Bootstrap inicial (tenant demo)

Una vez arriba el stack, crea el tenant demo + owner ejecutando el mismo
`bootstrap` que en local, pero apuntando al API público:

```bash
pnpm --filter @netpay/commerce-api bootstrap
# o, manualmente:
docker compose -f infra/compose.prod.yaml exec -T commerce-api \
  node apps/commerce-api/dist/src/main.js   # (NO — bootstrap se corre antes)

# Mejor, en el Droplet (donde corre compose):
cd /opt/netpay
docker compose -f infra/compose.prod.yaml exec -T commerce-api \
  pnpm bootstrap
```

El bootstrap es **idempotente**: puede correrse varias veces. Crea:

- Un tenant "demo" (slug= `demo`).
- Un owner `owner@demo.local` con la contraseña `Demo1234!Demo1234!`.
- Una API key `npk_...` (imprime una sola vez) → **cópiala a
  `AGENT_API_KEY_REF` en `infra/.env.prod`** y reinicia el agente.

## 12. Verificación manual (smoke)

```bash
# Frontend:
curl -fsS https://app.tu-dominio.com/login | head -1
# API healthz:
curl -fsS https://api.tu-dominio.com/api/v1/healthz
# Agent-v2 healthz (no expuesto al público; via SSH en el Droplet):
docker compose -f infra/compose.prod.yaml exec -T agent-v2 \
  python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8010/healthz', timeout=3).status==200 else 1)" \
  && echo "agent-v2 OK"

# Login desde el navegador:
open https://app.tu-dominio.com/login
# owner@demo.local / Demo1234!Demo1234!
```

## 13. Operación

| Acción                | Comando                                       |
| --------------------- | --------------------------------------------- |
| Ver logs en vivo      | `pnpm deploy:logs`                            |
| Estado + healthchecks | `pnpm deploy:status`                          |
| Rebuild sin caché     | `pnpm deploy:rebuild`                         |
| Parar el stack        | `pnpm deploy:stop`                            |
| Correr una migración  | `pnpm deploy:migrate`                         |
| Volver a un ref       | `APP_PREV_REF=origin/<sha> pnpm deploy:rollback` |

## 14. Backups (Neon)

Neon ya hace backup automático (point-in-time recovery, hasta 7 días en el
plan Free, 30 en el Launch). Para_exportar datos manualmente:

```bash
docker compose -f infra/compose.prod.yaml exec -T commerce-api \
  pnpm exec prisma db pull
# Lo deja en apps/commerce-api/prisma/schema.prisma; comparar contra VCS.
```

Backups adicionales (recomendado semanal):

```bash
doctl compute snapshot snapshot-actions create <droplet-id> \
  --snapshot-name "netpay-$(date +%Y%m%d)"
```

## 15. Troubleshooting

| Síntoma                                                  | Causa probable                                                |
| -------------------------------------------------------- | ------------------------------------------------------------- |
| `agent-v2` reinicia cada pocos minutos                    | `AGENT_SECRET_KEY` mal seteada → settings.json ilegibles.     |
| `commerce-api` 5xx al primer `/auth/me`                  | `SESSION_SECRET_REF` < 64 chars o demasiado corta.            |
| `web` 502 al pegar a `/api/v1`                          | `API_INTERNAL_URL` en build != `http://commerce-api:4000`.     |
| Costo de OpenRouter disparado                            | Tenant cambió prompt; revisar `/agent` para `temperature`.    |
| WhatsApp webhook no llega                                | `PUBLIC_BASE_URL` no es HTTPS o el túnel ngrok se cayó.        |
| Migración Prisma falla con `P3009`                      | Drift entre schema y DB. `prisma migrate resolve`.            |
| 401 "INVALID_INTERNAL_KEY" entre agent y api             | `AGENT_INTERNAL_KEY` no coincide entre los dos `.env`.         |

## 16. Variables a rotar en cada release mayor

- `SESSION_SECRET_REF` invalida TODAS las sesiones vivas (esperado).
- `TOKEN_ENCRYPTION_KEY_REF` descifra los tokens guardados (RFC y otros
  datos cifrados en reposo); rotar requiere migración manual.
- `AGENT_SECRET_KEY` descifra la OpenRouter key por tenant guardada en
  `apps/agent-v2/.settings/*.json`; rotar requiere reescribir las settings
  cifradas.
- `AGENT_INTERNAL_KEY` no requiere migración: solo reiniciar ambos servicios
  y verificar que `web → /agent/[...]` siga funcionando.

## 17. Resumen de archivos modificados / creados para este deploy

| Archivo                     | Qué hace                                                                  |
| --------------------------- | ------------------------------------------------------------------------- |
| `infra/compose.prod.yaml`   | Stack de producción: Postgres/RabbitMQ/MinIO externalizados a Neon/CloudAMQP/Spaces. |
| `scripts/deploy.sh`         | `pnpm deploy`: rsync + build + up + migrate + healthcheck.               |
| `.env.example`              | Documenta `DATABASE_POOL_URL` para Neon y referencias a Spaces.          |
| `docs/DEPLOY_DIGITALOCEAN.md` | Este playbook.                                                          |
| `package.json`              | Scripts `deploy`, `deploy:rebuild`, `deploy:status`, etc.               |

El `infra/compose.yaml` original sigue intacto para desarrollo (`pnpm dev` /
`compose:up`); producción usa `infra/compose.prod.yaml` con `scripts/deploy.sh`.
