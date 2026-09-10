# NetPay Plane — Features Completo

Plataforma de catálogo, cotizaciones, pedidos, checkout, pagos y agente de IA integrado. Multitenante, por WhatsApp, web y API.

---

## 1. PLATAFORMA WEB (Next.js + Shadcn UI)

### 1.1 Inicio / Dashboard (`/`)

**Propósito:** Pantalla principal de la plataforma. Datos consolidados del negocio en un vistazo.

**Features:**
- Resumen de ventas (últimas 24h, últimos 7 días, últimos 30 días)
- Estado de órdenes en tiempo real (pendientes, en proceso, completadas, canceladas)
- Notificaciones de actividad reciente (nuevas órdenes, pagos recibidos, mensajes en WhatsApp)
- Acceso rápido a módulos principales (catálogo, clientes, cotizaciones, órdenes)
- Información de cuenta del tenant (nombre empresa, zona horaria, tipo de plan)

---

### 1.2 Catálogo (`/catalog`)

**Propósito:** Gestión completa del inventario de productos y variantes.

**Features Principales:**

#### Listado de Productos
- Visualización en tabla o card con búsqueda, filtros y ordenamiento
- Columnas: nombre, SKU, precio unitario, existencia, estado (activo/inactivo), última actualización
- Edición en lote (cambiar precio, estado, existencia a múltiples productos)
- Importación/exportación CSV

#### Crear Producto
- Nombre, descripción larga, categoría, marca
- Código SKU y código de barras (EAN)
- Precio base (neto sin impuesto)
- Existencia inicial
- Imágenes (subida a MinIO, mostrará en chat y cotizaciones)
- Selector de variantes predefinidas o crear nuevas on-the-fly

#### Variantes
- Cada producto puede tener múltiples variantes (tamaño, color, presentación)
- Ejemplo: Pintura 2000 en 4 LT, 19 LT, 200 LT
- Cada variante: SKU independiente, precio específico, existencia, atributos
- Etiqueta de línea marca propia (AGLOSIVO, COLORÍSIMO, KORA KONTROL, etc.)

#### Búsqueda y Découvery
- Búsqueda por nombre, SKU, categoría
- Filtros: marca, existencia (bajo stock, agotado, disponible), precio range
- Trending: productos más consultados por el bot

---

### 1.3 Chat con Bot Conversacional (`/chat`)

**Propósito:** Área de prueba donde los usuarios (equipo interna y clientes de prueba) conversan con el agente.

**Features:**

#### Conversación en Tiempo Real
- Interfaz chat: historial de mensajes, entrada de texto, botones de acción rápida
- Simulación de cliente real (selecciona rol: distribuidor, pintor, público en general)
- El bot responde con: búsqueda de productos, cotización, propuestas de envío, formas de pago

#### Integraciones en el Chat
- **Búsqueda de productos**: usuario pide "pintura mate base agua 19 litros" → bot busca en catálogo y muestra opciones
- **Carrito dinámico**: el bot agrega artículos a medida que el cliente pide; muestra resumen de cantidad y precio
- **Cotización automática**: calcula totales con impuestos, costos de envío, descuentos si aplican
- **Recordar cliente**: si el bot reconoce al cliente (por teléfono, email), carga su historial de compras y direcciones
- **Emitir cotización**: genera un enlace público de cotización que el cliente puede compartir
- **Escalamiento a humano**: si el bot no puede responder (casos especiales, distribuidor, promociones), crea un ticket para hablar con una persona
- **Transcripción de audio**: cliente puede enviar nota de voz; bot transcribe y responde (opcional, requiere API)

#### Estado del Bot
- Panel de debug integrado: muestra qué modelo está usando, herramientas disponibles, conocimiento cargado
- Historial de evaluaciones (test suite): resultados de pruebas automatizadas sobre respuestas correctas

---

### 1.4 Cotizaciones (`/quotes`)

**Propósito:** Historial y gestión de todas las cotizaciones generadas (por el bot o manualmente).

**Features:**

#### Listado de Cotizaciones
- Columnas: ID, cliente, monto total, estado (pendiente, aceptada, rechazada, expirada), fecha de emisión, fecha de vencimiento
- Filtros: por estado, rango de fechas, cliente, monto
- Búsqueda por ID de cotización o nombre de cliente

#### Vista Detallada de Cotización
- Líneas de producto: descripción, cantidad, precio unitario, subtotal
- Detalles de envío: dirección, modo (pickup/delivery), costo
- Detalles de cliente: nombre, teléfono, email, dirección de facturación
- Impuestos y totales: subtotal, impuesto (16% en MX por defecto), envío, descuento (si aplica), total final
- Notas (comerciales, observaciones del equipo)
- Enlace público para compartir con cliente (acceso de solo lectura con botón "Aceptar" o "Rechazar")

#### Renovación de Cotización
- Si expiró (plazo configurable, por defecto 7 días), ofrecimiento de renovarla
- Crear cotización similar a partir de una anterior
- Duplicar cotización para cliente distinto

