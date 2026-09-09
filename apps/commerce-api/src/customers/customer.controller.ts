import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CustomerService } from "./customer.service.js";
import { RoleGuard, RequireScopes } from "../auth/guards/role.guard.js";
import { RequestContext } from "../common/context/request-context.js";

@Controller("customers")
@UseGuards(RoleGuard)
export class CustomerController {
  constructor(private readonly customers: CustomerService) {}

  @Get()
  @RequireScopes("customers.read")
  async list(@Query("q") q?: string, @Query("includeArchived") includeArchived?: string) {
    const tenantId = this.requireTenant();
    return {
      data: await this.customers.list(tenantId, q, includeArchived === "true"),
      requestId: RequestContext.requestId,
    };
  }

  @Get(":id")
  @RequireScopes("customers.read")
  async get(@Param("id") id: string) {
    const tenantId = this.requireTenant();
    return {
      data: await this.customers.get(tenantId, id),
      requestId: RequestContext.requestId,
    };
  }

  @Get(":id/history")
  @RequireScopes("customers.read")
  async history(@Param("id") id: string) {
    const tenantId = this.requireTenant();
    return {
      data: await this.customers.history(tenantId, id),
      requestId: RequestContext.requestId,
    };
  }

  @Post(":id/archive")
  @RequireScopes("customers.write")
  async archive(@Param("id") id: string) {
    const tenantId = this.requireTenant();
    return {
      data: await this.customers.archive(tenantId, id),
      requestId: RequestContext.requestId,
    };
  }

  @Post(":id/unarchive")
  @RequireScopes("customers.write")
  async unarchive(@Param("id") id: string) {
    const tenantId = this.requireTenant();
    return {
      data: await this.customers.unarchive(tenantId, id),
      requestId: RequestContext.requestId,
    };
  }

  @Post()
  @RequireScopes("customers.write")
  async create(
    @Body()
    body: {
      fullName: string;
      email?: string;
      phone?: string;
      taxId?: string;
      addresses?: Array<{
        label: string;
        line1: string;
        line2?: string;
        city: string;
        state: string;
        postalCode: string;
        country?: string;
        isDefault?: boolean;
      }>;
    },
  ) {
    const tenantId = this.requireTenant();
    return {
      data: await this.customers.create(tenantId, body),
      requestId: RequestContext.requestId,
    };
  }

  @Patch(":id")
  @RequireScopes("customers.write")
  async update(
    @Param("id") id: string,
    @Body()
    body: {
      expectedVersion: number;
      fullName?: string;
      email?: string;
      phone?: string;
      taxId?: string;
    },
  ) {
    const tenantId = this.requireTenant();
    return {
      data: await this.customers.update(tenantId, id, body),
      requestId: RequestContext.requestId,
    };
  }

  @Post(":id/addresses")
  @RequireScopes("customers.write")
  async addAddress(
    @Param("id") id: string,
    @Body()
    body: {
      label: string;
      line1: string;
      line2?: string;
      city: string;
      state: string;
      postalCode: string;
      country?: string;
      isDefault?: boolean;
    },
  ) {
    const tenantId = this.requireTenant();
    return {
      data: await this.customers.addAddress(tenantId, id, body),
      requestId: RequestContext.requestId,
    };
  }

  @Post(":id/identities")
  @RequireScopes("customers.write")
  async linkIdentity(
    @Param("id") id: string,
    @Body() body: { channel: "WHATSAPP_META" | "WHATSAPP_EVOLUTION"; externalId: string },
  ) {
    const tenantId = this.requireTenant();
    return {
      data: await this.customers.linkIdentity(tenantId, id, body.channel, body.externalId),
      requestId: RequestContext.requestId,
    };
  }

  @Post(":id/consents/:scope")
  @RequireScopes("customers.write")
  async grantConsent(
    @Param("id") id: string,
    @Param("scope") scope: "WHATSAPP" | "MARKETING" | "DATA_PROCESSING",
  ) {
    const tenantId = this.requireTenant();
    return {
      data: await this.customers.grantConsent(tenantId, id, scope),
      requestId: RequestContext.requestId,
    };
  }

  @Delete(":id/consents/:scope")
  @RequireScopes("customers.write")
  async revokeConsent(
    @Param("id") id: string,
    @Param("scope") scope: "WHATSAPP" | "MARKETING" | "DATA_PROCESSING",
  ) {
    const tenantId = this.requireTenant();
    return {
      data: await this.customers.revokeConsent(tenantId, id, scope),
      requestId: RequestContext.requestId,
    };
  }

  private requireTenant(): string {
    const t = RequestContext.tenantId;
    if (!t) throw new NotFoundException({ code: "UNAUTHORIZED", message: "Sin tenant" });
    return t;
  }
}