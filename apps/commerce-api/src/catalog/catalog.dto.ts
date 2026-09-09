import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
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

// El pipe global (`whitelist`, `forbidNonWhitelisted`, `transform`) solo
// valida cuando el parámetro es una clase real: un `@Body() body: {...}`
// con tipo literal no se valida en tiempo de ejecución (metatype `Object`)
// aunque TypeScript lo revise en compilación. De ahí estos DTOs.

const SKU_RE = /^[A-Za-z0-9._-]+$/;
const PRICE_RE = /^\d{1,10}\.\d{2}$/;
const SAT_PRODUCT_RE = /^\d{8}$/;
const SAT_UNIT_RE = /^[A-Z0-9]{2,3}$/;
const STATUS_VALUES = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;

export class VariantInputDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Matches(SKU_RE, { message: "sku solo admite letras, números, punto, guion y guion bajo" })
  sku!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsString()
  @Matches(PRICE_RE, { message: "price debe tener formato NN.NN" })
  price!: string;

  @IsOptional()
  @IsString()
  @Matches(SAT_PRODUCT_RE, { message: "satProductCode debe ser 8 dígitos" })
  satProductCode?: string;

  @IsOptional()
  @IsString()
  @Matches(SAT_UNIT_RE, { message: "satUnitCode inválido" })
  satUnitCode?: string;
}

export class CreateProductDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Matches(SKU_RE, { message: "sku solo admite letras, números, punto, guion y guion bajo" })
  sku!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @Matches(SAT_PRODUCT_RE, { message: "satProductCode debe ser 8 dígitos" })
  satProductCode?: string;

  @IsOptional()
  @IsString()
  @Matches(SAT_UNIT_RE, { message: "satUnitCode inválido" })
  satUnitCode?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => VariantInputDto)
  variants!: VariantInputDto[];
}

export class UpdateProductDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsIn(STATUS_VALUES)
  status?: (typeof STATUS_VALUES)[number];
}

export class AddVariantDto extends VariantInputDto {}

export class UpdateVariantDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @Matches(PRICE_RE, { message: "price debe tener formato NN.NN" })
  price?: string;

  @IsOptional()
  @IsString()
  @Matches(SAT_PRODUCT_RE, { message: "satProductCode debe ser 8 dígitos" })
  satProductCode?: string;

  @IsOptional()
  @IsString()
  @Matches(SAT_UNIT_RE, { message: "satUnitCode inválido" })
  satUnitCode?: string;

  @IsOptional()
  @IsIn(STATUS_VALUES)
  status?: (typeof STATUS_VALUES)[number];
}