#### Integración con Órdenes
- Cuando cliente acepta cotización, se convierte en orden
- Seguimiento desde cotización hasta pago y entrega

---

### 1.5 Pedidos (`/orders`)

**Propósito:** Ciclo de vida completo de las órdenes de compra.

**Features:**

#### Listado de Órdenes
- Columnas: ID, cliente, monto, estado (pendiente de pago, pago confirmado, enviado, entregado, cancelado), fecha, próxima acción
- Filtros: por estado, fecha, cliente, monto
- Búsqueda por ID de orden o nombre
- Acciones en lote: cambiar estado (ej. marcar como enviado), exportar reporte, notificar cliente

#### Vista Detallada de Orden
- Misma información que cotización + histórico de cambios de estado
- Líneas: producto, cantidad, precio unitario, subtotal
- Datos de envío: dirección, modo, costo, tracking (si aplica)
- Datos de facturación: RFC, razón social, código postal, uso CFDI (configuración por cliente)
- Pagos: enlace de checkout, estado del pago, fecha de confirmación, método usado (dummy gateway en desarrollo)
- Timeline: eventos de la orden (creada, aceptada, pago confirmado, enviado, entregado, comentarios)

#### Cambios de Estado
- Creada → Pago pendiente
- Pago confirmado → Enviado (genera etiqueta de envío si aplica)
- Enviado → Entregado
- En cualquier momento: Cancelada (revertir inventario si está configurado)
- Notas y comentarios en cada transición

#### Integración con Clientes
- Historial de órdenes por cliente
- Direcciones de envío usadas anteriormente (propuesta automática)
- Términos de crédito si el cliente es distribuidor

---

### 1.6 Clientes (`/customers`)

**Propósito:** Base de datos centralizada de clientes y sus datos de contacto y compra.

**Features:**

#### Listado de Clientes
- Columnas: nombre, email, teléfono, estado (activo/inactivo), total de órdenes, total gastado, última compra
- Filtros: por estado, rango de gasto, fecha de última compra
- Búsqueda por nombre, email, teléfono
- Agregar nuevo cliente manual o importar CSV

#### Ficha de Cliente
- Datos básicos: nombre completo, email, teléfono, tipo (minorista, distribuidor, pintor, público)
- Direcciones almacenadas (múltiples): envío y facturación
- Identidad verificada: RFC (si aplica), razón social, código postal
- Consentimiento: suscripción a notificaciones, políticas aceptadas, fecha de RGPD
- Historial de compras: órdenes, cotizaciones, total gastado, ticket promedio
- Crédito (si es distribuidor): límite de crédito, saldo actual, términos
- Notas del equipo (comerciales, observaciones)
- Marcas favoritas o productos recurrentes

#### Segmentación
- Etiquetas personalizadas (VIP, mayorista, problema, etc.)
- Grupos automáticos por comportamiento (frecuencia, monto, antigüedad)

---

### 1.7 Pagos / Checkout (`/payments`)

**Propósito:** Gestión de transacciones y pasarela de pago (Dummy en desarrollo, ready para Stripe/etc.).

**Features:**

#### Listado de Sesiones de Pago
- Columnas: ID transacción, orden asociada, cliente, monto, estado (pendiente, confirmado, rechazado, reembolsado), fecha
- Filtros: por estado, rango de fechas, monto
- Búsqueda por ID de transacción

#### Detalle de Transacción
- Monto, moneda (MXN por defecto)
- Método: tarjeta (credit/debit), transferencia bancaria (en roadmap)
- Estado actual: qué pasó, en qué momento
- Timeline: intentos fallidos, confirmación, notificación
- Enlace de pago generado (público, con expiración configurable por defecto 24h)
- Cliente recibe enlace por email/WhatsApp, abre en navegador o app

#### Reembolsos
- Crear reembolso parcial o total
- Registra motivo y autorización
- Notifica cliente

#### Configuración de Pasarela
- Ambiente dummy activo (única opción permitida en desarrollo)
- Descargar configuración para cuando se migre a Stripe/PayPal/etc.

---

### 1.8 Canales (`/channels`)

**Propósito:** Integración y management de WhatsApp Business y futuros canales de venta.

**Features:**

#### WhatsApp Business
- Conexión con número de negocio (banda base credenciales: teléfono, token de acceso, webhook URL)
- Historial de conversaciones: lista de chats activos e históricos
- Sincronización bidireccional: mensajes del bot aparecen en WhatsApp, mensajes del cliente se reciben en la plataforma
- Etiquetas de conversación: pendiente, resuelto, escalado, spam
- Asignación de conversaciones a team members
- Notificaciones: nueva conversación, cliente sin respuesta, cotización aceptada
- Métricas: mensajes por día, tiempo de respuesta, tasa de resolución

#### Integración del Bot
- El bot responde de inmediato a mensajes en WhatsApp
- Si escala (solicita humano), crea un ticket visible en el dashboard
- Team members pueden tomar la conversación y responder manualmente
- El bot vuelve a tomar cuando el humano cierra el ticket

