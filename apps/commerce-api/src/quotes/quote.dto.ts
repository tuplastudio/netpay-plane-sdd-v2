import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

// Mismo motivo que catalog.dto.ts: un `@Body() body: {...}` con tipo
// literal no se valida en runtime pese al ValidationPipe global.

const QUANTITY_RE = /^\d+\.\d{3}$/;

export class QuoteLineDto {
  @IsUUID()
  variantId!: string;

  @IsString()
  @Matches(QUANTITY_RE, { message: "quantity debe tener formato NN.NNN" })
  quantity!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPct?: number;
}

export class CreateQuoteDto {
  @IsUUID()
  customerId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuoteLineDto)
  lines!: QuoteLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  issue?: boolean;
}

export class UpdateQuoteDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuoteLineDto)
  lines?: QuoteLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class PricingPreviewDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuoteLineDto)
  lines!: QuoteLineDto[];

  @IsOptional()
  @IsIn(["PICKUP", "LOCAL_DELIVERY"])
  deliveryMode?: "PICKUP" | "LOCAL_DELIVERY";

  /** Para envío a domicilio: con estos datos el backend elige la zona del
   *  admin. Cualquier campo faltante cae al `shippingFlat` del tenant. */
  @IsOptional()
  @IsString()
  @MaxLength(10)
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

export class ShareQuoteDto {
  /**
   * `false` cuando quien comparte ya le mandó el enlace al cliente por su
   * cuenta (el agente de WhatsApp lo pone en su propia respuesta): evita que
   * el dispatcher de notificaciones le mande el mismo enlace otra vez.
   */
  @IsOptional()
  @IsBoolean()
  notify?: boolean;
}
