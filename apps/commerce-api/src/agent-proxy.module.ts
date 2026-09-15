import { Module } from "@nestjs/common";
import { AgentProxyController } from "./agent-proxy.controller.js";

@Module({
  controllers: [AgentProxyController],
})
export class AgentProxyModule {}
