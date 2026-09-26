import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { SuperAdminModule } from "../super-admin/super-admin.module.js";
import {
  SuperAdminApiKeysController,
  SuperAdminTenantsController,
  TenantSelfController,
} from "./tenants.controller.js";
import { TenantProvisioningService } from "./tenant-provisioning.service.js";
import { TenantLogoService } from "./tenant-logo.service.js";

@Module({
  imports: [AuthModule, SuperAdminModule],
  controllers: [SuperAdminTenantsController, SuperAdminApiKeysController, TenantSelfController],
  providers: [TenantProvisioningService, TenantLogoService],
  exports: [TenantProvisioningService],
})
export class TenantsModule {}
