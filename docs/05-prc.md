# SPEC-PRC — Cálculo comercial, entrega e inventario

Versión: 2.0. Estado: especificado; implementación pendiente.

## Algoritmo MONEY-V2

Se usa decimal exacto y ROUND_HALF_UP para importes MXN a 2 decimales. Cantidades máximo 3; cálculos internos con al menos 12 dígitos significativos adicionales. No usar Number para aritmética monetaria. La fuente de precio se captura en snapshot al emitir. En borrador se actualiza con catálogo al recalcular; tras emitir, precio se respeta hasta vencer salvo creación explícita de revisión.

Por línea: bruto = round(precio × cantidad, 2). Descuento de línea, porcentual o fijo, nunca ambos; porcentaje 0–100 aplicado al bruto y redondeado. El descuento global se distribuye sobre brutos posteriores a descuento por proporción, usando pisos de centavos y mayor residuo, desempate por linePosition. Ninguna línea termina negativa.

Si taxMode=EXCLUSIVE: base = bruto descontado; impuesto = round(base × tasa,2); total=base+impuesto. Si INCLUSIVE: base=round(bruto descontado/(1+tasa),2); impuesto=bruto descontado-base; total=bruto descontado. Perfil sin impuesto tiene tax=0. V2 soporta una tasa ad valorem por concepto y sin retenciones; rechaza configuración compuesta no soportada. Perfil fiscal es administrado, no una recomendación fiscal.

Envío se modela como línea `SHIPPING`, no recibe descuentos de producto; perfil propio. Recogida shipping=0. Envío flat requiere dirección MX con CP de 5 dígitos, estado, ciudad, colonia/campo opcional, calle y número/exterior o indicación sin número. No geocodifica ni promete cobertura de transportista. Una configuración puede bloquear lista de CP no atendidos. Total final suma totales de línea; incluye desglose bases/impuestos por tasa y versión de cálculo.

| Fixture | Entrada | Resultado |
| --- | --- | --- |
| M01 | 2 × 100 EXCLUSIVE 16%, descuento 10% | base 180.00, tax 28.80, total 208.80. |
| M02 | 1 × 116 INCLUSIVE 16% | base 100.00, tax 16.00, total 116.00. |
| M03 | 3 × 0.01, global 0.01, sin impuesto | Distribución 0.01 en primera línea por posición; total 0.02. |
| M04 | 0.001 × 1.00 | bruto 0.00; rechazo ZERO_LINE_AMOUNT. |
| M05 | 100 producto sin impuesto + 50 envío EXCLUSIVE 16% | total 158.00; shipping tax 8.00. |

## Inventario local

InventoryBalance por variante: onHand y reserved NUMERIC(18,3), no negativos. Available=onHand-reserved. Movimientos append-only ADJUST/RESERVE/RELEASE/CONSUME, correlacionados por operationKey único. Ajustar onHand por debajo de reserved se rechaza; correcciones pasan por liberar/reasignar reserva con incidencia, no UPDATE libre.

Cotización no reserva. Checkout guarda/reserva todas sus líneas local en una transacción; bloquear balances por variantId ordenado para evitar deadlocks. Si una falla, rollback total. Idempotencia por checkoutRevisionId. Payment success consume una vez: restar cantidad de onHand y reserved. Cancelación/expiración libera reserved una vez; no aumenta onHand.

Reloj base DB. Al iniciar sesión dummy, expireAt no supera reserva/cotización. Para prueba de pago asíncrono largo, el simulador puede pagar tarde, pero el negocio procesa incidencia de stock; no extiende automáticamente reserva. `NONE` no reserva ni expresa cantidad disponible. `EXTERNAL` rechaza activación sin un adaptador InventoryProvider registrado; contrato reserve/commit/release/getAvailability con idempotencia y compensación al fallo.

## Requisitos, tareas y aceptación

### REQ-PRC-01 / T-PRC-01 — Implementar decimales y perfiles

**Regla normativa:** Cálculo genera resultados exactos y versionados.

