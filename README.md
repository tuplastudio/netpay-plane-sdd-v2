# NetPay Plane

Plataforma de catálogo, cotizaciones, pedidos, checkout, pagos dummy, WhatsApp e IA.

## Documentación

Toda la especificación SDD vive en [`docs/`](docs/). Empieza por:

- [`docs/00-README.md`](docs/00-README.md) — índice del paquete.
- [`docs/01-constitucion-y-decisiones.md`](docs/01-constitucion-y-decisiones.md) — reglas y ADR.
- [`docs/02-fnd.md`](docs/02-fnd.md) — arquitectura y tareas base.
- [`docs/18-backlog-y-trazabilidad.md`](docs/18-backlog-y-trazabilidad.md) — backlog y orden.

### Despliegue

- [`docs/DEPLOY_DIGITALOCEAN.md`](docs/DEPLOY_DIGITALOCEAN.md) — playbook para correr el stack en un Droplet con Neon (Postgres), CloudAMQP y DigitalOcean Spaces.

## Estructura

```
.
├── apps/
│   ├── web/                  # Next.js + shadcn/ui + RHF
│   ├── commerce-api/         # NestJS + Prisma + PostgreSQL
│   ├── commerce-worker/      # Workers (outbox/inbox, jobs)
│   ├── agent-service/        # Python/FastAPI + OpenRouter (agente conversacional)
│   │   └── knowledge/        # Markdown del negocio que alimenta al agente
│   └── dummy-gateway/        # Pasarela de pago simulada (independiente)
├── packages/
│   ├── contracts/            # OpenAPI, JSON Schemas, tipos generados
│   ├── domain/               # Modelos de dominio compartidos
│   ├── config/               # tsconfig, eslint, prettier compartidos
│   └── ui/                   # Componentes shadcn/ui base
├── infra/
│   └── compose.yaml          # Postgres, RabbitMQ, MinIO, Proxy
└── docs/                     # Especificaciones SDD
```

## Arranque local

```bash
# 1. Instalar dependencias
pnpm install

# 2. Variables de entorno
cp .env.example .env

# 3. Levantar infraestructura (Postgres, RabbitMQ, MinIO)
pnpm compose:up

# 4. Migrar y sembrar base de datos
pnpm db:migrate
pnpm db:seed

# 5. Bootstrap inicial de tenant (idempotente)
pnpm bootstrap

# 6. Dependencias del agente (Python 3.12+)
pnpm agent:setup      # v1 (apps/agent-service)
pnpm agent-v2:setup   # v2 (apps/agent-v2) — el que sirve WhatsApp hoy

# 7. Arrancar todas las apps en modo desarrollo (web, commerce-api, worker,
#    agent-service y agent-v2, todo local, sin Docker)
pnpm dev
```

`pnpm compose:up` levanta solo infraestructura (Postgres, RabbitMQ, MinIO) en
contenedores. Todas las apps (`web`, `commerce-api`, `commerce-worker`,
`agent-service`, `agent-v2`) corren en el host vía `pnpm dev` — es el flujo
estándar de desarrollo. El perfil `docker compose --profile full` (que
también containeriza las apps) queda solo para levantar un stack completo de
demo/staging, no para el día a día.

`pnpm db:seed` imprime **una sola vez** la API key del agente
(`npk_...`). Cópiala a `AGENT_API_KEY_REF` en `.env`: sin ella el agente
conversa y responde del negocio, pero no calcula totales ni emite cotizaciones.

## El agente

El agente vive en [`apps/agent-service`](apps/agent-service/README.md) y aprende
del negocio desde los Markdown de `apps/agent-service/knowledge/`. Ahí van
horarios, envíos, formas de pago, garantías y promociones; el frontmatter de
`negocio.md` define nombre, tono y saludo del agente.

- Chat de prueba: http://localhost:3000/chat
- Consola (conocimiento, modelo, herramientas): http://localhost:3000/agent
- Suite de evaluación: `cd apps/agent-service && .venv/bin/python -m app.evals`

## Correo (invitaciones y notificaciones)

`commerce-api` manda correo transaccional (invitaciones de usuario, avisos de
cotización/pago cuando el cliente no tiene teléfono) vía
[Resend](https://resend.com), con plantillas HTML en
`apps/commerce-api/src/email/templates/*.hbs` (Handlebars).

- `RESEND_API_KEY` — sin ella, el envío se **simula** (se loguea, no se manda
  correo real) y nada se rompe: mismo patrón que `PAYMENT_PROVIDER=DUMMY`.
- `RESEND_FROM_EMAIL` — remitente, por defecto `NetPay Plane <onboarding@resend.dev>`.

## Cifrado de secretos por tenant

`AGENT_SECRET_KEY` (agent-v2) cifra la OpenRouter API key propia de cada
tenant en `apps/agent-v2/.settings/*.json`. Sin configurarla se usa una clave
de desarrollo insegura por defecto — cambiarla es obligatorio antes de
producción.

Sin `OPENROUTER_KEY_REF` el agente **sigue funcionando** con su motor
determinista: busca en el catálogo, cotiza, cobra y escala a un humano.

| Servicio | URL |
| --- | --- |
| Web (Next.js) | http://localhost:3000 |
| API comercial (NestJS) | http://localhost:4000 |
| Worker | http://localhost:4101 |
| Agent (FastAPI) | http://localhost:8000 |
| Dummy gateway | http://localhost:4100 |
| MinIO console | http://localhost:9001 |
| RabbitMQ UI | http://localhost:15672 |

## Reglas obligatorias

1. `PAYMENT_PROVIDER=DUMMY` único permitido. Sin pasarela real.
2. Toda mutación usa `Idempotency-Key`. Toda actualización usa `expectedVersion`.
3. IDs UUIDv7. Dinero decimal string. UTC RFC3339.
4. Ningún cálculo oficial de totales lo hace el LLM. Ningún `setPaid()` en la UI.
5. Multi-tenant aislado en SQL, caché y storage. FK compuesta `tenant_id+id`.
6. Cada cambio de regla actualiza SPEC + ADR + contrato + pruebas en la misma PR.