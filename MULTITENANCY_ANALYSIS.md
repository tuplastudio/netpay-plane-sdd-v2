# Análisis: SaaS Multi-Tenant Completo con Dashboard de Super-Admin

**Objetivo:** Transformar NetPay Plane de single-tenant a SaaS donde cada empresa (tenant) es cliente independiente con branding, usuarios, API keys y datos completamente aislados.

---

## 1. ESTADO ACTUAL

### ✅ YA IMPLEMENTADO (Multi-Tenant Base)

#### Base de Datos
- Modelo `Tenant`: identificación, slug, nombre, estado, zona horaria
- Configuración por tenant: impuesto, envío, límites de descuento, validez de cotizaciones
- **FK compuesta** `(tenant_id, id)` en todas las tablas: Products, Orders, Customers, Quotes, etc.
- Aislamiento SQL completo: donde consulta siempre filtra por `WHERE tenant_id = :tenant_id`
- Versionado: cada cambio de configuración aumenta `configVersion`

#### Usuarios y Roles
- `User` global (email único)
- `Membership`: relación user-tenant-role
- Roles por tenant: ADMIN, GESTOR, AGENTE, LECTOR
- Un usuario puede tener múltiples roles en múltiples tenants

#### API Keys
- `ApiKey` model: por tenant, para integraciones
- Usado por bot para acceder a endpoints de commerce-api
- Rotación manual (crear nueva, deprecar vieja)

#### Sesiones
- `Session`: token de sesión activa por usuario
- IP y User-Agent registrados

### ⚠️ PARCIALMENTE IMPLEMENTADO

#### Configuración de Agente
- Vive en Markdown (`apps/agent-service/knowledge/`)
- Particionado por tenant (en teoría)
- **Problema**: OpenRouter API key es global (`OPENROUTER_KEY_REF` env var)
  - Mismo modelo para todos los tenants
  - Mismo `openrouter_key` hardcodeado en `config.py`
  - No hay control de costos por tenant (todo se suma)

#### Admin Panel
- Existe (`/admin`) pero es **por tenant**
- Gestiona usuarios, configuración, auditoría **de ese tenant**
- No hay "super-admin" para crear/borrar tenants

### ❌ NO IMPLEMENTADO (Necesario para SaaS)

#### Super-Admin Dashboard
- Interfaz para crear nuevos tenants
- Listar todos los tenants (estado, uso, pagos)
- Editar/deshabilitar tenants
- Ver estadísticas consolidadas (ingresos, usuarios activos)
- Configurar plan de cada tenant (free, pro, enterprise)

#### Branding por Tenant
- Colores corporativos (primario, secundario, acentos)
- Logo y favicon
- Nombre personalizado en header/footer
- Fuentes personalizadas (opcional)
- Dominio custom (ej. aglos.empresa.com vs. main.netpayplane.com)

#### OpenRouter API Key por Tenant
- Base de datos: guardar `openrouter_key` en tabla de configuración del tenant
- Lógica: middleware para inyectar la API key del tenant al llamar el bot
- Facturación: trackear uso por tenant, alertas de gasto

#### Planes y Límites
- Free: máx 10 productos, 100 cotizaciones/mes, sin integración WhatsApp
- Pro: máx 1000 productos, 10k cotizaciones/mes, WhatsApp incluido
- Enterprise: ilimitado, soporte prioritario
- Enforcement en backend: rechazar si tenant exceede límite

#### Gestión de Usuarios desde Admin
- Actualizar: nombres, roles, estado (suspender)
- Eliminar usuario del tenant
- Resetear contraseña desde admin (sin email)
- Historial: auditar quién accedió qué y cuándo

#### Billing y Pagos
- Suscripción por tenant (plan mensual/anual)
- Método de pago del tenant (tarjeta de empresa)
- Facturación automática
- Invoice por periodo

---

## 2. CAMBIOS EN BASE DE DATOS

### 2.1 Ampliar Modelo Tenant