#### Webhooks
- Recepción de mensajes de WhatsApp
- Envío de notificaciones a clientes (cotización emitida, orden pagada, listo para envío)

---

### 1.9 Quick Charge (Pago Rápido) (`/quick-charge`)

**Propósito:** Generar enlaces de pago rápido sin pasar por flujo completo de cotización.

**Features:**
- Formulario simple: moneda, monto, descripción (ej. "Primer pago a cuenta")
- Genera enlace de pago único con expiración (configurable, por defecto 24h)
- Comparte por email, SMS, WhatsApp, copia enlace
- Notificación en tiempo real cuando se paga
- Registro de pago en historial del cliente si se especifica

---

### 1.10 Admin Panel (`/admin`)

**Propósito:** Configuración, usuarios, auditoría y salud del sistema.

**Features:**

#### Gestión de Usuarios y Roles
- Listado de miembros del equipo con rol (Admin, Gestor, Agente, Lector)
- Permisos por rol: Admin (todo), Gestor (ordenes, clientes, pagos), Agente (solo lectura + chat), Lector (reportes)
- Invitaciones pendientes, activación de cuentas
- Cambio de contraseña, 2FA (TOTP, códigos de recuperación)

#### Configuración del Tenant
- Datos del negocio: nombre, razón social, RFC (si aplica), logo
- Zona horaria, moneda, idioma
- Impuesto por defecto (IVA 16% en MX)
- Costo de envío (plano o variable)
- Políticas: validez de cotización (7 días), validez de pago rápido (24h), límite de descuento vendedor

#### Configuración del Agente
- Conocimiento base (upload de Markdown, recarga automática)
- Perfil del agente: nombre, tono, horario de atención
- Modelo de IA (OpenRouter, con soporte para Claude, Mistral, etc.)
- Guardarraíl de tema: palabras clave bloqueadas, respuesta cuando está fuera de tema
- Estilos de venta disponibles (cerrador, medio, suave)

#### Auditoría y Logs
- Quién hizo qué cuándo: creó producto, cambió precio, emitió cotización, confirmó pago
- Filtros: por usuario, tipo de acción, rango de fechas, entidad (orden, cliente, etc.)
- Descarga de logs para auditoría externa

#### Salud del Sistema
- Estado de servicios: API, bot, pasarela de pago, storage (MinIO), cola de tareas
- Último sync con WhatsApp
- Estadísticas: órdenes hoy, pagos confirmados, tickets sin resolver

---

## 2. BOT CONVERSACIONAL (FastAPI + LangGraph)

### 2.1 Capacidades Base

Agente de IA que vive en WhatsApp y en `/chat` de la web. Entiende el negocio (Pinturas Aglos) desde Markdown y puede:

#### Búsqueda y Recomendación de Productos
- Cliente dice: "Necesito una pintura mate base agua para interiores"
- Bot busca en el catálogo (search_products) y devuelve opciones ordenadas por relevancia: precio, existencia, marca
- Muestra imagen, descripción, presentaciones disponibles (4L, 19L, 200L), precio unitario
- Cliente puede preguntar por variante específica: "El Aglostone en 19 litros cuánto sale"

#### Cotización en Tiempo Real
- Cliente especifica cantidad y presentación
- Bot agrega al carrito y calcula:
  - Subtotal por línea
  - Total de carrito
  - Impuesto (16%)
  - Costo de envío (dirección → zona → costo)
  - Descuento (si aplica)
  - **Monto final a pagar**
- Muestra antes de confirmar
- Cliente puede agregar más productos o confirmar

#### Gestión de Carrito
- "Quita la pintura" / "Cambio cantidad a 2"
- Recalcula totales automáticamente
- Bot mantiene el carrito en la conversación (LangGraph guarda checkpoint)
- Si cliente se va y vuelve horas después, carrito persiste

#### Recordar Cliente
- Primera compra: bot pide nombre, teléfono, email
- Compras posteriores: bot reconoce por número y carga historial ("¡Hola Juan! Veo que la última vez compraste...")
- Carga direcciones previas: "¿Te envío a la dirección de siempre?" (domicilio en Culiacán)
- Recordatoria de crédito si es distribuidor

#### Emitir Cotización
- Bot genera enlace público con formato: número cotización, fecha, cliente, líneas de producto, totales
- Cliente recibe enlace por email/WhatsApp
- Enlace válido 7 días (configurable)
- Cliente puede aceptar o rechazar; si acepta, se convierte en orden

#### Procesar Orden (después de pago)
- Cliente acepta cotización y confirma envío (dirección, modo pickup/delivery)
- Bot genera orden, pide forma de pago
- Envía enlace de pago por WhatsApp/email
- Cuando pago se confirma: notifica cliente ("Tu pago fue recibido. Te enviaremos tracking cuando despachemos")
- Crea evento en auditoría

#### Escalamiento a Humano
- Cliente pide algo fuera del alcance: "¿Me dan distribuidor en Tijuana?", "¿Hay promoción en volumen?"
- Bot detecta y dice: "Voy a conectarte con un asesor"
- Crea ticket en WhatsApp/plataforma con contexto (cliente, qué pidió, carrito)
- Team member responde manualmente
- Bot pausa, humano conversa, cuando resuelven bot se puede retomar

