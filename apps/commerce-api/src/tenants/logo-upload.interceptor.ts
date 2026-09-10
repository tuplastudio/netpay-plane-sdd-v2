import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { MAX_LOGO_BYTES } from "./logo-validation.js";

const Inner = FileInterceptor("file", {
  // Memoria: el archivo cabe holgado (≤ 2 MB) y se valida antes de tocar disco.
  limits: { fileSize: MAX_LOGO_BYTES, files: 1, fields: 0 },
});

/**
 * `FileInterceptor` con el límite de multer, pero traduciendo su 413 "File too
 * large" al mismo `VALIDATION_FAILED` en español que el resto de reglas del
 * logo. Así el cliente ve un solo formato de error sea cual sea la regla que
 * falló.
 */
@Injectable()
export class LogoUploadInterceptor implements NestInterceptor {
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
          message: "El logo pesa más de 2 MB; el máximo es 2 MB.",
        });
      }
      throw err;
    }
  }
}
