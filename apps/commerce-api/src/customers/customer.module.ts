import { Module } from "@nestjs/common";
import { CustomerController } from "./customer.controller.js";
import { CustomerService } from "./customer.service.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  controllers: [CustomerController],
  providers: [CustomerService],
  exports: [CustomerService],
})
export class CustomerModule {}