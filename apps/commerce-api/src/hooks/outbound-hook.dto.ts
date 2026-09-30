/**
 * Cuerpos de `/hooks`. Igual que el resto de DTOs: el ValidationPipe global
 * corre con `whitelist` + `forbidNonWhitelisted`, así que todo campo aceptado
 * tiene que estar declarado aquí.
 *
 * Los JSON libres (`headers`, `argsTemplate`, `retryPolicy`) se validan a
 * fondo en `OutboundHookService.normalize*` — class-validator no baja a
 * objetos anidados sin clase.
 */

import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import { SUBSCRIBABLE_EVENTS } from "./event-catalog.js";

export const HOOK_KINDS = ["REST", "MCP"] as const;
export const HOOK_AUTH_TYPES = ["NONE", "BEARER", "API_KEY_HEADER", "BASIC", "HMAC"] as const;
export const HOOK_STATUSES = ["ACTIVE", "DISABLED"] as const;
export const DELIVERY_STATUSES = ["PENDING", "SUCCESS", "FAILED", "DEAD"] as const;

export type HookKind = (typeof HOOK_KINDS)[number];
export type HookAuthType = (typeof HOOK_AUTH_TYPES)[number];
export type HookStatus = (typeof HOOK_STATUSES)[number];
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

const URL_OPTS = { require_protocol: true, require_tld: false, protocols: ["http", "https"] };

export class CreateOutboundHookDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsIn(HOOK_KINDS, { message: "kind debe ser REST o MCP" })
  kind!: HookKind;

  @IsUrl(URL_OPTS, { message: "targetUrl debe ser una URL http(s)" })
  @MaxLength(2000)
  targetUrl!: string;

  @IsIn(HOOK_AUTH_TYPES, { message: "authType inválido" })
  authType!: HookAuthType;

  /** Token/API key/`usuario:contraseña` según `authType`. Se guarda cifrado. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  credential?: string;

  @IsOptional()
  @Matches(/^[A-Za-z0-9-]{1,64}$/, { message: "authHeaderName: solo letras, números y guiones" })
  authHeaderName?: string;

  @IsArray()
  @ArrayMinSize(1, { message: "Suscribe al menos un evento" })
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsIn(SUBSCRIBABLE_EVENTS, { each: true, message: "Evento desconocido" })
  events!: string[];

  @IsOptional()
  @IsObject({ message: "headers debe ser un objeto { nombre: valor }" })
  headers?: Record<string, unknown>;

  @IsOptional()
  @Matches(/^[A-Za-z0-9_.-]{1,128}$/, { message: "toolName inválido" })
  toolName?: string;

  @IsOptional()
  @IsObject({ message: "argsTemplate debe ser un objeto JSON" })
  argsTemplate?: Record<string, unknown>;

  @IsOptional()
  @IsObject({ message: "retryPolicy debe ser { maxAttempts, backoffSeconds }" })
  retryPolicy?: Record<string, unknown>;
}

export class UpdateOutboundHookDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsIn(HOOK_KINDS, { message: "kind debe ser REST o MCP" })
  kind?: HookKind;

  @IsOptional()
  @IsUrl(URL_OPTS, { message: "targetUrl debe ser una URL http(s)" })
  @MaxLength(2000)
  targetUrl?: string;

  @IsOptional()
  @IsIn(HOOK_AUTH_TYPES, { message: "authType inválido" })
  authType?: HookAuthType;

  /** Ausente = conservar la credencial guardada; cadena = reemplazarla. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  credential?: string;

  @IsOptional()
  @Matches(/^[A-Za-z0-9-]{1,64}$/, { message: "authHeaderName: solo letras, números y guiones" })
  authHeaderName?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: "Suscribe al menos un evento" })
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsIn(SUBSCRIBABLE_EVENTS, { each: true, message: "Evento desconocido" })
  events?: string[];

  @IsOptional()
  @IsIn(HOOK_STATUSES, { message: "status debe ser ACTIVE o DISABLED" })
  status?: HookStatus;

  @IsOptional()
  @IsObject({ message: "headers debe ser un objeto { nombre: valor }" })
  headers?: Record<string, unknown>;

  @IsOptional()
  @Matches(/^[A-Za-z0-9_.-]{1,128}$/, { message: "toolName inválido" })
  toolName?: string;

  @IsOptional()
  @IsObject({ message: "argsTemplate debe ser un objeto JSON" })
  argsTemplate?: Record<string, unknown>;

  @IsOptional()
  @IsObject({ message: "retryPolicy debe ser { maxAttempts, backoffSeconds }" })
  retryPolicy?: Record<string, unknown>;
}

export class ListDeliveriesQueryDto {
  @IsOptional()
  @IsIn(DELIVERY_STATUSES, { message: "status inválido" })
  status?: DeliveryStatus;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  cursor?: string;

  /** Llega como texto en el query string; se convierte en el controlador. */
  @IsOptional()
  @Matches(/^[1-9]\d{0,2}$/, { message: "limit debe ser un entero entre 1 y 100" })
  limit?: string;
}
