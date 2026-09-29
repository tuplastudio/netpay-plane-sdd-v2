/**
 * Cuerpos de /customers.
 *
 * Mismo motivo que catalog.dto.ts / quote.dto.ts: un `@Body() body: {...}` con
 * tipo literal no se valida en runtime pese al ValidationPipe global. Aquí
 * importa porque el rol VENDOR (y el agente por API key) escribe estos
 * endpoints, y `expectedVersion` gobierna el control de concurrencia
 * optimista: si llegaba `"3"` en vez de `3`, la comparación estricta contra
 * `c.version` fallaba siempre y el 409 era indistinguible de una carrera real.
 */

import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

const IDENTITY_CHANNELS = ["WHATSAPP_META", "WHATSAPP_EVOLUTION"] as const;
export type CustomerIdentityChannel = (typeof IDENTITY_CHANNELS)[number];

export class CustomerAddressDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  line1!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  line2?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  city!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  state!: string;

  @IsString()
  @Matches(/^\d{5}$/, { message: "postalCode debe ser 5 dígitos" })
  postalCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  country?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class CreateCustomerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  taxId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CustomerAddressDto)
  addresses?: CustomerAddressDto[];
}

export class UpdateCustomerDto {
  /** Concurrencia optimista: debe ser el `version` que devolvió la lectura. */
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  taxId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class ResolveChannelContactDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  /**
   * Hilo de WhatsApp del que salió el contacto. Con esto el backend resuelve
   * el canal y el teléfono desde la propia conversación (más confiable que lo
   * que mande el agente) y, si el hilo todavía no tiene cliente, lo deja
   * vinculado — así el panel de conversaciones deja de mostrar "Cliente sin
   * ficha" para cotizaciones que el agente ya facturó a un cliente real.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  conversationId?: string;
}

export class LinkCustomerIdentityDto {
  @IsIn(IDENTITY_CHANNELS, { message: "channel inválido" })
  channel!: CustomerIdentityChannel;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  externalId!: string;
}

// ---------------------------------------------------------------------------
// Perfil 360° (0026): etiquetas, datos fiscales, notas y direcciones.
// ---------------------------------------------------------------------------

/** Clave SAT c_RegimenFiscal: 3 dígitos. */
const REGIMEN_RE = /^\d{3}$/;
/** Clave SAT c_UsoCFDI: letra(s) + 2 dígitos (G03, P01, S01, CP01…). */
const CFDI_USE_RE = /^[A-Z]{1,2}\d{2}$/;

export class UpdateCustomerProfileDto extends UpdateCustomerDto {
  /** Razón social para CFDI. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  legalName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{5}$/, { message: "fiscalPostalCode debe ser 5 dígitos" })
  fiscalPostalCode?: string;

  @IsOptional()
  @IsString()
  @Matches(CFDI_USE_RE, { message: "fiscalCfdiUse inválido (ej. G03)" })
  fiscalCfdiUse?: string;

  @IsOptional()
  @IsString()
  @Matches(REGIMEN_RE, { message: "fiscalRegimenFiscal inválido (ej. 626)" })
  fiscalRegimenFiscal?: string;

  /** Etiquetas libres; se normalizan en minúsculas y sin duplicados. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  tags?: string[];
}

export class UpdateCustomerAddressDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  line1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  line2?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  state?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{5}$/, { message: "postalCode debe ser 5 dígitos" })
  postalCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  country?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class CustomerNoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;
}

/**
 * Datos fiscales que acompañan (opcionalmente) a la constancia: lo que venga
 * aquí manda sobre lo leído del PDF. Multipart: todo llega como string.
 */
export class CustomerConstanciaDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  rfc?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  legalName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  postalCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  regimenFiscal?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4)
  cfdiUse?: string;
}
