import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { MAX_PRODUCT_IMAGE_BYTES } from "./product-image-validation.js";

const Inner = FileInterceptor("file", {
  limits: { fileSize: MAX_PRODUCT_IMAGE_BYTES, files: 1, fields: 4 },
});

/**
 * `FileInterceptor` con el límite de multer, traduciendo su 413 al mismo
 * `VALIDATION_FAILED` en español que el resto de reglas de la imagen. Mismo
 * patrón que `LogoUploadInterceptor`.
 */
@Injectable()
export class ProductImageUploadInterceptor implements NestInterceptor {
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
          message: "La imagen pesa más de 5 MB; el máximo es 5 MB.",
        });
      }
      throw err;
    }
  }
}
