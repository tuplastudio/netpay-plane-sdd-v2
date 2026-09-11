import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

// Mismo motivo que quote.dto.ts / catalog.dto.ts: un `@Body() body: {...}` con
// tipo literal no se valida en runtime pese al ValidationPipe global (el pipe
// no tiene metatype que inspeccionar y deja pasar el cuerpo tal cual).
//
// El formato de `amountTotal` sigue viviendo en `parseAmountTotal`
// (order.service.ts), no aquí: la regla es de dominio (positivo, redondeo a
// centavos, tope de columna) y no cabe en un `@Matches`.
//
// La razón original —el `exceptionFactory` por defecto devolvía `message` como
// array y el filtro global lo descartaba, así que un rechazo del pipe llegaba
// como "Bad Request Exception"— ya no aplica: ver
// `common/validation/validation-exception.factory.ts`.

/**
 * Clave de idempotencia del cobro rápido. Se acepta cualquier identificador
 * opaco razonable (el cliente manda un UUID v4); se acota el juego de
 * caracteres y la longitud para que no se use como campo de texto libre.
 */
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_.:-]{8,128}$/;

const RFC_RE = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
const CFDI_USE_RE = /^[A-Z][0-9]{2}$/;
const POSTAL_CODE_RE = /^\d{5}$/;

/**
 * Datos fiscales para pedir factura de un pedido (CFDI). El bot los junta en
 * la conversación con el cliente, siempre con confirmación explícita antes de
 * llamar esto (ver `apps/agent-v2/app/tools.py#solicitar_factura`).
 */
export class RequestInvoiceDto {
  @IsString()
  @Matches(RFC_RE, { message: "rfc inválido (persona física: 13 caracteres, moral: 12)" })
  rfc!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  legalName!: string;

  @IsString()
  @Matches(POSTAL_CODE_RE, { message: "postalCode debe ser 5 dígitos" })
  postalCode!: string;

  @IsString()
  @Matches(CFDI_USE_RE, { message: "cfdiUse inválido (ej. G03, P01)" })
  cfdiUse!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  constanciaUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class QuickChargeDto {
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  description!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(32)
  amountTotal!: string;

  @IsOptional()
  @IsString()
  @Matches(IDEMPOTENCY_KEY_RE, {
    message: "idempotencyKey debe ser un identificador opaco de 8 a 128 caracteres",
  })
  idempotencyKey?: string;
}

/**
 * Línea de pedido. A diferencia de `QuoteLineDto` la cantidad NO se fija en
 * `NN.NNN`: el panel manda lo que el operador escribe en el input ("2"),
 * mientras que el flujo desde cotización y el agente mandan la decimal
 * serializada de Prisma ("2.000"). Se acepta cualquier decimal razonable y el
 * redondeo/validación de negocio lo sigue haciendo `PricingService`.
 */
export class OrderLineDto {
  @IsUUID()
  variantId!: string;

  @IsString()
  @Matches(/^\d{1,10}(\.\d{1,3})?$/, { message: "quantity debe ser un decimal de hasta 3 posiciones" })
  quantity!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPct?: number;
}

/** Body de POST /orders (alta directa, sin cotización previa). */
export class CreateOrderDto {
  @IsUUID()
  customerId!: string;

  @IsArray()
  @ArrayMinSize(1)
  // Mismo tope que PricingService.price (ADR-011): rechazarlo aquí evita
  // cargar 10k variantes para luego fallar.
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  lines!: OrderLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

/** Body de POST /orders/:id/checkout. */
export class StartCheckoutDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  lines!: OrderLineDto[];

  @IsIn(["PICKUP", "LOCAL_DELIVERY"], { message: "deliveryMode inválido" })
  deliveryMode!: "PICKUP" | "LOCAL_DELIVERY";

  /** Los agentes lo mandan como `null` explícito cuando no hay dirección. */
  @IsOptional()
  @IsUUID()
  addressId?: string;
}

/**
 * Body de PATCH /orders/:id/cancel. `reason` es opcional y libre: el panel
 * manda "manual" y el agente un texto del cliente.
 */
export class CancelOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
