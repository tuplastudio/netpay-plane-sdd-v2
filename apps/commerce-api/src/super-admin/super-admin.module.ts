import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { UsageModule } from "../usage/usage.module.js";
import { SuperAdminController } from "./super-admin.controller.js";
import { SuperAdminService } from "./super-admin.service.js";
import { SuperAdminMembershipService } from "./super-admin-membership.service.js";

@Module({
  imports: [AuthModule, UsageModule],
  controllers: [SuperAdminController],
  providers: [SuperAdminService, SuperAdminMembershipService],
  exports: [SuperAdminService, SuperAdminMembershipService],
})
export class SuperAdminModule {}