#### Guardarraíl de Tema (No Contesta De Todo)
- Cliente: "¿Cómo cocino un ceviche?"
- Bot responde dentro de guardarraíl: "No puedo ayudarte con eso, pero si tienes dudas sobre nuestras pinturas, estoy para ayudarte"
- No intenta dar respuesta fuera del tema
- Configuración: palabras clave bloqueadas, respuesta al estar fuera de tema

#### Transcripción de Audio
- Cliente envía nota de voz
- Bot transcribe (Whisper API si está disponible)
- Responde a la trascripción
- Nota: requiere API key de OpenAI/similar

#### Síntesis de Voz (opcional)
- Bot genera respuesta en audio (Text-to-Speech)
- Cliente puede escuchar en lugar de leer
- Configuración: voz, velocidad, idioma (es-MX)

---

### 2.2 Herramientas del Bot

#### search_products(query: str, limit: int = 5) → List[Product]
- Busca productos en el catálogo
- Entrada: descripción en lenguaje natural ("pintura mate roja base agua")
- Salida: productos más relevantes con SKU, nombre, precio, existencia, imagen
- Usa búsqueda full-text + embeddings (si está configurado)

#### agregar_al_carrito(product_variant_id: str, cantidad: int) → CartLine
- Agrega línea al carrito
- Valida existencia
- Devuelve línea con precio calculado
- Si ya existe producto, suma cantidad

#### calcular_total(cart_lines: List[CartLine], delivery_mode: str = "PICKUP") → OrderTotal
- Calcula impuestos, envío, descuentos
- Devuelve: subtotal, impuesto, envío, descuento, **total final**
- Delivery_mode: "PICKUP" (retiro) o "DELIVERY" (envío a domicilio)

#### recordar_cliente(phone: str) → Customer
- Busca cliente por teléfono
- Devuelve: nombre, email, teléfono, historial de compras, direcciones, crédito (si es distribuidor)
- Si no existe: create_customer(name, phone, email)

#### emitir_cotizacion(quote_data) → {id, enlace_publico, codigo}
- Genera cotización con líneas, cliente, totales, fecha de vencimiento
- Devuelve: ID cotización, enlace para compartir (público), código para referencia rápida
- Enlace tiene formato: https://aglos.com.mx/q/{quote_id}/{share_token}

#### procesar_pago(order_id: str, monto: decimal) → CheckoutSession
- Crea sesión de pago
- Devuelve: enlace de pago (público, válido 24h), ID de transacción
- Cliente abre enlace, ingresa datos de tarjeta, se confirma automáticamente

#### request_human(reason: str, resumen: str) → Ticket
- Escala a humano
- Reason: PRECIO_ESPECIAL, CREDITO, DISTRIBUIDOR, DEVOLUCION, PROBLEMA
- Resumen: contexto para el asesor
- Devuelve ID de ticket y notifica al equipo

#### calcular_envio(address: str, mode: str = "DELIVERY") → ShippingCost
- Calcula costo de envío por dirección y modo
- Entrada: dirección completa, modo (pickup/delivery)
- Salida: costo, tiempo estimado, restricciones (ej. fuera de cobertura)

---

### 2.3 Conocimiento del Agente

Vive en Markdown en `apps/agent-service/knowledge/`. Se recarga en caliente. Particionado por tenant.

#### negocio.md
Frontmatter con identidad:
```markdown
---
negocio: Pinturas Aglos
agente: Aglost bot
tono: profesional, cercano y directo; tuteo mexicano del noroeste
idioma: es-MX
moneda: MXN
horario: Lunes a viernes de 8:00 a 17:00 y sábados de 8:00 a 13:00
cobertura: Culiacán, Sinaloa con alianzas en el norte de Sinaloa y Baja California Norte
telefono: 667 718 2178
web: https://aglos.com.mx
emoji: true
saludo: ¡Hola! Soy Aglost bot, del equipo de Pinturas Aglos 🎨
---
```

Secciones (cada `##` es un fragmento recuperable):
- **Quiénes somos**: historia, misión, visión, certificaciones
- **A quién atendemos**: pintores, carpinteros, constructoras, público general
- **Qué nos distingue**: experiencia, líneas marca propia, alianzas
- **Qué vendemos**: categorías (agua, solvente, selladores, impermeabilizantes, etc.)
- **Cobertura**: zona de atención, alianzas
- **Envíos**: política (no publica costos, bot calcula al cotizar)
- **Formas de pago**: cobro por enlace, nunca datos de tarjeta por chat
- **Promociones vigentes**: "no inventes descuentos"
- **Ser distribuidor**: requisitos y contacto con asesor
- **Devoluciones y garantía**: "casos especiales, escala con humano"
- **Facturación**: RFC, razón social, CFDI
- **Contacto**: teléfono, WhatsApp, email, dirección

