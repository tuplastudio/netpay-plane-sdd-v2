import { createHash } from "node:crypto";
import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { validateLogo } from "./logo-validation.js";
import { deleteObject, keyFromPublicUrl, publicUrlForKey, writeObject } from "./logo-storage.js";

export interface UploadedLogo {
  buffer: Buffer;
  mimetype?: string;
  originalname?: string;
  size?: number;
}

const PURPOSE = "tenant.logo";

/**
 * Sube/quita el logo de la empresa: valida bytes, guarda el archivo, apunta
 * `Tenant.logoUrl` a la URL pública, deja un `StorageObject` y una entrada de
 * bitácora, y retira el archivo anterior (si era nuestro).
 */
@Injectable()
export class TenantLogoService {
  private readonly logger = new Logger(TenantLogoService.name);

  constructor(private readonly prisma: PrismaService) {}

  async upload(tenantId: string, actorId: string | null, file: UploadedLogo | undefined) {
    if (!file?.buffer) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "Adjunta el archivo del logo en el campo «file».",
      });
    }
    const meta = validateLogo(file.buffer, file.mimetype);

    const current = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { logoUrl: true },
    });
    if (!current) throw new NotFoundException({ code: "NOT_FOUND", message: "Tenant no encontrado" });

    const hash = createHash("sha256").update(file.buffer).digest("hex").slice(0, 16);
    const key = `tenants/${tenantId}/logo-${hash}.${meta.ext}`;
    await writeObject(key, file.buffer);
    const logoUrl = publicUrlForKey(key);

    const metadata = {
      width: meta.width,
      height: meta.height,
      originalName: file.originalname ?? null,
    };
    await this.prisma.storageObject.upsert({
      where: { tenantId_key: { tenantId, key } },
      create: {
        tenantId,
        key,
        contentType: meta.mime,
        sizeBytes: file.buffer.length,
        purpose: PURPOSE,
        metadata,
        uploadedBy: actorId,
      },
      update: {
        contentType: meta.mime,
        sizeBytes: file.buffer.length,
        metadata,
        uploadedBy: actorId,
        deletedAt: null,
      },
    });

    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { logoUrl, version: { increment: 1 } },
    });

    await this.retire(tenantId, current.logoUrl, key);

    await this.prisma.auditLog.create({
      data: {
        tenantId,
        actorId,
        action: "tenant.logo_updated",
        targetType: "Tenant",
        targetId: tenantId,
        metadata: {
          key,
          contentType: meta.mime,
          sizeBytes: file.buffer.length,
          width: meta.width,
          height: meta.height,
          previousLogoUrl: current.logoUrl,
        },
      },
    });

    return tenant;
  }

  async remove(tenantId: string, actorId: string | null) {
    const current = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { logoUrl: true },
    });
    if (!current) throw new NotFoundException({ code: "NOT_FOUND", message: "Tenant no encontrado" });

    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { logoUrl: null, version: { increment: 1 } },
    });

    await this.retire(tenantId, current.logoUrl, null);

    if (current.logoUrl) {
      await this.prisma.auditLog.create({
        data: {
          tenantId,
          actorId,
          action: "tenant.logo_removed",
          targetType: "Tenant",
          targetId: tenantId,
          metadata: { previousLogoUrl: current.logoUrl },
        },
      });
    }

    return tenant;
  }

  /**
   * Borra el archivo anterior solo si vive en nuestro almacenamiento y bajo el
   * prefijo del tenant (una URL externa pegada por PATCH /branding se deja en
   * paz). Un fallo aquí no revierte el cambio: el logo nuevo ya está guardado.
   */
  private async retire(tenantId: string, previousUrl: string | null, keepKey: string | null): Promise<void> {
    const key = keyFromPublicUrl(previousUrl);
    if (!key || key === keepKey || !key.startsWith(`tenants/${tenantId}/`)) return;
    try {
      await deleteObject(key);
      await this.prisma.storageObject.updateMany({
        where: { tenantId, key, deletedAt: null },
        data: { deletedAt: new Date() },
      });
    } catch (err) {
      this.logger.warn(`No se pudo retirar el logo anterior ${key}: ${String(err)}`);
    }
  }
}