```sql
-- Agregar a tabla Tenant:

-- Branding
logoUrl              String?          // URL a MinIO
faviconUrl           String?          // Emoji o URL
primaryColor         String @default("#000000")     // hex
secondaryColor       String @default("#666666")     // hex
accentColor          String @default("#0066CC")     // hex
fontFamily           String @default("system-ui")   // CSS font-family
customDomain         String? @unique               // aglos.miapp.com

-- Plan y Límites
plan                 Plan @default(FREE)           // FREE, PRO, ENTERPRISE
planStartDate        DateTime @default(now())
planEndDate          DateTime?                     // null si anual
paymentMethodId      String?                       // Stripe ID o similar
monthlySpend         Decimal @default(0)           // OpenRouter + storage
monthlyLimit         Decimal?                      // null si unlimited
billingEmail         String?                       // email para invoices

-- Contratos
tosAccepted          Boolean @default(false)
tosAcceptedAt        DateTime?
dpaAccepted          Boolean @default(false)       // Data Processing Agreement
dpaAcceptedAt        DateTime?

-- Estados
createdBy            String @db.Uuid               // User ID de quien creó
approvedBy           String? @db.Uuid              // Admin que aprobó
suspendReason        String?                       // por qué se suspendió
```

### 2.2 Nueva Tabla: TenantIntegration

Guardar credenciales por tenant (OpenRouter, Stripe, AWS, etc.)

```sql
model TenantIntegration {
  id                String @id @default(uuid())
  tenantId          String @db.Uuid
  type              IntegrationType  // OPENROUTER, STRIPE, AWS_S3, TWILIO
  apiKey            String           // Encriptado en tránsito y reposo
  apiSecret         String?          // Encriptado
  metadata          Json?            // config adicional (base_url, etc.)
  isActive          Boolean @default(true)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  createdBy         String @db.Uuid  // User ID
  
  tenant            Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  
  @@unique([tenantId, type])
  @@index([tenantId])
}

enum IntegrationType {
  OPENROUTER
  STRIPE
  TWILIO
  AWS_S3
  SENDGRID
}
```

### 2.3 Nueva Tabla: TenantUsage

Trackear uso de API, almacenamiento, etc. para billing.

```sql
model TenantUsage {
  id                String @id @default(uuid())
  tenantId          String @db.Uuid
  period            String           // "2026-09" (YYYY-MM)
  apiCallsCount     Int @default(0)
  storageBytes      BigInt @default(0)
  openrouterTokens  Int @default(0)
  openrouterCost    Decimal @default(0)  // estimado, en USD
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  
  tenant            Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  
  @@unique([tenantId, period])
  @@index([tenantId])
}
```

### 2.4 Nueva Tabla: BillingInvoice

Facturación automática.

```sql
model BillingInvoice {
  id                String @id @default(uuid())
  tenantId          String @db.Uuid
  invoiceNumber     String @unique    // INV-2026-001
  period            String            // "2026-09"
  plan              Plan
  planCost          Decimal           // precio base del plan
  overageCost       Decimal @default(0)  // exceso en API calls, storage
  totalAmount       Decimal
  currency          String @default("USD")
  status            InvoiceStatus @default(PENDING)  // PENDING, PAID, OVERDUE
  paidAt            DateTime?
  dueDate           DateTime
  invoiceUrl        String?           // enlace público o PDF
  createdAt         DateTime @default(now())
  
  tenant            Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  
  @@index([tenantId])
  @@index([status])
}

enum InvoiceStatus {
  PENDING
  PAID
  OVERDUE
  CANCELLED
}
```

---

## 3. CAMBIOS EN BACKEND (NestJS API)

### 3.1 Middleware de Super-Admin

```typescript
// src/common/decorators/super-admin.decorator.ts
export const RequireSuperAdmin = () =>
  SetMetadata('requireSuperAdmin', true);

// src/common/guards/super-admin.guard.ts
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    
    // Buscar membership del usuario en tenant "PLATFORM" (meta-tenant)
    return user.memberships.some(m => 
      m.tenantId === PLATFORM_TENANT_ID && m.role === 'SUPER_ADMIN'
    );
  }
}
```

### 3.2 Endpoints de Super-Admin

#### Crear Tenant
```
POST /api/super-admin/tenants
Body: {
  name: string
  slug: string (único, ej. "aglos", "flores-inc")
  billingEmail: string
  plan: "FREE" | "PRO" | "ENTERPRISE"
}
Response: { tenantId, slug, createdAt }
```

#### Listar Tenants
```
GET /api/super-admin/tenants
  ?status=ACTIVE
  &page=1
  &limit=50
Response: [
  {
    id, name, slug, status, plan,
    userCount, productCount, orderCount,
    monthlySpend, planEndDate
  }
]
```

