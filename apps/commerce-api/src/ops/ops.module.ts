import { Module } from "@nestjs/common";
import { AuditController } from "./audit.controller.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  controllers: [AuditController],
})
export class OpsModule {}