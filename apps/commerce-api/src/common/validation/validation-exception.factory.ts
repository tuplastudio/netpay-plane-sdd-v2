import { BadRequestException, ValidationError } from "@nestjs/common";

/**
 * `exceptionFactory` del ValidationPipe global.
 *
 * El factory por defecto devuelve `message` como **array** de strings, y
 * `HttpExceptionFilter` solo sabe propagar `message` cuando es string: por eso
 * todo rechazo de DTO llegaba al cliente como el genérico
 * "Bad Request Exception" en vez del error de campo real.
 *
 * Aquí se aplana el árbol de `ValidationError` a una sola frase en español
 * (es-MX) y se lanza con la misma forma `{ code, message }` que usa el resto
 * del API, de modo que el filtro la copie tal cual al sobre
 * `{ error: { code, message, ... } }` sin cambiar el status 400.
 */

/**
 * Traducción de los mensajes por defecto de class-validator (inglés) al
 * español. Se hace por texto y no por clave de constraint a propósito: así los
 * argumentos numéricos (longitudes, mínimos, lista de valores permitidos)
 * viajan dentro del propio mensaje, y un `@Matches(..., { message: "..." })`
 * escrito a mano en el DTO — que ya viene en español — no coincide con ninguna
 * regla y se conserva intacto.
 *
 * La tabla cubre todos los validadores usados hoy en los DTOs del API
 * (IsString, IsUUID, IsInt, IsNumber, IsBoolean, IsArray, ArrayMinSize,
 * MinLength, MaxLength, Min, Max, IsIn, Matches, IsOptional) más los que
 * genera el propio pipe (`forbidNonWhitelisted`).
 */
const RULES: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^property (.+) should not exist$/, (m) => `el campo ${m[1]} no está permitido`],
  [/^(.+) should not be empty$/, (m) => `${m[1]} es obligatorio`],
  [/^(.+) must be a string$/, (m) => `${m[1]} debe ser texto`],
  [/^(.+) must be a UUID$/, (m) => `${m[1]} debe ser un UUID válido`],
  [/^(.+) must be an integer number$/, (m) => `${m[1]} debe ser un número entero`],
  [
    /^(.+) must be a number conforming to the specified constraints$/,
    (m) => `${m[1]} debe ser un número`,
  ],
  [/^(.+) must be a boolean value$/, (m) => `${m[1]} debe ser verdadero o falso`],
  [/^(.+) must be an array$/, (m) => `${m[1]} debe ser una lista`],
  [
    /^(.+) must contain at least (\d+) elements$/,
    (m) => `${m[1]} debe tener al menos ${m[2]} elemento(s)`,
  ],
  [
    /^(.+) must contain not more than (\d+) elements$/,
    (m) => `${m[1]} debe tener como máximo ${m[2]} elemento(s)`,
  ],
  [
    /^(.+) must be longer than or equal to (\d+) characters$/,
    (m) => `${m[1]} debe tener al menos ${m[2]} caracteres`,
  ],
  [
    /^(.+) must be shorter than or equal to (\d+) characters$/,
    (m) => `${m[1]} debe tener como máximo ${m[2]} caracteres`,
  ],
  [/^(.+) must not be less than (.+)$/, (m) => `${m[1]} no puede ser menor que ${m[2]}`],
  [/^(.+) must not be greater than (.+)$/, (m) => `${m[1]} no puede ser mayor que ${m[2]}`],
  [
    /^(.+) must be one of the following values: (.+)$/,
    (m) => `${m[1]} debe ser uno de: ${m[2]}`,
  ],
  [/^(.+) must be a valid enum value$/, (m) => `${m[1]} tiene un valor no permitido`],
  [/^(.+) must match .+ regular expression$/, (m) => `${m[1]} tiene un formato inválido`],
  [/^(.+) must be a Date instance$/, (m) => `${m[1]} debe ser una fecha`],
  [/^(.+) must be a valid ISO 8601 date string$/, (m) => `${m[1]} debe ser una fecha ISO 8601`],
  [/^(.+) must be an email$/, (m) => `${m[1]} debe ser un correo válido`],
];

/** Detecta un mensaje por defecto de class-validator que no cubrimos arriba. */
const LOOKS_ENGLISH = /\b(must|should)\b/;

function translate(raw: string, property: string, path: string): string {
  // El mensaje nombra la propiedad hoja ("quantity ..."); dentro de un objeto
  // anidado queremos la ruta completa ("lines.0.quantity ...").
  let text = raw;
  if (path !== property) {
    if (text.startsWith(`${property} `)) {
      text = `${path}${text.slice(property.length)}`;
    } else if (text.startsWith(`property ${property} `)) {
      text = `property ${path}${text.slice(`property ${property}`.length)}`;
    }
  }

  for (const [re, render] of RULES) {
    const match = text.match(re);
    if (match) return render(match);
  }

  // Mensaje propio del DTO (ya en español): se respeta tal cual.
  if (!LOOKS_ENGLISH.test(text)) return text;

  // Red de seguridad: nunca dejamos salir inglés a la pantalla.
  return `${path} no es válido`;
}

/** Aplana el árbol de errores (incluye `@ValidateNested`) a frases sueltas. */
export function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = "",
): string[] {
  const out: string[] = [];
  for (const error of errors) {
    const path = parentPath ? `${parentPath}.${error.property}` : error.property;
    for (const raw of Object.values(error.constraints ?? {})) {
      out.push(translate(raw, error.property, path));
    }
    if (error.children?.length) {
      out.push(...flattenValidationErrors(error.children, path));
    }
  }
  return out;
}

export function validationExceptionFactory(errors: ValidationError[]): BadRequestException {
  const details = [...new Set(flattenValidationErrors(errors))];
  const message = details.length
    ? `Datos inválidos: ${details.join("; ")}`
    : "Datos inválidos";
  return new BadRequestException({ code: "VALIDATION_FAILED", message });
}