#### Obtener Detalles de Tenant
```
GET /api/super-admin/tenants/:tenantId
Response: {
  id, name, slug, status, plan, timezone,
  logoUrl, primaryColor, ...,
  memberships: [{ user, role, joinedAt }],
  usage: { apiCalls, storage, openrouterCost },
  invoices: [{ period, totalAmount, status }]
}
```

#### Actualizar Tenant
```
PATCH /api/super-admin/tenants/:tenantId
Body: {
  plan?: Plan,
  status?: "ACTIVE" | "SUSPENDED",
  monthlyLimit?: number,
  primaryColor?: string,
  ...
}
```

#### Borrar Tenant
```
DELETE /api/super-admin/tenants/:tenantId
⚠️ Cascada en PostgreSQL: borra todo (productos, órdenes, clientes)
```

### 3.3 Endpoints de Branding

#### Actualizar Branding (Admin del Tenant)
```
PATCH /api/tenants/:tenantId/branding
Body: {
  logoUrl: string (URL o base64)
  primaryColor: hex
  secondaryColor: hex
  accentColor: hex
  fontFamily: string
  customDomain: string
}
Requiere: role ADMIN en ese tenant
```

#### Obtener Branding
```
GET /api/branding/:tenantSlug
Response: { colors, logo, font, customDomain }
Sin autenticación (público, para cargar tema en frontend)
```

### 3.4 Endpoints de Integración

#### Guardar API Key de OpenRouter
```
POST /api/tenants/:tenantId/integrations/openrouter
Body: {
  apiKey: string
  baseUrl?: string
}
Requiere: ADMIN del tenant
Encription: apiKey se encripta con KMS (AWS) o libsodium antes de guardar
```

#### Listar Integraciones
```
GET /api/tenants/:tenantId/integrations
Response: [
  { type, isActive, createdAt, createdBy }
]
Nota: apiKey no se devuelve (secreto)
```

#### Testear Integración
```
POST /api/tenants/:tenantId/integrations/:type/test
Response: { success: true, message: "Conectado a OpenRouter" }
```

### 3.5 Cambios en Config de Agente

```typescript
// apps/agent-v2/app/config.py

class Settings:
  # Global (por defecto, fallback)
  openrouter_key: str = os.getenv("OPENROUTER_KEY_REF", "")
  
  # Tenant-específico (sobrescribe global si existe)
  def get_tenant_openrouter_key(tenant_id: str) -> str | None:
    # Buscar en DB: TenantIntegration where type=OPENROUTER
    # Si existe, desencriptar y devolver
    # Si no, usar global
    pass
```

### 3.6 Middleware para Inyectar OpenRouter Key

```typescript
// En main.ts del agent-service o en middleware middleware del commerce-api

async function getTenantIntegration(tenantId: string, type: string) {
  const integration = await db.tenantIntegration.findUnique({
    where: { tenantId_type: { tenantId, type } }
  });
  
  if (integration && integration.isActive) {
    return decrypt(integration.apiKey);  // libsodium or KMS
  }
  
  // Fallback a env var global
  return process.env[`${type}_KEY`];
}
```

---

## 4. CAMBIOS EN FRONTEND (Next.js)

### 4.1 Nuevo Módulo: Super-Admin Dashboard

**Rutas:**
```
/super-admin/                     # Dashboard (lista de tenants)
/super-admin/tenants/new          # Crear tenant
/super-admin/tenants/:tenantId    # Detalles, editar
/super-admin/tenants/:tenantId/users
/super-admin/tenants/:tenantId/billing
/super-admin/analytics            # Consolidado: ingresos, usuarios, etc.
```

**Pantalla: Listar Tenants**
- Tabla: nombre, slug, plan, estado, usuarios, productos, órdenes, gasto mensual
- Filtros: plan, estado, fecha creación
- Acciones: editar, suspender, ver detalles, ver usuarios
- Crear tenant: botón → formulario modal

**Pantalla: Crear Tenant**
- Formulario: nombre, slug, email de billing, plan inicial
- Validación: slug único, email válido
- Confirmar: envía POST /api/super-admin/tenants
- Resultado: muestra tenantId, invite link para primer admin

**Pantalla: Detalles de Tenant**
- Info: name, slug, plan, estado, creado hace X días
- Métricas: usuarios activos, productos, órdenes este mes, gasto OpenRouter
- Acciones: cambiar plan, suspender, editar configuración
- Historial: cambios de plan, suspensiones, etc.

