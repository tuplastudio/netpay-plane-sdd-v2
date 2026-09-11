/**
 * Cuerpos de /payments.
 *
 * Mismo motivo que catalog.dto.ts / quote.dto.ts: un `@Body() body: {...}` con
 * tipo literal no se valida en runtime pese al ValidationPipe global. Aquí
 * pesa doble: `sessionId` acaba interpolado en el SQL del reembolso como
 * `${sessionId}::uuid`, y el endpoint lo alcanza el rol FINANCE.
 *
 * El formato de `amount` sigue viviendo en `parseMoney` (payment.service.ts),
 * no aquí: la regla es de dominio (positivo, 2 decimales, no exceder lo
 * capturado) y su mensaje de error es el útil para el operador.
 */

import { IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

export class RefundDto {
  @IsUUID()
  sessionId!: string;

  @IsString()
  @MaxLength(32)
  amount!: string;

  /** El panel manda "" cuando el operador no escribe motivo. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
