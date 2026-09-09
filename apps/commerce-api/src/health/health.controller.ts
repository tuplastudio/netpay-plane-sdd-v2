import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { Public } from "../auth/guards/principal.guard.js";

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get("healthz")
  async healthz() {
    return { status: "ok", uptime: process.uptime(), version: "0.1.0" };
  }

  @Public()
  @Get("readyz")
  async readyz() {
    let dbOk = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      dbOk = true;
    } catch {
      dbOk = false;
    }
    return {
      status: dbOk ? "ready" : "degraded",
      checks: { database: dbOk ? "ok" : "down" },
    };
  }
}