**Pantalla: Usuarios del Tenant (Super-Admin)**
- Listar memberships: email, rol, estado, última actividad
- Resetear contraseña: genera link temporal (sin email)
- Cambiar rol: dropdown ADMIN → GESTOR, etc.
- Suspender usuario: checkbox
- Auditar: quién hizo qué en el tenant

**Pantalla: Billing**
- Plan actual, próxima facturación, métodos de pago
- Historial de invoices: mes, monto, estado, descargar PDF
- Estimado de gasto: APIcalls, storage, OpenRouter
- Alertas: "vas a exceder límite en X días"

### 4.2 Contexto de Autenticación

```typescript
// pages/api/auth/[...nextauth].ts

// Super-admin: user con membership en PLATFORM_TENANT_ID
// Admin de tenant: user con role ADMIN en un tenant específico
// Usuario normal: user con role GESTOR/AGENTE/LECTOR

// En sesión:
session.user.memberships = [
  { tenantId: "aglos-uuid", tenantSlug: "aglos", role: "ADMIN" },
  { tenantId: "flores-uuid", tenantSlug: "flores", role: "GESTOR" },
  { tenantId: "PLATFORM", tenantSlug: "platform", role: "SUPER_ADMIN" }
]

// En componentes:
const isSuperAdmin = session.user.memberships.some(m => m.role === "SUPER_ADMIN");
const currentTenant = router.query.tenantId; // si estamos en /tenants/:tenantId
const hasAdminInTenant = session.user.memberships.find(m => 
  m.tenantId === currentTenant && m.role === "ADMIN"
);
```

### 4.3 Selector de Tenant

```typescript
// Componente global: dropdown en header
// Si super-admin: mostrar "Super Admin" + dropdown de tenants
// Si admin de 1+ tenants: mostrar tenant actual + dropdown
// Si usuario normal: solo mostrar tenant actual (no dropdown)

// En navbar:
<TenantSwitcher 
  memberships={session.user.memberships}
  currentTenant={currentTenant}
  isSuperAdmin={isSuperAdmin}
/>
```

### 4.4 Customización de Branding

```typescript
// hooks/useBranding.ts
export const useBranding = (tenantSlug: string) => {
  const [branding, setBranding] = useState(null);
  
  useEffect(() => {
    fetch(`/api/branding/${tenantSlug}`)
      .then(r => r.json())
      .then(setBranding);
  }, [tenantSlug]);
  
  return branding;
};

// En _app.tsx:
const { branding } = useBranding(tenantSlug);

if (branding) {
  document.documentElement.style.setProperty(
    '--color-primary', 
    branding.primaryColor
  );
  document.documentElement.style.setProperty(
    '--color-secondary', 
    branding.secondaryColor
  );
}
```

### 4.5 Admin Panel Mejorado

**Gestión de Usuarios (por Admin del Tenant)**
```
/tenants/:tenantId/settings/users
- Listar usuarios del tenant
- Invitar nuevo: email + rol
- Editar rol: ADMIN, GESTOR, AGENTE, LECTOR
- Suspender usuario
- Resetear contraseña (sin email, muestra link temporal)
```

**Gestión de Integraciones**
```
/tenants/:tenantId/settings/integrations
- OpenRouter: pegar API key, testear
- Stripe (futuro): pegar credenciales
- Validación: POST /tenants/:tenantId/integrations/:type/test
```

**Configuración Avanzada**
```
/tenants/:tenantId/settings/branding
- Upload logo
- Color picker: primario, secundario, acento
- Font selector
- Custom domain (si está habilitado en plan)

/tenants/:tenantId/settings/advanced
- Zona horaria, moneda
- Almacenamiento: mostrar uso actual vs. límite
- API keys para integraciones externas (generar, revocar)
```

---

## 5. CAMBIOS EN BOT (Python/FastAPI)

### 5.1 Inicialización: Buscar Integración por Tenant

```python
# apps/agent-v2/app/config.py

async def get_agent_config(tenant_id: str) -> Settings:
    """Cargar configuración específica del tenant."""
    
    # 1. Config global (fallback)
    settings = get_settings()
    
    # 2. Buscar OpenRouter key del tenant en DB
    integration = await db.tenant_integration.find_unique(
        where={
            "tenantId_type": {
                "tenantId": tenant_id,
                "type": "OPENROUTER"
            }
        }
    )
    
    if integration and integration.is_active:
        settings.openrouter_key = decrypt(integration.api_key)
        settings.openrouter_base_url = integration.metadata.get(
            "base_url", 
            "https://openrouter.ai/api/v1"
        )
    
    return settings
```

