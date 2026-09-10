import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { UsageController, SuperAdminUsageController } from "./usage.controller.js";
import { UsageService } from "./usage.service.js";

@Module({
  imports: [AuthModule],
  controllers: [UsageController, SuperAdminUsageController],
  providers: [UsageService],
  exports: [UsageService],
})
export class UsageModule {}
