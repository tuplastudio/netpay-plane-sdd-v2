import type { RouteDef } from "./types.js";
import { catalogRoutes } from "./catalog.js";
import { quoteRoutes } from "./quotes.js";
import { customerRoutes } from "./customers.js";
import { orderRoutes } from "./orders.js";
import { paymentRoutes } from "./payments.js";
import { pricingRoutes } from "./pricing.js";
import { shippingRoutes } from "./shipping.js";
import { reportRoutes } from "./reports.js";
import { notificationRoutes } from "./notifications.js";
import { integrationRoutes } from "./integrations.js";
import { usageRoutes } from "./usage.js";
import { conversationRoutes } from "./conversations.js";
import { auditRoutes } from "./audit.js";
import { superAdminRoutes } from "./super-admin.js";

export const allRoutes: RouteDef[] = [
  ...catalogRoutes,
  ...quoteRoutes,
  ...customerRoutes,
  ...orderRoutes,
  ...paymentRoutes,
  ...pricingRoutes,
  ...shippingRoutes,
  ...reportRoutes,
  ...notificationRoutes,
  ...integrationRoutes,
  ...usageRoutes,
  ...conversationRoutes,
  ...auditRoutes,
  ...superAdminRoutes,
];
