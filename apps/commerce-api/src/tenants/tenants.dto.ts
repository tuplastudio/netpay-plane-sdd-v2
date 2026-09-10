import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsHexColor,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

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

export class UpdateTenantStatusDto {
  @IsString()
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
 * sobre una empresa concreta (`POST /super-admin/tenants/:id/api-keys`). */
export class CreateTenantApiKeyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  scopes!: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  expiresInDays?: number;
}
