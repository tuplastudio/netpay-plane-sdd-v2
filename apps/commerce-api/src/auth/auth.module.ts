import { Module } from "@nestjs/common";
import { EmailModule } from "../email/email.module.js";
import { AuthController } from "./auth.controller.js";
import { ApiKeyController } from "./api-key.controller.js";
import { MembershipController } from "./membership.controller.js";
import { AuthService } from "./auth.service.js";
import { SessionService } from "./session.service.js";
import { PasswordService } from "./password.service.js";
import { RateLimitService } from "./rate-limit.service.js";
import { BootstrapService } from "./bootstrap.service.js";
import { InviteService } from "./invite.service.js";
import { TokenService } from "./token.service.js";
import { MfaService } from "./mfa.service.js";
import { ApiKeyService } from "./api-key.service.js";
import { MembershipService } from "./membership.service.js";
import { InvitationMailer } from "./invitation-mailer.service.js";
import { PasswordResetMailer } from "./password-reset-mailer.service.js";
import { AuthenticatedGuard } from "./guards/authenticated.guard.js";
import { PrincipalGuard } from "./guards/principal.guard.js";
import { RoleGuard } from "./guards/role.guard.js";
import { SuperAdminGuard } from "./guards/super-admin.guard.js";

@Module({
  imports: [EmailModule],
  controllers: [AuthController, ApiKeyController, MembershipController],
  providers: [
    AuthService,
    SessionService,
    PasswordService,
    RateLimitService,
    BootstrapService,
    InviteService,
    TokenService,
    MfaService,
    ApiKeyService,
    MembershipService,
    InvitationMailer,
    PasswordResetMailer,
    AuthenticatedGuard,
    PrincipalGuard,
    RoleGuard,
    SuperAdminGuard,
  ],
  exports: [
    AuthService,
    SessionService,
    PasswordService,
    InviteService,
    TokenService,
    MfaService,
    ApiKeyService,
    MembershipService,
    InvitationMailer,
    PasswordResetMailer,
    AuthenticatedGuard,
    PrincipalGuard,
    RoleGuard,
    SuperAdminGuard,
  ],
})
export class AuthModule {}