#### Notas Internas
Líneas que empiezan con `> interno:` son guía para el bot, no texto para cliente:
- "No prometas fechas de envío"
- "Escala este caso a distribuidor"
- "Esta línea aún no está confirmada"

#### productos.md
Detalle de cada línea (no precios ni existencia, que vienen del catálogo):
- **Pinturas Base Agua**: 2000 (mate), PLUS (semi satinada), AGLOSTONE (contratista), MASTER, INTERIORES
- **Pinturas Base Solvente**: esmaltes alquidálicos, fondos anticorrosivos
- **Selladores**: AGLOSIVO doble función, AGLOSIVO acrílico, PREMIUM 5×1, etc.
- **Impermeabilizantes**: KORA KONTROL 3 años, KORA KONTROL 5 años
- **Cargas**: caolín, barita, carbonato de calcio (requieren cotización directa)
- **Color Integral**: pigmentos para concreto
- **Innovación**: COLORÍSIMO (igualación de color), convertidor de óxido, HIDROREPELE, masilla plástica
- **Limpieza**: línea 5VID (desinfectantes, gel antibacterial)
- **Solventes**: gasolina blanca, thinner, aguarrás, adelgazador xilol

#### preguntas-frecuentes.md
Respuestas a dudas comunes (expandible):
- ¿Qué es Pinturas Aglos?
- ¿Qué líneas manejan?
- ¿A quién venden?
- ¿Hacen envíos?
- ¿Formas de pago?
- ¿Certificaciones?
- ¿Puedo ser distribuidor?
- ¿Devolvemos productos?
- ¿Dónde están ubicados?

#### Búsqueda de Conocimiento
- `GET /knowledge` — muestra documentos, secciones y perfil detectado
- `POST /knowledge/reload` — recarga Markdown (después de editar en admin)
- `GET /knowledge/search?q=...` — prueba qué secciones recupera una pregunta (DEBUG)

---

### 2.4 Learning y Mejora Continua

Bot aprende de interacciones reales sin cambiar código.

#### Señales de Aprendizaje
- **Conversación sin resolver**: cliente pregunta y bot no responde bien → marca para revisar
- **Escalamiento frecuente**: si muchos clientes piden lo mismo y se escalan → añade a FAQ o conocimiento
- **Retroalimentación de humano**: cuando asesor responde un escalamiento, bot registra la respuesta correcta

#### Suite de Evaluación
- Test cases: preguntas con respuesta esperada
- Corre sobre el conocimiento y modelo actual
- Generador de casos desde conversaciones reales
- Ejemplo test:
  ```yaml
  pregunta: "¿Cuánto cuesta pintura AGLOSTONE en 19 litros?"
  respuesta_esperada: "debe buscar en catálogo y dar precio actual"
  ```

---

### 2.5 Modelos de IA

#### Por Defecto: Motor Determinista
- Sin API key de OpenRouter, bot funciona 100%: busca, cotiza, cobra, escala
- No necesita LLM; usa lógica hardcoded y retrieval

#### Con OpenRouter API
- Soporta: Claude (Anthropic), Mistral, Llama, otros
- Configurable por tenant en admin
- Fallback: si API no responde, vuelve a determinista

#### Modelo de Guardarraíl (Scope Guard)
- Modelo separado: temperatura 0, respuesta cortísima
- Decide si pregunta está dentro de tema del negocio
- Evita que intente responder "cómo cocinar" o "política"

---

### 2.6 Límites y Reglas de Negocio

1. **Nunca calcula totales el LLM**: backend calcula, bot solo muestra
2. **Nunca marca orden como pagada el cliente**: solo backend confirma pago desde pasarela
3. **Nunca inventa políticas**: si no está en conocimiento, escala o dice "no sé"
4. **Nunca promete fechas**: "Te lo mando mañana" — solo "Te contactamos para confirmar"
5. **Cumple horario**: fuera de 8–17 lunes-viernes y 8–13 sábados, ofrece email o dice volvemos luego
6. **Respeta límites de descuento**: vendedor máximo 10% (configurable)
7. **No crea órdenes sin confirmación**: debe haber aceptación clara

---

## 3. DATOS Y MODELOS

### 3.1 Estructura Multi-Tenant

Toda fila en la base de datos tiene `tenant_id`. Aislamiento SQL completo.

#### Tenant (Empresa/Negocio)
- ID, slug (nombre único), nombre, estado (activo/deshabilitado)
- Configuración: zona horaria, moneda, impuesto, costo de envío, límites
- Versionado: cambios de configuración son rastreados

---

### 3.2 Identidad y Acceso

#### User
- Email (único global), contraseña hasheada, nombre completo
- 2FA: TOTP (Google Authenticator) con códigos de recuperación
- Historial: cuándo ingresó, último login, IP

#### Membership
- Relación user-tenant-role (un usuario puede tener roles en múltiples tenants)
- Roles: ADMIN, GESTOR, AGENTE, LECTOR
- Estado: ACTIVE (miembro), SUSPENDED (temporalmente pausado)

