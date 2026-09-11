import { Transform } from "class-transformer";
import { IsEmail, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from "class-validator";

// Igual que catalog.dto.ts / quote.dto.ts: un `@Body() body: {...}` con tipo
// literal no llega al ValidationPipe con metatype, así que no se valida nada en
// runtime. En /auth eso significaba, entre otras cosas, que a `POST
// /auth/bootstrap` (ruta @Public) le faltara un campo y el fallo saliera como
// 500 al reventar dentro del servicio, en vez de un 400 con el campo ausente.

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

/**
 * Body de POST /auth/bootstrap (@Public).
 * `timezone` la valida además BootstrapService contra la base IANA de Intl;
 * aquí solo se acota la forma para que un cuerpo incompleto sea 400 y no 500.
 */
export class BootstrapTenantDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  tenantName!: string;

  @Transform(trim)
  @IsEmail({}, { message: "ownerEmail debe ser un correo válido" })
  @MaxLength(254)
  ownerEmail!: string;

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  ownerFullName!: string;

  @IsString()
  @MinLength(12, { message: "ownerPassword debe tener al menos 12 caracteres" })
  @MaxLength(256)
  ownerPassword!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  timezone!: string;
}

/** Body de POST /auth/login (@Public). */
export class LoginDto {
  @Transform(trim)
  @IsEmail({}, { message: "email debe ser un correo válido" })
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(1, { message: "password requerido" })
  @MaxLength(256)
  password!: string;

  /** Empresa concreta cuando el correo tiene varias membresías. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  tenantSlug?: string;
}

/**
 * Código de segundo factor: un TOTP de 6 dígitos o un recovery code. Se acota
 * el juego de caracteres para que no sirva de campo de texto libre.
 */
const MFA_CODE_RE = /^[A-Za-z0-9-]{6,64}$/;

/** Body de POST /auth/mfa/verify (@Public, segundo paso del login). */
export class VerifyMfaDto {
  @IsString()
  @MinLength(12, { message: "challengeToken debe tener al menos 12 caracteres" })
  @MaxLength(512, { message: "challengeToken demasiado largo" })
  challengeToken!: string;

  @Transform(trim)
  @IsString()
  @Matches(MFA_CODE_RE, { message: "code inválido" })
  code!: string;
}

/**
 * Body de los endpoints de MFA con sesión activa: confirmar enrolamiento,
 * apagar MFA y regenerar recovery codes. Los tres piden lo mismo.
 */
export class MfaCodeDto {
  @Transform(trim)
  @IsString()
  @Matches(MFA_CODE_RE, { message: "code inválido" })
  code!: string;
}

/** Body de POST /auth/accept-invite (@Public). */
export class AcceptInviteDto {
  @IsString()
  @MinLength(12, { message: "token debe tener al menos 12 caracteres" })
  @MaxLength(512, { message: "token demasiado largo" })
  token!: string;

  @IsString()
  @MinLength(12, { message: "password debe tener al menos 12 caracteres" })
  @MaxLength(256, { message: "password demasiado largo" })
  password!: string;
}

/**
 * Body de POST /auth/forgot-password.
 * Solo email: la respuesta es uniforme, no hay parámetros adicionales.
 */
export class ForgotPasswordDto {
  @IsEmail({}, { message: "email debe ser un correo válido" })
  @MaxLength(254)
  email!: string;
}

/**
 * Body de POST /auth/reset-password.
 * La complejidad real del password la verifica PasswordService al hashear;
 * aquí solo pedimos un mínimo razonable para evitar tráfico absurdo.
 */
export class ResetPasswordDto {
  @IsString()
  @MinLength(12, { message: "token debe tener al menos 12 caracteres" })
  @MaxLength(512, { message: "token demasiado largo" })
  token!: string;

  @IsString()
  @MinLength(12, { message: "newPassword debe tener al menos 12 caracteres" })
  @MaxLength(256, { message: "newPassword demasiado largo" })
  newPassword!: string;
}

/**
 * Body de POST /auth/change-password (sesión activa).
 * El usuario autenticado manda su contraseña actual + la nueva; el servicio
 * revisa que coincida antes de hashear la nueva. La complejidad de la nueva
 * la verifica PasswordService al hashear.
 */
export class ChangePasswordDto {
  @IsString()
  @MinLength(1, { message: "currentPassword requerido" })
  @MaxLength(256, { message: "currentPassword demasiado largo" })
  currentPassword!: string;

  @IsString()
  @MinLength(12, { message: "newPassword debe tener al menos 12 caracteres" })
  @MaxLength(256, { message: "newPassword demasiado largo" })
  newPassword!: string;
}

/**
 * Body de POST /auth/switch-tenant (sesión activa).
 * El usuario elige una de sus empresas; el servicio verifica que tenga
 * membresía ACTIVE ahí antes de mover la sesión.
 */
export class SwitchTenantDto {
  @IsUUID("all", { message: "tenantId debe ser un UUID" })
  tenantId!: string;
}
