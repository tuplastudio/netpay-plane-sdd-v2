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
  ValidateBy,
  type ValidationOptions,
  buildMessage,
} from "class-validator";
import { validateZoneGeometry } from "./geo.js";

const POSTAL_CODE_RE = /^\d{4,5}$/;
/** Color de zona en el mapa: `#rrggbb` (minúsculas o mayúsculas). */
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Decorador: el valor debe ser un GeoJSON `Polygon` / `MultiPolygon` válido
 * (anillos cerrados, ≤2000 vértices, lng/lat en rango). `null` se acepta
 * para "quitar el polígono" en PATCH; `undefined` lo maneja `@IsOptional`.
 * El mensaje de error es el de `validateZoneGeometry`, para que el panel
 * pueda mostrar exactamente qué anillo/posición falló.
 */
export function IsZoneGeometry(validationOptions?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: "isZoneGeometry",
      validator: {
        validate: (value: unknown) => value === null || validateZoneGeometry(value).ok,
        defaultMessage: buildMessage((eachPrefix, args) => {
          const res = validateZoneGeometry(args?.value);
          return eachPrefix + (res.ok ? "polygon inválido" : res.error);
        }, validationOptions),
      },
    },
    validationOptions,
  );
}

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

  /** GeoJSON Polygon / MultiPolygon, coordenadas `[lng, lat]`. */
  @IsOptional()
  @IsZoneGeometry()
  polygon?: Record<string, unknown> | null;

  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR_RE, { message: "color debe ser #rrggbb" })
  color?: string | null;

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

  /** `null` quita el polígono; ausente lo deja como está. */
  @IsOptional()
  @IsZoneGeometry()
  polygon?: Record<string, unknown> | null;

  /** `null` quita el color; ausente lo deja como está. */
  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR_RE, { message: "color debe ser #rrggbb" })
  color?: string | null;

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

  /** Latitud WGS84 (ubicación compartida por el cliente o pin del panel). */
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  /** Longitud WGS84. Se necesita junto con `lat`. */
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;
}
