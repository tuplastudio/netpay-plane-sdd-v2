import { Global, Module } from "@nestjs/common";
import { RequestIdMiddleware } from "./middleware/request-id.middleware.js";
import { SecurityHeadersMiddleware, RateLimitMiddleware } from "../ops/security.middleware.js";
import { Reflector } from "@nestjs/core";

@Global()
@Module({
  providers: [
    RequestIdMiddleware,
    SecurityHeadersMiddleware,
    RateLimitMiddleware,
    Reflector,
  ],
  exports: [
    RequestIdMiddleware,
    SecurityHeadersMiddleware,
    RateLimitMiddleware,
    Reflector,
  ],
})
export class CommonModule {}