**Trabajo específico:** Crear Money/Quantity types, parser estricto, política MONEY-V2 y CRUD versionado de perfiles EXCLUSIVE/INCLUSIVE/NONE; rechazo de moneda o precisión no soportada.

**Entregable esperado:** packages/domain/money y commerce-api/pricing.

**Dependencias:** T-CAT-07.

**AC-PRC-01 — prueba de aceptación:** M01 y M02 dan importes exactos; 1.005 como precio entrada falla en vez de truncarse.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-PRC-01. Estado inicial: `TODO`.

### REQ-PRC-02 / T-PRC-02 — Distribuir descuentos y calcular

**Regla normativa:** Descuentos respetan permisos y suman centavos sin pérdidas.

**Trabajo específico:** Implementar descuentos línea/global, reparto mayor residuo y desglose por tasa; validar límites actor y cantidad/step; snapshot cálculo input/output.

**Entregable esperado:** quote-calculator y fixtures M01–M05.

**Dependencias:** T-PRC-01.

**AC-PRC-02 — prueba de aceptación:** M03 desempata por posición; 100% que deja pedido cero no se envía a cobrar; IA no sobrepasa descuento 0%.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-PRC-02. Estado inicial: `TODO`.

### REQ-PRC-03 / T-PRC-03 — Calcular entrega

**Regla normativa:** Toda variación del envío requiere total final visible.

**Trabajo específico:** Crear PICKUP/FLAT_SHIPPING, address schema, CP permitidos y línea SHIPPING; snapshot configVersion. Rechazar dirección incompleta y método deshabilitado.

**Entregable esperado:** delivery policy y calculate-delivery endpoint interno.

**Dependencias:** T-PRC-02.

**AC-PRC-03 — prueba de aceptación:** M05 totaliza 158.00; cambiar a pickup produce 100.00 en nueva revisión, sin mutar intento activo.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-PRC-03. Estado inicial: `TODO`.

### REQ-PRC-04 / T-PRC-04 — Registrar stock y ajustes

**Regla normativa:** Inventario se modifica por movimientos idempotentes.

**Trabajo específico:** Crear balances/movements y adjust command con motivo/permisos/version; consultas de disponibilidad y modo NONE; bloqueo de EXTERNAL sin adaptador.

**Entregable esperado:** inventory migrations, service y endpoints adjust/availability.

**Dependencias:** T-PRC-03.

**AC-PRC-04 — prueba de aceptación:** Aplicar dos veces ajuste con misma key produce un movimiento; bajar stock bajo reservado falla.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-PRC-04. Estado inicial: `TODO`.

### REQ-PRC-05 / T-PRC-05 — Reservar carrito atómicamente

**Regla normativa:** No existe reserva parcial tras fallo de una línea.

**Trabajo específico:** Implementar reserve/release/consume con locks ordenados, quantity rules y operación única por revisión; expiración y lease de reconciliador.

**Entregable esperado:** reservation service y worker expiration.

**Dependencias:** T-PRC-04.

**AC-PRC-05 — prueba de aceptación:** Dos checkouts por última pieza: uno reserva, otro recibe STOCK_UNAVAILABLE; fallo de segunda línea revierte primera.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-PRC-05. Estado inicial: `TODO`.

### REQ-PRC-06 / T-PRC-06 — Resolver vencimiento y pago concurrente

**Regla normativa:** Una reserva no se consume y libera dos veces.

**Trabajo específico:** Definir transacción de éxito/expiración con misma exclusión; aceptar pago con reserva vigente, o crear incidente y reintentar disponibilidad para pago tardío mediante flujo controlado. No autoentregar sin stock.

**Entregable esperado:** reservation transition tests e incident integration.

**Dependencias:** T-PRC-05.

**AC-PRC-06 — prueba de aceptación:** Ejecutar expiry y success al mismo tiempo: stock nunca negativo, un solo movimiento terminal o incidencia explícita.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-PRC-06. Estado inicial: `TODO`.