### 5.2 Endpoint /chat: Pasar tenant_id

```python
@app.post("/chat/{tenant_id}")
async def chat(tenant_id: str, request: ChatRequest):
    """
    tenant_id viene de header o path
    Buscar integración, cargar config, ejecutar agente
    """
    
    config = await get_agent_config(tenant_id)
    model = build_model(config)
    agent = build_agent(model, tenant_id=tenant_id)
    
    # Ejecutar conversación
    response = await agent.invoke({...})
    
    return response
```

### 5.3 Tracking de Costos

```python
# apps/agent-v2/app/usage.py

async def track_openrouter_usage(
    tenant_id: str, 
    tokens_in: int, 
    tokens_out: int,
    model: str
):
    """Registrar uso de OpenRouter para billing."""
    
    # Calcular costo (ej. Claude: $0.003/1K in, $0.015/1K out)
    cost_in = tokens_in * PRICE_PER_TOKEN[model]["in"]
    cost_out = tokens_out * PRICE_PER_TOKEN[model]["out"]
    total_cost = (cost_in + cost_out) / 1000
    
    # Guardar en TenantUsage (period: 2026-09)
    period = datetime.now().strftime("%Y-%m")
    
    await db.tenant_usage.upsert(
        where={"tenantId_period": {tenant_id, period}},
        update={"openrouterTokens": {...}, "openrouterCost": {...}},
        create={...}
    )
```

### 5.4 Fallback a Motor Determinista

```python
# Si OpenRouter API key no es válida o servicio cae:

try:
    response = await llm.invoke(...)
except (AuthenticationError, APIError, TimeoutError):
    # Fallback: motor determinista
    logger.warning(f"OpenRouter failed for {tenant_id}, using fallback")
    response = deterministic_agent(...)
```

---

## 6. AISLAMIENTO DE DATOS (Revisión)

### ✅ SEGURO: Aislamiento por Tenant

#### SQL
- Cada tabla tiene `tenant_id`
- FK compuesta: `UNIQUE(tenant_id, id)`
- Todas las consultas: `WHERE tenant_id = :tenant_id`
- No hay cross-tenant queries

**Ejemplo:**
```sql
-- Usuario A (tenant aglos) NO puede ver órdenes de usuario B (tenant flores)

SELECT * FROM orders 
WHERE tenant_id = 'aglos-uuid' 
AND customer_id = 'cust123';

-- Si user intenta:
SELECT * FROM orders WHERE id = 'order-from-flores-uuid';
-- Sin WHERE tenant_id: RECHAZADO por Prisma middleware
```

#### Middleware en Backend
```typescript
// prisma/middleware.ts
prisma.$use(async (params, next) => {
  // Inyectar tenant_id en donde = {...}
  const userTenant = context.user.tenantId;
  
  if (params.action === "findMany") {
    params.args.where = { ...params.args.where, tenantId: userTenant };
  }
  
  return next(params);
});
```

#### Autenticación
- Session vinculada a tenant en cada request
- Membership valida role en ese tenant
- API key del tenant en header: `X-API-Key: npk_aglos_...`

### ⚠️ NECESITA CUIDADO

#### Storage (MinIO)
- Objetos por tenant: bucket `uploads-aglos/`, `uploads-flores/`
- O: prefijo en bucket: `s3://uploads/aglos/productos/...`
- Validar en GET: `/images/:tenantId/:objectKey`

**Actual:** No hay segregación de storage. Todos los archivos en mismo bucket.
**Riesgo:** Acceso directo a URL de imagen de otro tenant.
**Solución:** 
```typescript
// Middleware en MinIO
// GET /uploads/:tenantId/:key
// Validar tenantId en path = tenantId en sesión
```

#### Conocimiento del Agente
- Almacenado en filesystem: `apps/agent-service/knowledge/`
- Particionado por tenant en teoría
- **Riesgo**: si dos tenants tienen `negocio.md`, pueden pisarse

