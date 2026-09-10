import { Transform } from "class-transformer";
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import type { Role } from "@prisma/client";
import { ASSIGNABLE_ROLES } from "../auth/membership.service.js";

const MEMBERSHIP_STATUSES = ["ACTIVE", "DISABLED"] as const;
export type AdminMembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

export class UpdateTenantDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;
}

/** Igual que la invitación de /iam pero admite cualquier rol: el super-admin
 * sí puede nombrar propietarios y administradores de una empresa. */
export class CreateTenantInvitationDto {
  @Transform(trim)
  @IsEmail()
  email!: string;

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  fullName!: string;

  @IsIn(ASSIGNABLE_ROLES)
  role!: Role;
}

export class UpdateTenantMembershipDto {
  @IsOptional()
  @IsIn(ASSIGNABLE_ROLES)
  role?: Role;

  @IsOptional()
  @IsIn(MEMBERSHIP_STATUSES)
  status?: AdminMembershipStatus;
}
