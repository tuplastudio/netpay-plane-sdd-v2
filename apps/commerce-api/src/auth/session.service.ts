import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { hashToken, newSessionToken } from "./rate-limit.service.js";

export interface OpenSessionInput {
  tenantId: string;
  userId: string;
  ipAddress?: string;
  userAgent?: string;
  absoluteTtlMs?: number; // default 12h
  inactivityTtlMs?: number; // default 30min
}

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  async openSession(input: OpenSessionInput): Promise<{ token: string; expiresAt: Date }> {
    const { token, hash } = newSessionToken();
    const now = new Date();
    const absoluteTtl = input.absoluteTtlMs ?? 12 * 60 * 60 * 1000;
    const expiresAt = new Date(now.getTime() + absoluteTtl);

    await this.prisma.session.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        tokenHash: hash,
        issuedAt: now,
        lastActivityAt: now,
        expiresAt,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });

    return { token, expiresAt };
  }

  async resolveSession(token: string | undefined): Promise<{
    sessionId: string;
    userId: string;
    tenantId: string;
    role: string;
  } | null> {
    if (!token) return null;
    const hash = hashToken(token);
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hash },
      include: { tenant: true },
    });
    if (!session) return null;
    if (session.revokedAt) return null;
    if (session.expiresAt.getTime() <= Date.now()) return null;

    const membership = await this.prisma.membership.findUnique({
      where: {
        tenantId_userId: { tenantId: session.tenantId, userId: session.userId },
      },
    });
    if (!membership || membership.status !== "ACTIVE") return null;

    return {
      sessionId: session.id,
      userId: session.userId,
      tenantId: session.tenantId,
      role: membership.role,
    };
  }

  async touchActivity(sessionId: string): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { lastActivityAt: new Date() },
    });
  }

  async revoke(token: string): Promise<void> {
    const hash = hashToken(token);
    await this.prisma.session.updateMany({
      where: { tokenHash: hash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

export class InvalidSessionError extends UnauthorizedException {
  constructor() {
    super({ code: "UNAUTHORIZED", message: "Invalid or expired session" });
  }
}