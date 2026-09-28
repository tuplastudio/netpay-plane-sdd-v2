import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";

const MAX_CONSTANCIA_BYTES = 8 * 1024 * 1024; // 8 MB — mismo tope que order.service.ts

const Inner = FileInterceptor("file", {
  limits: { fileSize: MAX_CONSTANCIA_BYTES, files: 1, fields: 10 },
});

/**
 * `FileInterceptor` con el límite de multer, traduciendo su 413 al mismo
 * `VALIDATION_FAILED` en español que el resto de subidas. Mismo patrón que
 * `ProductImageUploadInterceptor`.
 */
@Injectable()
export class ConstanciaUploadInterceptor implements NestInterceptor {
  private readonly inner: NestInterceptor = new Inner();

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Awaited<ReturnType<NestInterceptor["intercept"]>>> {
    try {
      return await this.inner.intercept(context, next);
    } catch (err) {
      if (err instanceof PayloadTooLargeException) {
        throw new BadRequestException({
          code: "VALIDATION_FAILED",
          message: "El PDF pesa más de 8 MB; el máximo es 8 MB.",
        });
      }
      throw err;
    }
  }
}
