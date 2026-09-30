/**
 * Cuerpos de /data-sources. `config` se valida aparte (parseDataSourceConfig)
 * porque su forma depende de `kind`; aquí solo se exige que sea objeto.
 */

import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export const DATA_SOURCE_KINDS = ["REST", "MCP"] as const;
export const DATA_SOURCE_AUTH_TYPES = ["NONE", "BEARER", "API_KEY_HEADER", "BASIC"] as const;
export const DATA_SOURCE_STATUSES = ["ACTIVE", "PAUSED"] as const;

export type DataSourceKindDto = (typeof DATA_SOURCE_KINDS)[number];
export type DataSourceAuthTypeDto = (typeof DATA_SOURCE_AUTH_TYPES)[number];

const HEADER_NAME_RE = /^[A-Za-z0-9-]+$/;

export class CreateDataSourceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsIn(DATA_SOURCE_KINDS, { message: "kind debe ser REST o MCP" })
  kind!: DataSourceKindDto;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  url!: string;

  @IsOptional()
  @IsIn(DATA_SOURCE_AUTH_TYPES, { message: "authType inválido" })
  authType?: DataSourceAuthTypeDto;

  /** Token / API key / "usuario:contraseña". Se cifra; nunca se devuelve. */
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  credential?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(HEADER_NAME_RE, { message: "authHeaderName inválido" })
  authHeaderName?: string;

  @IsOptional()
  @IsObject({ message: "headers debe ser un objeto" })
  headers?: Record<string, string>;

  @IsObject({ message: "config debe ser un objeto" })
  config!: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(7 * 24 * 60)
  scheduleEveryMinutes?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  scheduleCron?: string | null;

  @IsOptional()
  @IsBoolean()
  deactivateMissing?: boolean;

  @IsOptional()
  @IsIn(DATA_SOURCE_STATUSES, { message: "status debe ser ACTIVE o PAUSED" })
  status?: (typeof DATA_SOURCE_STATUSES)[number];
}

export class UpdateDataSourceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  url?: string;

  @IsOptional()
  @IsIn(DATA_SOURCE_AUTH_TYPES, { message: "authType inválido" })
  authType?: DataSourceAuthTypeDto;

  /** Ausente = conservar la credencial guardada; "" = borrarla. */
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  credential?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(HEADER_NAME_RE, { message: "authHeaderName inválido" })
  authHeaderName?: string | null;

  @IsOptional()
  @IsObject({ message: "headers debe ser un objeto" })
  headers?: Record<string, string> | null;

  @IsOptional()
  @IsObject({ message: "config debe ser un objeto" })
  config?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(7 * 24 * 60)
  scheduleEveryMinutes?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  scheduleCron?: string | null;

  @IsOptional()
  @IsBoolean()
  deactivateMissing?: boolean;

  @IsOptional()
  @IsIn(DATA_SOURCE_STATUSES, { message: "status debe ser ACTIVE o PAUSED" })
  status?: (typeof DATA_SOURCE_STATUSES)[number];
}

/**
 * Prueba ad-hoc desde el asistente (antes de guardar). Mismo cuerpo que el
 * alta; `id` opcional para reutilizar la credencial guardada al editar.
 */
export class TestDataSourceDto extends CreateDataSourceDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  id?: string;
}

/** Listar tools de un servidor MCP sin guardar la fuente. */
export class ListToolsDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  url!: string;

  @IsOptional()
  @IsIn(DATA_SOURCE_AUTH_TYPES, { message: "authType inválido" })
  authType?: DataSourceAuthTypeDto;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  credential?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(HEADER_NAME_RE, { message: "authHeaderName inválido" })
  authHeaderName?: string;

  @IsOptional()
  @IsObject({ message: "headers debe ser un objeto" })
  headers?: Record<string, string>;

  /** Fuente guardada de la que tomar la credencial si no se manda. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  id?: string;
}
