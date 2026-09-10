import { IsEmail, IsString, IsUUID, MaxLength, MinLength } from "class-validator";

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
