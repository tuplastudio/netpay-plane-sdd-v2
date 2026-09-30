/**
 * Cuerpos de /iam (API keys, invitaciones y membresías).
 *
 * Mismo motivo que catalog.dto.ts / quote.dto.ts: un `@Body() body: {...}` con
 * tipo literal no se valida en runtime pese al ValidationPipe global (el pipe
 * no recibe metatype y deja pasar el cuerpo tal cual). Aquí eso no era solo
 * higiene: `role` y `scopes` viajaban sin validar y eran escalada de
 * privilegios directa (un ADMIN podía invitarse a sí mismo como OWNER, y
 * cualquiera con `apikeys.manage` podía acuñar una key con scopes que su
 * propio rol no tiene).
 */

import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";
import type { Role } from "@prisma/client";
import { ALL_SCOPES, Scope } from "./policies.js";
import { ASSIGNABLE_ROLES } from "./membership.service.js";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

/** Tope del periodo de gracia al rotar: una semana. */
export const MAX_ROTATION_GRACE_HOURS = 168;

/**
 * `PATCH /iam/api-keys/:id`: renombrar, cambiar scopes o vencimiento. Todo
 * opcional; lo que no viene no se toca. `expiresAt: null` quita el
 * vencimiento (a diferencia de omitirlo). La regla de "no otorgar scopes que
 * no tienes" se aplica en el controlador, igual que al crear.
 */
export class UpdateApiKeyDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ALL_SCOPES.length)
  @IsIn(ALL_SCOPES, { each: true, message: "scopes contiene un permiso desconocido" })
  scopes?: Scope[];

  /** ISO 8601 en el futuro, o `null` para "sin vencimiento". */
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsISO8601({ strict: true }, { message: "expiresAt debe ser una fecha ISO 8601" })
  expiresAt?: string | null;
}

/**
 * `POST /iam/api-keys/:id/rotate`. `graceHours` = cuánto sigue valiendo la key
 * vieja tras emitir la nueva; 0 la revoca de inmediato. Sin el campo aplica el
 * default del servicio (`API_KEY_ROTATION_GRACE_HOURS`, 24 h).
 */
export class RotateApiKeyDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_ROTATION_GRACE_HOURS)
  graceHours?: number;
}

/** Query de `GET /iam/api-keys/:id/usage`. */
export class ApiKeyUsageQueryDto {
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  path?: string;

  /** Código exacto (`404`) o clase (`4xx`). */
  @IsOptional()
  @Matches(/^([1-5]\d\d|[1-5]xx)$/i, { message: "status debe ser un código (404) o una clase (4xx)" })
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

/** Query de `GET /iam/api-keys/:id/usage/summary`. */
export class ApiKeyUsageSummaryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}

/** Body de `POST /super-admin/api-keys/usage/purge`. */
export class PurgeApiKeyUsageDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  days?: number;
}

export class CreateApiKeyDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  /**
   * Lista blanca cerrada: solo scopes del catálogo de `policies.ts`. La
   * comprobación de que además NO exceden los del creador se hace en el
   * controlador (depende del principal, no del cuerpo).
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ALL_SCOPES.length)
  @IsIn(ALL_SCOPES, {
    each: true,
    message: "scopes contiene un permiso desconocido",
  })
  scopes!: Scope[];

  /** Tope de 2 años: una key eterna es una fuga permanente si se filtra. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(730)
  expiresInDays?: number;
}

/**
 * Invitación emitida desde el portal del tenant. El rol se valida contra la
 * matriz completa; qué roles puede otorgar QUIEN invita lo decide el
 * controlador con la misma regla que `membership.service.ts` (otorgar OWNER
 * exige `tenant.admin`).
 */
export class CreateInvitationDto {
  @Transform(trim)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  fullName!: string;

  @IsIn(ASSIGNABLE_ROLES, { message: "role inválido" })
  role!: Role;
}

export class ChangeMemberRoleDto {
  @IsIn(ASSIGNABLE_ROLES, { message: "role inválido" })
  role!: Role;
}

export class SetMemberAgentDto {
  @IsBoolean()
  isAgent!: boolean;
}
