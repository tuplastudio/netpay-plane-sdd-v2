import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PricingModule } from "../pricing/pricing.module.js";
import {
  DeliveryZonesController,
  ShippingLookupController,
} from "./delivery-zone.controller.js";

@Module({
  imports: [AuthModule, PricingModule],
  controllers: [DeliveryZonesController, ShippingLookupController],
})
export class ShippingModule {}