**Actual:** Cargas todos los Markdown del directorio.
**Necesario:**
```python
# knowledge_dir = f"/knowledge/{tenant_id}/negocio.md"
# O en DB: guardar Markdown en tabla, indexado por tenant_id

@app.post("/knowledge/{tenant_id}/reload")
async def reload_knowledge(tenant_id: str):
    # Cargar solo archivos de ese tenant
    docs = load_knowledge_for_tenant(tenant_id)
    update_index(tenant_id, docs)
```

#### Logs y Auditoría
- `AuditLog` tiene `tenantId`: ✅ Seguro
- Pero si alguien accede a DB directo, ve todos los tenants
- **Solución:** Encriptación en BD de datos sensibles (PII), acceso RBAC en nivel DB

#### Webhooks
- WhatsApp webhook: `/webhooks/whatsapp/{tenantId}`
- Validar firma HMAC + tenantId en payload
- **Riesgo**: si alguien conoce URL de otro tenant, puede enviar fake messages

**Solución:**
```python
# Firmar webhook con HMAC usando tenant-specific secret
# Validar firma antes de procesar

def verify_webhook(tenant_id: str, signature: str, payload: str):
    secret = await get_integration_secret(tenant_id, "WHATSAPP")
    computed = hmac.new(secret, payload, hashlib.sha256).hexdigest()
    assert computed == signature
```

---

## 7. PLAN DE IMPLEMENTACIÓN

### Fase 1: Base de Datos (1-2 semanas)

```
1. Ampliar Tenant model
   - Agregar campos: branding, plan, limits, billing
2. Crear TenantIntegration table
   - Guardar OpenRouter key por tenant
3. Crear TenantUsage, BillingInvoice tables
4. Migration: datos de single-tenant → primer tenant nuevo
   - Copiar productos, órdenes, clientes a tenant "default"
5. Backup antes de cada step
```

### Fase 2: Backend (2-3 semanas)

```
1. Endpoints /super-admin/tenants
   - Crear, listar, obtener, actualizar, borrar
2. Endpoints /tenants/:id/branding
   - Guardar y servir colores/logo
3. Endpoints /tenants/:id/integrations
   - Guardar OpenRouter key encriptado
4. Middleware de validación
   - Inyectar tenant_id, validar acceso
5. Tracking de uso (TenantUsage)
6. Billing: generar invoices automáticas (cron job)
7. Tests: multi-tenant isolation
```

### Fase 3: Frontend (2-3 semanas)

```
1. Super-admin dashboard
   - Listar tenants, crear, editar
2. Selector de tenant en navbar
3. Customización de branding
   - Color picker, logo upload
4. Admin mejorado: usuarios, integraciones, branding
5. Billing dashboard
   - Plan actual, invoices, gasto
6. Tests E2E: navegar entre tenants, aislar datos
```

### Fase 4: Bot (1-2 semanas)

```
1. Cargar config OpenRouter del tenant
2. Tracking de tokens/costos
3. Cron job: generar alertas de gasto
4. Fallback: si sin OpenRouter key, usar determinista
5. Tests: múltiples tenants, APIs keys diferentes
```

### Fase 5: Operaciones (1 semana)

```
1. Documentación para super-admin
2. Playbook: crear tenant, invitar admin, resetear contraseña
3. Alertas: tenant suspendido, gasto excedido, API error
4. Monitoreo: queries por tenant, storage por tenant
5. Backup por tenant (si escalamos)
```

---

## 8. IMPLICACIONES TÉCNICAS

### Escalabilidad

**Actual (Single-Tenant):**
- Una base de datos, un servidor bot, todo mezclado
- Si cae el servidor, cae todo el negocio

**Multi-Tenant:**
- **Ventaja**: un solo servidor bot sirve a N tenants (costos bajos)
- **Desventaja**: fallos compartidos (si API OpenRouter cae, cae todo)
- **Solución**: separar por plan (Free → compartido, Enterprise → instancia dedicada)

### Costos

**OpenRouter:**
- Actualmente: 1 API key global
- Problema: no se sabe cuánto gasta cada cliente
- Solución: meter API key del cliente → facturable, visible, controlable

**Storage:**
- Actual: 1 bucket MinIO
- Multi-tenant: 1 bucket con segregación por prefix o buckets separados
- Costo por storage: trackear uso, incluir en invoice

**Base de Datos:**
- Actual: compartida
- Multi-tenant: agregar índices en `tenant_id` (optimización)
- Considerar: particionamiento por tenant si crece (schema per tenant)

