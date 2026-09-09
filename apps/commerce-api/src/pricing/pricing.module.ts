import { Module } from "@nestjs/common";
import { PricingService } from "./pricing.service.js";
import { PricingController } from "./pricing.controller.js";

@Module({
  controllers: [PricingController],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
