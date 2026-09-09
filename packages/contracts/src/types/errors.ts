import type { RequestEnvelope } from "./common.js";

export type ErrorCode =
  | "VALIDATION_FAILED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "IDEMPOTENCY_REPLAY"
  | "RULE_VIOLATION"
  | "RATE_LIMITED"
  | "DEPENDENCY_UNAVAILABLE"
  | "PAYMENT_PROVIDER_NOT_DUMMY"
  | "TENANT_MISMATCH";

export interface FieldError {
  path: string; // dot notation, ej: "lines.2.quantity"
  message: string;
  code: string;
}

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  fieldErrors?: FieldError[];
  retryable: boolean;
  /** ID interno de la operación para correlación. */
  traceId: string;
}

export interface ApiErrorResponse {
  error: ApiErrorBody;
  requestId: string;
}

export type ApiResult<T> = RequestEnvelope<T> | ApiErrorResponse;