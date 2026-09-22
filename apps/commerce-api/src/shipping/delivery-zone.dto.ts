import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

const POSTAL_CODE_RE = /^\d{4,5}$/;

export class CreateDeliveryZoneDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @Matches(POSTAL_CODE_RE, {
    each: true,
    message: "postalCodes acepta solo dígitos (4 o 5 caracteres)",
  })
  postalCodes?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  cityPattern?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  state?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999_999.99)
  price!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999_999.99)
  minOrder?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdateDeliveryZoneDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @Matches(POSTAL_CODE_RE, {
    each: true,
    message: "postalCodes acepta solo dígitos (4 o 5 caracteres)",
  })
  postalCodes?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  cityPattern?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  state?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999_999.99)
  price?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999_999.99)
  minOrder?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class LookupDeliveryZoneDto {
  @IsOptional()
  @IsString()
  @Matches(POSTAL_CODE_RE, { message: "postalCode: 4 o 5 dígitos" })
  postalCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  state?: string;
}
