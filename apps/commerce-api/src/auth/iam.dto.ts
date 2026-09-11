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

import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import type { Role } from "@prisma/client";
import { ALL_SCOPES, Scope } from "./policies.js";
import { ASSIGNABLE_ROLES } from "./membership.service.js";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

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
