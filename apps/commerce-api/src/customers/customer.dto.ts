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
}

export class LinkCustomerIdentityDto {
  @IsIn(IDENTITY_CHANNELS, { message: "channel inválido" })
  channel!: CustomerIdentityChannel;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  externalId!: string;
}