### Performance

**Queries:**
- Todas deben filtrar por `tenant_id` (index composite)
- Sin esto: slow queries
- Test: explicar queries, validar index usage

**Caché:**
- Redis: segregar por tenant (key = `{tenant_id}:{resource}`)
- Ejemplo: `aglos:products:list`

**Parallelismo:**
- Varios tenants → múltiples conexiones DB
- Pool de conexiones: `max_connections = 100` → 50 tenants con 2 conn/tenant

---

## 9. SEGURIDAD

### Encriptación

**API Keys de Terceros**
- Guardar encriptadas en DB
- Claves en AWS KMS o local (libsodium)
- Nunca loggear plaintext

**PII (Números de Teléfono, RFC)**
- Opcional: encriptar en reposo
- Mínimo: HTTPS en tránsito

**Facturas**
- Enlace de descarga: token temporal (expire en 1 día)
- Acceso: solo usuario que creó o super-admin

### RBAC (Role-Based Access Control)

```
SUPER_ADMIN
  - Ver/editar todos los tenants
  - Ver uso y billing consolidado
  - Aprobar tenants nuevos

ADMIN (del tenant)
  - Ver/editar datos del tenant (config, branding, integrations)
  - Invitar/remove usuarios
  - Ver billing (invoices, uso actual)
  - NO puede cambiar plan (solo super-admin)

GESTOR (del tenant)
  - Órdenes, clientes, cotizaciones (CRUD)
  - Ver reportes de venta
  - NO puede editar configuración

AGENTE (del tenant)
  - Solo lectura + chat
  
LECTOR (del tenant)
  - Solo lectura de reportes
```

### Validación de Entrada

```
- Slug de tenant: ^[a-z0-9-]{3,50}$
- Colores: validar hex #000000 a #ffffff
- API keys: validar formato (ej. sk-... para OpenRouter)
- Emails: RFC 5322
```

---

## 10. MIGRACIÓN DESDE SINGLE-TENANT

### Paso 1: Backup

```bash
pg_dump netpay_plane > backup_2026_09_09.sql
```

### Paso 2: Agregar Tenant Inicial

```sql
INSERT INTO "Tenant" (id, slug, name, status, timezone, ...)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'default',
  'NetPay Plane Default',
  'ACTIVE',
  'America/Mexico_City',
  ...
);
```

### Paso 3: Migrar Datos Existentes

```sql
-- Agregar tenant_id a todas las filas existentes
UPDATE "Product" SET tenant_id = '00000000-0000-0000-0000-000000000001';
UPDATE "Customer" SET tenant_id = '00000000-0000-0000-0000-000000000001';
UPDATE "Order" SET tenant_id = '00000000-0000-0000-0000-000000000001';
-- ... para todas las tablas
```

### Paso 4: Agregar Usuario Inicial como SUPER_ADMIN

```sql
INSERT INTO "Membership" (id, tenant_id, user_id, role, status)
VALUES (
  uuid_generate_v4(),
  '00000000-0000-0000-0000-000000000001',  -- PLATFORM tenant
  '{admin_user_id}',
  'SUPER_ADMIN',
  'ACTIVE'
);
```

### Paso 5: Testear

```
- Login con usuario SUPER_ADMIN
- Crear tenant nuevo (test)
- Cambiar producto de "default" a "test"
- Verificar aislamiento: usuario de "test" no ve productos de "default"
```

---

## 11. GESTIÓN DE USUARIOS POR ADMIN

### Crear Usuario (desde Admin)

```
Admin abre /tenants/:id/settings/users → "Invitar usuario"
- Email
- Rol (ADMIN, GESTOR, AGENTE, LECTOR)
- Hacer clic "Enviar invitación"

Backend:
1. Crear Invitation record (token temporal, 7 días)
2. Enviar email con enlace de registro:
   /register?token={invitation_token}
3. Usuario abre, crea contraseña, activa 2FA
4. Membership se marca como ACTIVE
```

### Resetear Contraseña (desde Admin)

```
Admin abre /tenants/:id/settings/users → usuario → "Resetear contraseña"

Backend:
1. Crear PasswordResetToken (temporal, 1 hora)
2. NO enviar email (por si no está configurado)
3. Mostrar enlace temporal al admin:
   /reset-password?token={reset_token}
4. Mostrar QR o copiar link → enviar manualmente al usuario
```