#### Session
- Token de sesión activa, dirección IP, User-Agent, expiración

#### ApiKey
- Claves de API para integraciones (ej. AGENT_API_KEY_REF para el bot)
- Último uso, rotación periódica

---

### 3.3 Productos y Catálogo

#### Product
- Nombre, descripción, categoría, marca
- SKU (código único), código de barras (EAN)
- Precio base (Decimal, neto)
- Estado: ACTIVE, ARCHIVED, DRAFT
- Imagen principal (URL a MinIO)
- Historial de cambios (creación, última edición, quién)

#### ProductVariant
- Cada producto tiene variantes (talla, color, presentación)
- SKU propio (ej. AGLOSTONE-19L), precio específico, existencia
- Atributos: volumen, color, línea marca propia
- Costo de producción (para margen)

---

### 3.4 Clientes

#### Customer
- Nombre, email, teléfono (normalizados)
- Tipo: MINORISTA, DISTRIBUIDOR, PINTOR, PUBLICO
- Estado: ACTIVE, INACTIVE, BLOCKED
- Crédito: límite y saldo actual
- Etiquetas personalizadas
- Historial: total de compras, ticket promedio, última compra

#### CustomerAddress
- Dirección de envío o facturación
- Calle, número, piso, barrio, código postal, ciudad, estado
- Tipo: SHIPPING (envío), BILLING (facturación)
- Por defecto: cuál usar si no especifica

#### CustomerIdentity
- RFC, razón social (si aplica)
- Dato verificado (SÍ/NO, cuándo)
- Documento: archivo de comprobante

#### CustomerConsent
- Aceptó términos de servicio (fecha)
- Aceptó RGPD (fecha)
- Subscrito a notificaciones (SÍ/NO)

---

### 3.5 Cotizaciones

#### Quote
- ID, cliente, estado (DRAFT, SENT, VIEWED, ACCEPTED, REJECTED, EXPIRED)
- Líneas de producto (cantidad, precio unitario, subtotal)
- Detalles de envío (dirección, modo, costo)
- Impuesto, descuento, total final
- Fecha de emisión, fecha de vencimiento (7 días por defecto)
- Creador: cliente o equipo
- ShareToken: enlace público único

#### QuoteLine
- Producto/variante, cantidad, precio unitario en cotización (congelado en ese momento)
- Descuento por línea (si aplica)
- Notas comerciales

#### QuoteShareToken
- Token público y seguro para compartir cotización
- Válido hasta fecha de vencimiento de la cotización
- Genera enlaces: `/q/{quote_id}/{share_token}`

---

### 3.6 Órdenes

#### Order
- ID, cliente, estado (PENDING_PAYMENT, CONFIRMED, SHIPPED, DELIVERED, CANCELLED)
- Líneas (copiadas de la cotización en el momento de aceptar)
- Dirección de envío, modo (PICKUP, DELIVERY), costo
- Dirección de facturación, RFC/razón social
- Impuesto, descuento, total
- Histórico de cambios de estado (con timestamps)

#### OrderRevision
- Cuando hay cambios (cantidad, precio, dirección), se registra revisión
- Original + cambios (diff)
- Aprobación: requiere confirmación si es cambio material

#### OrderRevisionLine
- Detalle de qué cambió en cada línea

---

### 3.7 Pagos y Checkout

#### CheckoutSession
- ID, orden asociada, monto total, moneda, estado
- Método: CARD (tarjeta), BANK_TRANSFER (futuro), CASH (retiro sin pago)
- Enlace de pago público, URL de webhook
- Expiración (24 horas por defecto)
- Intentos fallidos (registra cada uno)
- Confirmación: timestamp, evento de la pasarela

#### Refund (futuro)
- Revertir pago (parcial o total)
- Motivo: CUSTOMER_REQUEST, DAMAGED, WRONG_ITEM
- Aprobación y notificación al cliente

---

### 3.8 Integración WhatsApp

#### WhatsAppConnection
- Número de negocio, token de acceso, webhook URL
- Estado: ACTIVE, PAUSED, ERROR
- Último sincronización, última actividad
- Credenciales: rotadas periódicamente

#### WhatsAppConversation (futuro)
- Thread de mensajes entre cliente y bot/equipo
- Estado: OPEN, RESOLVED, ESCALATED
- Asignado a: qué team member está respondiendo
- Etiquetas: pendiente, resuelto, spam
- Evento: recibido/enviado, timestamp, autor

---

### 3.9 Auditoría y Eventos

#### AuditLog
- Quién (user), qué (action), cuándo (timestamp), dónde (entity)
- Detalles: antes/después (para cambios), IP, User-Agent
- Entidad: producto, orden, cliente, pago
- Acción: CREATE, UPDATE, DELETE, APPROVE, REJECT, SHIP, etc.

#### OutboxEvent
- Evento generado (orden creada, pago confirmado)
- Destinatario: worker o integración
- Retry automático si falla
- Garantía de entrega (at-least-once)

#### InboxEvent
- Evento recibido de webhook (Stripe, WhatsApp, banco)
- Procesado: SÍ/NO, qué pasó
- Auditoría de origen

