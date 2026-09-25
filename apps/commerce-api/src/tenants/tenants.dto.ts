import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsHexColor,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
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

/**
 * Parámetros comerciales del propio tenant (`PATCH /tenants/me/settings`).
 *
 * Todos los campos son opcionales: el panel manda solo lo que el admin tocó.
 * Los rangos son de negocio, no de tipo — un `quoteValidityHours` de 0 deja
 * la cotización vencida en el instante en que se emite, y uno de 100 años
 * convierte el link público en una credencial permanente.
 *
 * `checkoutReservationMinutes` admite hasta 43 200 minutos (30 días) porque
 * es lo que decide cuánto vive el link de pago; el mínimo de 5 evita que el
 * cliente reciba un enlace ya vencido.
 */
export class UpdateBusinessSettingsDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  taxRatePct?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9_999_999.99)
  shippingFlat?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8_760)
  quoteValidityHours?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8_760)
  quickPayValidityHours?: number;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(43_200)
  checkoutReservationMinutes?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  maxSellerDiscountPct?: number;

  @IsOptional()
  @IsBoolean()
  quoteReminderEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  quoteReminderEveryHours?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  quoteReminderMaxCount?: number;

  /**
   * Plantillas aprobadas por Meta, por clave interna:
   * `{ "QUOTE_REMINDER": { "name": "recordatorio_cotizacion", "language": "es_MX" } }`.
   *
   * Se valida como objeto y el controller se queda sólo con las entradas que
   * `resolveApprovedTemplate` entiende: una clave con basura no puede dejar
   * la columna en un estado que el despachador no sepa leer. `{}` borra
   * todas.
   */
  @IsOptional()
  @IsObject()
  whatsappTemplates?: Record<string, unknown>;
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
