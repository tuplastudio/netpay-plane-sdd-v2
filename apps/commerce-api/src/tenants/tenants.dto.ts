import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsHexColor,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { ALL_SCOPES, Scope } from "../auth/policies.js";

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])?$/;

export class CreateTenantDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @IsString()
  @Matches(SLUG_RE, { message: "slug solo admite minúsculas, números y guion" })
  slug!: string;

  @IsEmail()
  ownerEmail!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  ownerFullName!: string;
}

/** El estado va directo a la columna (enum TenantStatus): lista cerrada, no
 * `@IsString()` a secas —cualquier cadena reventaba en Postgres en vez de dar
 * un 400 con el valor admitido. */
export class UpdateTenantStatusDto {
  @IsIn(["ACTIVE", "DISABLED"], { message: "status debe ser ACTIVE o DISABLED" })
  status!: "ACTIVE" | "DISABLED";
}

export class UpdateBrandingDto {
  @IsOptional()
  @IsUrl({ require_tld: false })
  logoUrl?: string;

  @IsOptional()
  @IsHexColor()
  primaryColor?: string;

  @IsOptional()
  @IsHexColor()
  secondaryColor?: string;

  @IsOptional()
  @IsHexColor()
  accentColor?: string;
}

/** Mismo contrato que `POST /iam/api-keys`, pero emitido por un super-admin
 * sobre una empresa concreta (`POST /super-admin/tenants/:id/api-keys`).
 *
 * El super-admin sí puede otorgar cualquier scope (no hay intersección con su
 * rol, que es de plataforma y no del tenant), pero solo scopes que existan:
 * `@IsString({each:true})` dejaba grabar cadenas arbitrarias en la columna. */
export class CreateTenantApiKeyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ALL_SCOPES.length)
  @IsIn(ALL_SCOPES, { each: true, message: "scopes contiene un permiso desconocido" })
  scopes!: Scope[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(730)
  expiresInDays?: number;
}