---

### 3.10 Jobs y Tareas Asincrónicas

#### Job
- Tipo: SEND_EMAIL, SEND_WHATSAPP, GENERATE_INVOICE, IMPORT_CSV
- Estado: PENDING, RUNNING, COMPLETED, FAILED
- Creador: user o sistema
- Resultado: archivo (ej. reporte), error message
- Reintento: automático si falló

---

## 4. FLUJOS PRINCIPALES

### 4.1 Flujo de Compra (Cliente → Bot)

```
1. Cliente inicia chat en WhatsApp o /chat de web
2. Bot saluda, ofrece ayuda
3. Cliente busca producto ("pintura mate 19 litros")
   → bot busca en catálogo (search_products)
4. Bot muestra opciones, cliente elige cantidad
   → bot agrega al carrito (agregar_al_carrito)
5. Cliente confirma o agrega más productos
6. Cliente dice "cotízame"
   → bot calcula totales (calcular_total)
   → bot emite cotización (emitir_cotizacion)
7. Bot comparte enlace de cotización
8. Cliente abre enlace, revisa en web, da clic "Aceptar"
9. Orden se crea automáticamente, bot pide dirección de envío
10. Cliente confirma o da nueva dirección
11. Bot genera sesión de pago (procesar_pago)
    → envía enlace de pago
12. Cliente abre, ingresa datos, confirma
13. Pasarela dummy confirma automáticamente
14. Bot notifica: "¡Tu pago fue confirmado! Te enviaremos tracking cuando despachemos"
15. Equipo interna marca orden como "Enviado"
    → cliente recibe notificación
16. Equipo marca "Entregada"
    → cliente recibe confirmación y opción de calificar
```

---

### 4.2 Flujo de Escalamiento (Bot → Humano)

```
1. Cliente pide algo especial ("¿Me dan distribuidor?")
2. Bot detecta caso fuera de alcance (guardarraíl, conocimiento incompleto)
3. Bot: "Voy a conectarte con un asesor"
   → crea ticket (request_human)
4. Ticket aparece en dashboard con contexto:
   - Cliente: nombre, teléfono
   - Razón: DISTRIBUIDOR, PRECIO_ESPECIAL, etc.
   - Carrito (si hay)
   - Mensaje del cliente
5. Team member recibe notificación
6. Asesor abre conversación en WhatsApp y ve contexto
7. Asesor responde directamente al cliente
8. Bot pausa, no interfiere mientras humano tenga sesión
9. Asesor resuelve y cierra ticket
10. Bot puede retomar si hay más preguntas del cliente
```

---

### 4.3 Flujo de Reabastecimiento (Admin)

```
1. Admin ve en /catalog que producto X tiene bajo stock
2. Edita cantidad en la tabla o abre detalle y actualiza
3. Sistema registra cambio en auditoría
4. Si stock llega a 0: marca AGOTADO, bot no lo propone
5. Bot consulta catálogo en cada búsqueda: siempre ve stock actual
```

---

### 4.4 Flujo de Configuración del Conocimiento

```
1. Admin abre /admin → Configuración → Conocimiento
2. Ve listado de Markdown cargados (negocio.md, productos.md, etc.)
3. Descarga un archivo, lo edita localmente o en línea
4. Sube nuevamente (o edita en editor de la plataforma si hay)
5. Hace clic "Recargar"
   → bot llama POST /knowledge/reload
6. Bot indexa nuevamente, carga perfiles, actualiza búsqueda
7. Cambio visible inmediatamente en /chat y WhatsApp
```

---

## 5. CONFIGURACIONES CLAVE (ADMIN)

### 5.1 Negocio
- Nombre empresa, razón social, RFC
- Logo, zona horaria, moneda
- Impuesto (% IVA), costo de envío base
- Horario de atención (usado para guardarraíl)

### 5.2 Agente
- Nombre bot, tono (profesional, casual, etc.)
- Saludo personalizado
- Modelo de IA (Claude, Mistral, fallback a determinista)
- Temperatura (creatividad), max tokens
- Guardarraíl: palabras clave fuera de tema, respuesta

### 5.3 Checkout
- Moneda, impuesto por defecto
- Expiración de enlace de pago (24h por defecto)
- Límite de descuento vendedor (10% por defecto)

### 5.4 Cotizaciones
- Validez (7 días por defecto)
- Auto-renovación o notificación antes de expirar

### 5.5 Quick Pay
- Expiración (24h por defecto)
- Métodos habilitados (dummy, Stripe, PayPal en roadmap)

### 5.6 WhatsApp
- Número de negocio, token, webhook URL
- Horario de respuesta (fuera de esto: "Nos contactaremos mañana")

### 5.7 Usuarios y Permisos
- Roles y qué puede cada uno (ver orders, editar precios, confirmar pagos)
- 2FA habilitado o no

---

## 6. NOTIFICACIONES Y EVENTOS

