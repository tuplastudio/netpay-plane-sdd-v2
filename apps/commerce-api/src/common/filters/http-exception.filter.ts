import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Request, Response } from "express";
import { RequestContext } from "../context/request-context.js";
import { ErrorCode, ApiErrorResponse } from "@netpay/contracts";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const status = this.statusOf(exception);
    const body = this.bodyOf(exception, status);

    if (status >= 500) {
      this.logger.error(`${req.method} ${req.url} -> ${status}`, exception instanceof Error ? exception.stack : String(exception));
    }

    res.status(status).json(body);
  }

  private statusOf(exception: unknown): number {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private bodyOf(exception: unknown, status: number): ApiErrorResponse {
    const requestId = RequestContext.requestId || "unknown";
    const code = this.codeFor(status);
    const message =
      exception instanceof HttpException
        ? String(exception.message)
        : "Internal server error";
    return {
      error: {
        code,
        message: status >= 500 ? "Internal server error" : message,
        retryable: status === HttpStatus.SERVICE_UNAVAILABLE || status === HttpStatus.TOO_MANY_REQUESTS,
        traceId: requestId,
      },
      requestId,
    };
  }

  private codeFor(status: number): ErrorCode {
    if (status === 400) return "VALIDATION_FAILED";
    if (status === 401) return "UNAUTHORIZED";
    if (status === 403) return "FORBIDDEN";
    if (status === 404) return "NOT_FOUND";
    if (status === 409) return "CONFLICT";
    if (status === 422) return "RULE_VIOLATION";
    if (status === 429) return "RATE_LIMITED";
    if (status === 503) return "DEPENDENCY_UNAVAILABLE";
    return "DEPENDENCY_UNAVAILABLE";
  }
}