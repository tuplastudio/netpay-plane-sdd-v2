# SPEC-IAM — Identidad, empresa, permisos y credenciales

Versión: 2.0. Estado: especificado; implementación pendiente.

## Casos de uso y datos

Alta inicial mediante comando de bootstrap ejecutado por operación: crea tenant, propietario e invitación de un solo uso. No existe registro público de comercios en V2. El propietario invita usuarios por email; token hasheado, válido 48 h. Login con email/password; hash Argon2id con parámetros calibrados y guardados. Recuperación devuelve respuesta uniforme, token de 30 min y un solo uso; al cambiar password invalida sesiones previas.

Sesión opaca en cookie `__Host-session`, Secure, HttpOnly, Path=/ y SameSite=Lax; TTL absoluto 12 h, inactividad 30 min. Protección CSRF en mutaciones y rotación tras login/cambio de tenant. MFA TOTP requerido para propietario/administrador/finanzas; challenge 5 min, códigos de recuperación hasheados de un solo uso. Rate limit inicial login: 5 intentos/15 min por cuenta e IP con bloqueo temporal, sin revelar si la cuenta existe.

Membership une usuario/tenant/rol. No borrar al último propietario ni permitir que el administrador se asigne permisos de propietario. Alta y cambio de rol requieren sesión reciente de menos de 10 min. API keys incluyen prefijo público para lookup, hash secreto, scopes, expiraAt y revocaAt; secret visible solo al crear. `agent-service` recibe credencial interna por empresa/ejecución con herramientas permitidas, no key administrativa del usuario.

## Matriz normativa

| Operación | Propietario | Admin | Vendedor | Finanzas | Catálogo | Atención | Consulta |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Usuarios/credenciales/canales | Sí | Según scope, sin propietario | No | No | No | No | No |
| Catálogo editar | Sí | Sí | No | No | Sí | No | No |
| Cotizar/cobro rápido | Sí | Sí | Sí | No | No | No | No |
| Leer pedidos | Sí | Sí | Sí | Sí | No | Sí | Sí |
| Cancelar no pagado | Sí | Sí | Propios | No | No | No | No |
| Reembolsar simulado | Sí | No por defecto | No | Sí | No | No | No |
| Atención chat | Sí | Sí | Sí | No | No | Sí | No |
| Exportar financiero | Sí | No por defecto | No | Sí | No | No | No |
| Auditoría | Sí | Sí | No | Financiera | No | No | No |

Permisos asignados por rol almacenados; atributos como `createdBy` y `assignedTo` restringen recursos. En V2 vendedor puede leer ventas del tenant, pero solo cancelar propias. Consultas de clientes requieren `customers.read`, no se habilitan por tener acceso público a un pedido.

## Configuración empresarial

Versionar marca, contacto, zona horaria, condiciones, retiro, costo envío, vigencias y descuentos. Guardar documento comercial con configVersion para reconstruir. Cambio de configuración afecta operaciones nuevas; no recalcula automáticamente documentos aceptados. Deshabilitar tenant bloquea nuevas ventas y acceso de usuarios; deja activos recepción de webhooks y conciliación pendientes con principal de sistema.

## Requisitos, tareas y aceptación

### REQ-IAM-01 / T-IAM-01 — Bootstrap y autenticación

**Regla normativa:** Nadie accede al portal sin identidad y membership activas.

**Trabajo específico:** Crear bootstrap idempotente, login/logout, sesión opaca, password hashing y elección segura de tenant. Separar respuesta de cuenta deshabilitada sin revelar datos.

**Entregable esperado:** auth module, sessions table y scripts/bootstrap-tenant.

**Dependencias:** T-FND-06.

**AC-IAM-01 — prueba de aceptación:** Login válido abre tenant asignado; contraseña incorrecta o membership deshabilitada no abre sesión; logout invalida cookie en servidor.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-IAM-01. Estado inicial: `TODO`.

### REQ-IAM-02 / T-IAM-02 — Recuperación y MFA

**Regla normativa:** Tokens de recuperación y MFA no pueden reutilizarse.

**Trabajo específico:** Implementar invite/accept, forgot/reset, expiraciones y TOTP con recovery codes; invalidar sesiones al cambiar password y proteger cambios sensibles con recent-auth.

**Entregable esperado:** auth endpoints y pantallas de desafío y recuperación.

**Dependencias:** T-IAM-01.

**AC-IAM-02 — prueba de aceptación:** Reset usado dos veces falla; MFA de administrador es obligatorio; código de recuperación usado deja de funcionar.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-IAM-02. Estado inicial: `TODO`.

### REQ-IAM-03 / T-IAM-03 — Aplicar matriz de permisos

**Regla normativa:** La matriz se ejecuta en servidor y limita cada recurso.

**Trabajo específico:** Crear permission guard y políticas own/tenant; impedir quitar último owner; testear roles con fixtures. Separar permisos de lectura financiera y exportación.

**Entregable esperado:** authorization policies, roles seed y pruebas parametrizadas.

**Dependencias:** T-IAM-02.

**AC-IAM-03 — prueba de aceptación:** Vendedor no reembolsa ni cancela pedido ajeno; catálogo no accede a pagos; cross-tenant responde 404.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-IAM-03. Estado inicial: `TODO`.

### REQ-IAM-04 / T-IAM-04 — Administrar empresa y usuarios

**Regla normativa:** Un cambio no altera configuraciones históricas.

**Trabajo específico:** Crear lectura/actualización con expectedVersion, validación IANA y límites; invitación, desactivar membership, control último propietario y snapshots de condiciones.

**Entregable esperado:** tenant settings, memberships API y config versions.

**Dependencias:** T-IAM-03.

**AC-IAM-04 — prueba de aceptación:** Dos ediciones paralelas producen 409 para una; cotización anterior conserva condiciones y timezone originales.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-IAM-04. Estado inicial: `TODO`.

### REQ-IAM-05 / T-IAM-05 — Gestionar API keys e identidad de servicios

**Regla normativa:** Una key revocada deja de autorizar inmediatamente.

**Trabajo específico:** Crear/listar/revocar claves con scopes limitados, cuotas y máscara; credenciales internas con audiencia/expiración y contexto inyectado; jamás guardar secret en logs.

**Entregable esperado:** api-credentials module y middleware de principal técnico.

**Dependencias:** T-IAM-04.

**AC-IAM-05 — prueba de aceptación:** Misma key no funciona tras revocar; scope products.read no crea quote; agente no solicita herramienta fuera de su lista.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-IAM-05. Estado inicial: `TODO`.

### REQ-IAM-06 / T-IAM-06 — Aislar persistencia y auditoría

**Regla normativa:** Tenant se valida también en jobs, caché y SQL.

**Trabajo específico:** Aplicar repositorios tenant-aware, RLS con SET LOCAL y reset seguro en pool, eventos de auditoría en comandos sensibles y pruebas de dos empresas.

**Entregable esperado:** tenant isolation suite, RLS migrations y audit writer.

**Dependencias:** T-IAM-05.

**AC-IAM-06 — prueba de aceptación:** Reutilizar conexión SQL de A para B no filtra filas; job con recurso de A y contexto B falla sin mutar.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-IAM-06. Estado inicial: `TODO`.