### Para Cliente
- Cotización emitida: enlace y resumen
- Cotización aceptada/rechazada: confirmación
- Orden creada: resumen y próximos pasos
- Pago confirmado: recibo y tracking próximo
- Enviado: tracking (si aplica)
- Entregado: confirmación y opción de calificar
- Escalamiento: "Un asesor se va a comunicar"

### Para Equipo
- Nueva orden: notificación en dashboard + email
- Pago confirmado: notificación (puede mostrar en POS si hay)
- Escalamiento: ticket abierto, asignación
- Producto bajo stock: alerta (configurable)
- Conversación sin responder en WhatsApp: recordatorio

---

## 7. MÉTRICAS Y REPORTES

### Dashboard
- Ventas totales (hoy, 7d, 30d)
- Órdenes por estado
- Promedio de ticket
- Tasa de conversión (cotizaciones → órdenes)
- Tiempo promedio de respuesta (bot + humano)
- Satisfacción de cliente (calificaciones)

### Reportes Exportables
- Movimiento de inventario (entrada/salida por producto)
- Ventas por cliente (quién gastó cuánto)
- Comisión de vendedor (si aplica)
- Resumen de pagos (métodos, tasas)
- Auditoría completa (quién cambió qué)

---

## 8. SEGURIDAD Y CUMPLIMIENTO

### Datos
- RGPD: consentimiento registrado, derecho a borrado
- Encriptación en tránsito (HTTPS, webhooks firmados)
- Dinero como Decimal (no float), evita errores de redondeo
- Versioning: cada entidad tiene `version`, cambios registrados

### Acceso
- Autenticación: email + contraseña + 2FA (TOTP)
- Autorización: roles por tenant (un user puede tener roles en múltiples tenants)
- API keys: rotación periódica, último uso registrado
- Auditoría: quién hizo qué cuándo, IP, cambios antes/después

### Integraciones
- Webhook firmado (HMAC) para WhatsApp y pasarela
- No se guardan datos de tarjeta (pasarela es responsable)
- Tokens de acceso rotables

### Cumplimiento
- Único proveedor de pago permitido: Dummy en desarrollo (Stripe/similar en producción)
- RFC y razón social verificables (no fabricados)
- Historial de cambios: trazabilidad completa

---

## 9. ROADMAP / NO IMPLEMENTADO

### Próximas Features
- Análisis de comportamiento de cliente (clustering, RFM)
- Promociones automáticas por regla
- Integración Stripe/PayPal (en lugar de Dummy)
- Reabastecimiento automático (alertas a proveedores)
- Devoluciones: flujo completo (cliente inicia en WhatsApp)
- Facturación automática (SAT en México)
- Integración con ERP externo (consulta de stock en tiempo real)
- Histórico de precios (análisis de margen)
- A/B testing de estilos de venta (cerrador vs. suave)
- Recomendador de productos por cliente
- Video call en WhatsApp (pasar a humano)
- Análisis de sentimiento en chat (NLP para satisfacción)

---

## 10. RESTRICCIONES Y LIMITACIONES

1. **No funciona offline**: todo requiere API (producto, orden, cotización)
2. **No soporta divisiones de pago**: una orden = un pago único
3. **Moneda única por tenant**: MXN para Aglos
4. **No hay carrito persistente en Web**: solo en bot (WhatsApp/chat)
5. **Cambios de precio en medio de cotización**: refleja precio actual al confirmar (no congelado)
6. **Máximo 3 líneas de producto** en una búsqueda (evitar abrumación)
7. **Escalamiento manual**: no hay IA para routing a equipo por especialidad
8. **Zona horaria única**: toda la tenancy en una TZ (configurable, por defecto MX)
9. **Búsqueda de conocimiento**: por tenant, no compartida entre tenants

---

## 11. CÓMO EMPEZAR (USER JOURNEY)

### Admin (Configuración Inicial)
1. Ingresa a `/admin`, crea cuenta, activa 2FA
2. Va a Configuración → Negocio: ingresa datos empresa
3. Sube logo, configura zona horaria e impuesto
4. Va a Agente → Conocimiento: sube archivos Markdown
5. Configura nombre bot, tono, horario
6. Prueba en `/chat` o `/agent` (consola de debug)
7. Conecta WhatsApp: pega número de negocio y token
8. Invita a team members con sus roles

### Cliente (Compra en WhatsApp)
1. Escanea código QR de WhatsApp de Aglos
2. Envía "Hola" o mensaje personalizado
3. Bot saluda, pregunta qué necesita
4. Cliente pide producto, bot busca y cotiza
5. Cliente confirma, bot emite cotización con enlace
6. Cliente abre enlace, revisa en web, da clic "Aceptar"
7. Se crea orden, bot pide dirección
8. Cliente confirma, bot envía enlace de pago
9. Cliente paga, se confirma, bot notifica
10. Equipo interna envía y marca como entregado
11. Cliente recibe notificación de entrega y puede calificar

---

**Última actualización:** 9 de septiembre de 2026
**Versión:** v2 (LangGraph + deepagents, multi-tenant, WhatsApp integrado)
