import { IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from "class-validator";

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