### Cambiar Rol (desde Admin)

```
Dropdown en users list: AGENTE → GESTOR
Requiere: confirm (¿estás seguro?)
Audit log: "Admin cambió rol de X de AGENTE a GESTOR"
```

### Suspender Usuario (desde Admin)

```
Checkbox "Suspender usuario"
Efectos:
- Session se invalida inmediatamente
- No puede volver a loguearse
- En auditoría: quién y cuándo suspendió
```

---

## 12. LIMITACIONES Y CONSIDERACIONES

### Posibles Problemas

| Problema | Solución |
|----------|----------|
| Dos tenants piden mismo dominio custom | Validar uniqueness en endpoint, error claro |
| Tenant A ve webhooks de tenant B | Filtrar en query: `WHERE tenant_id = :tenant_id` |
| Admin cambia API key OpenRouter, rompe bot | Hacer test de conexión antes de guardar |
| Facturación: cálculo incorrecto de tokens | Usar tabla TenantUsage como fuente de verdad, no logs |
| Tenant borra todas sus órdenes (GDPR) | Registrar en auditoría, hacer backup antes |
| Colapso de DB por muchos tenants | Monitoreo de queries lentas, índices, read replicas |

### Escalas Futuras

**Si 100+ tenants:**
- Considerar "schema per tenant" en PostgreSQL
- Read replicas por región
- Caché distribuido (Redis cluster)
- Facturación: integración Stripe via webhooks

**Si 1000+ tenants:**
- Multi-region (DB replication)
- Sharding de datos históricos (old orders to archive DB)
- Separar: analytics DB vs. operational DB

---

## 13. CHECKLIST FINAL

### Base de Datos
- [ ] Ampliar Tenant model (branding, plan, limits, billing fields)
- [ ] Crear TenantIntegration table
- [ ] Crear TenantUsage table
- [ ] Crear BillingInvoice table
- [ ] Agregar índices: `(tenant_id, created_at)`
- [ ] Testear FK constraints
- [ ] Migration + rollback script

### Backend
- [ ] Endpoints /super-admin/tenants CRUD
- [ ] Endpoints /tenants/:id/branding
- [ ] Endpoints /tenants/:id/integrations
- [ ] Middleware: inyectar tenant_id
- [ ] Guard: validar membership
- [ ] Encriptación de API keys (libsodium)
- [ ] Tracking de costos (TenantUsage)
- [ ] Cron: generar invoices
- [ ] Tests: 30+ casos de aislamiento multi-tenant
- [ ] Error handling: tenant no existe, suspendido, etc.

### Frontend
- [ ] Super-admin dashboard (tenants list)
- [ ] Create tenant form
- [ ] Tenant details (info, users, billing)
- [ ] Branding customizer
- [ ] User manager (invite, resetear contraseña, rol, suspender)
- [ ] Integrations manager (OpenRouter key)
- [ ] Selector de tenant en navbar
- [ ] Tests E2E: navegar entre tenants

### Bot
- [ ] Cargar OpenRouter key del tenant
- [ ] Tracking de tokens/costos
- [ ] Fallback a motor determinista
- [ ] Cron: alerta si gasto > límite
- [ ] Tests: múltiples tenants

### Operaciones
- [ ] Playbook: crear tenant, invitar admin
- [ ] Alertas: tenant suspendido, gasto, API error
- [ ] Monitoreo: queries, storage, uptime por tenant
- [ ] Disaster recovery: restore tenant specific data
- [ ] Documentación: super-admin, RBAC, SLAs

---

## 14. CONCLUSIÓN

NetPay Plane ya tiene **base sólida de multi-tenancy** (FK, aislamiento SQL, roles). Falta:

1. **Dashboard de Super-Admin** para crear/gestionar tenants
2. **Branding por tenant** (colores, logo)
3. **OpenRouter API key por tenant** (seguridad, facturación)
4. **Billing** (planes, invoices, límites)
5. **Gestión de usuarios mejorada** (invite, resetear contraseña, suspender)
6. **Segregación de storage** (MinIO, conocimiento del agente)

Con estos cambios: **SaaS multi-tenant completamente funcional**, listo para vender a múltiples empresas, con aislamiento robusto, facturación automática y control total del admin.

**Costo estimado:** 8-12 semanas, 2-3 engineers.

---

**Última actualización:** 9 de septiembre de 2026  
**Versión:** Análisis v1.0
