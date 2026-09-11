/**
 * Cuerpos de /integrations (los autenticados; el webhook entrante es @Public y
 * su cuerpo es opaco por diseño: lo define el proveedor externo).
 *
 * Mismo motivo que catalog.dto.ts / quote.dto.ts: un `@Body() body: {...}` con
 * tipo literal no se valida en runtime pese al ValidationPipe global.
 */

import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

const DIRECTIONS = ["INBOUND", "OUTBOUND", "BIDIRECTIONAL"] as const;
export type IntegrationDirection = (typeof DIRECTIONS)[number];

export class CreateIntegrationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9._-]+$/, { message: "provider solo admite letras, números, punto, guion y guion bajo" })
  provider!: string;

  /** Decide si se emite webhookUrl y se cifra el secreto: no puede venir libre. */
  @IsIn(DIRECTIONS, { message: "direction inválida" })
  direction!: IntegrationDirection;

  @IsOptional()
  @IsUrl({ require_tld: false }, { message: "endpoint debe ser una URL" })
  @MaxLength(2000)
  endpoint?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(256)
  secret?: string;
}

export class PublishIntegrationEventDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  eventName!: string;

  @IsObject({ message: "payload debe ser un objeto" })
  payload!: Record<string, unknown>;

  @IsString()
  @MinLength(8)
  @MaxLength(256)
  secret!: string;
}
