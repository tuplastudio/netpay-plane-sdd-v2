import { MiddlewareConsumer, NestModule } from "@nestjs/common";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { HealthModule } from "./health/health.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { PrincipalGuard } from "./auth/guards/principal.guard.js";
import { CatalogModule } from "./catalog/catalog.module.js";
import { CustomerModule } from "./customers/customer.module.js";
import { PricingModule } from "./pricing/pricing.module.js";
import { QuoteModule } from "./quotes/quote.module.js";
import { OrderModule } from "./orders/order.module.js";
import { PaymentModule } from "./payments/payment.module.js";
import { ReportsModule } from "./reports/reports.module.js";
import { NotificationModule } from "./notifications/notification.module.js";
import { IntegrationModule } from "./integrations/integration.module.js";
import { WhatsAppModule } from "./whatsapp/whatsapp.module.js";
import { OpsModule } from "./ops/ops.module.js";
import { TenantsModule } from "./tenants/tenants.module.js";
import { ShippingModule } from "./shipping/shipping.module.js";
import { UsageModule } from "./usage/usage.module.js";
import { SuperAdminModule } from "./super-admin/super-admin.module.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { AgentProxyModule } from "./agent-proxy.module.js";
import { CommonModule } from "./common/common.module.js";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter.js";
import { RequestIdMiddleware } from "./common/middleware/request-id.middleware.js";
import { RateLimitMiddleware, SecurityHeadersMiddleware } from "./ops/security.middleware.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: [".env", "../../.env"],
    }),
    PrismaModule,
    CommonModule,
    HealthModule,
    AuthModule,
    CatalogModule,
    PricingModule,
    CustomerModule,
    QuoteModule,
    OrderModule,
    PaymentModule,
    ReportsModule,
    NotificationModule,
    IntegrationModule,
    WhatsAppModule,
    OpsModule,
    TenantsModule,
    ShippingModule,
    UsageModule,
    SuperAdminModule,
    AgentProxyModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    {
      provide: APP_GUARD,
      useClass: PrincipalGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestIdMiddleware, SecurityHeadersMiddleware, RateLimitMiddleware)
      .forRoutes("*");
  }
}