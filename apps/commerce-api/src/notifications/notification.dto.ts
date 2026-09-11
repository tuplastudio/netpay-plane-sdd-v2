/**
 * Cuerpo de POST /notifications/schedule.
 *
 * Mismo motivo que catalog.dto.ts / quote.dto.ts: un `@Body() body: {...}` con
 * tipo literal no se valida en runtime pese al ValidationPipe global.
 * `recipientType` y `channel` acaban como enums de Postgres y `recipientId`
 * como uuid, así que un valor libre reventaba en la base en vez de dar 400.
 */

import { IsDateString, IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";

const RECIPIENT_TYPES = ["CUSTOMER", "USER"] as const;
const CHANNELS = ["EMAIL", "WHATSAPP", "SMS", "PUSH"] as const;

export class ScheduleNotificationDto {
  @IsIn(RECIPIENT_TYPES, { message: "recipientType inválido" })
  recipientType!: (typeof RECIPIENT_TYPES)[number];

  @IsUUID()
  recipientId!: string;

  @IsIn(CHANNELS, { message: "channel inválido" })
  channel!: (typeof CHANNELS)[number];

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  templateKey!: string;

  @IsObject({ message: "payload debe ser un objeto" })
  payload!: Record<string, unknown>;

  @IsOptional()
  @IsDateString({}, { message: "scheduledAt debe ser una fecha ISO" })
  scheduledAt?: string;
}
