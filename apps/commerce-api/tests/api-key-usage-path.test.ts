import { describe, expect, it } from "vitest";
import {
  MAX_PATH_LENGTH,
  MAX_USER_AGENT_LENGTH,
  errorCodeForStatus,
  normalizeApiPath,
  truncateUserAgent,
} from "../src/auth/usage/api-key-usage.path.js";

/**
 * La bitácora guarda la FORMA de la ruta, no la petición: ids fuera, query
 * fuera, tokens fuera.
 */
describe("normalizeApiPath", () => {
  it("sustituye UUIDs por :id y quita la query string", () => {
    expect(
      normalizeApiPath("/api/v1/orders/8f3c2a10-1b2c-4d5e-8f90-1234567890ab/items?limit=5"),
    ).toBe("/api/v1/orders/:id/items");
  });

  it("sustituye ids numéricos", () => {
    expect(normalizeApiPath("/api/v1/products/12345")).toBe("/api/v1/products/:id");
  });

  it("nunca deja tokens ni segmentos opacos largos", () => {
    expect(normalizeApiPath("/api/v1/quotes/public/npk_ab12cd34_secretsecret")).toBe(
      "/api/v1/quotes/public/:id",
    );
    expect(normalizeApiPath("/api/v1/orders/track/Zx9KqL2mN8pR4sT6vW1yA3bC5dE7fG")).toBe(
      "/api/v1/orders/track/:id",
    );
  });

  it("conserva segmentos con nombre aunque sean largos", () => {
    expect(normalizeApiPath("/api/v1/whatsapp/conversations/attention-metrics")).toBe(
      "/api/v1/whatsapp/conversations/attention-metrics",
    );
  });

  it("normaliza barras dobles, barra final y fragmento", () => {
    expect(normalizeApiPath("/api/v1//products/#x")).toBe("/api/v1/products");
    expect(normalizeApiPath("")).toBe("/");
  });

  it("recorta rutas absurdamente largas", () => {
    const long = `/api/v1/${"a".repeat(500)}`;
    expect(normalizeApiPath(long)).toHaveLength(MAX_PATH_LENGTH);
  });
});

describe("truncateUserAgent", () => {
  it("recorta a 256 y devuelve null si no hay", () => {
    expect(truncateUserAgent(undefined)).toBeNull();
    expect(truncateUserAgent("")).toBeNull();
    expect(truncateUserAgent("x".repeat(300))).toHaveLength(MAX_USER_AGENT_LENGTH);
    expect(truncateUserAgent("curl/8")).toBe("curl/8");
  });
});

describe("errorCodeForStatus", () => {
  it("habla el mismo idioma que el sobre de error", () => {
    expect(errorCodeForStatus(200)).toBeNull();
    expect(errorCodeForStatus(304)).toBeNull();
    expect(errorCodeForStatus(400)).toBe("VALIDATION_FAILED");
    expect(errorCodeForStatus(401)).toBe("UNAUTHORIZED");
    expect(errorCodeForStatus(403)).toBe("FORBIDDEN");
    expect(errorCodeForStatus(404)).toBe("NOT_FOUND");
    expect(errorCodeForStatus(409)).toBe("CONFLICT");
    expect(errorCodeForStatus(422)).toBe("RULE_VIOLATION");
    expect(errorCodeForStatus(429)).toBe("RATE_LIMITED");
    expect(errorCodeForStatus(503)).toBe("DEPENDENCY_UNAVAILABLE");
    expect(errorCodeForStatus(500)).toBe("INTERNAL_ERROR");
    expect(errorCodeForStatus(418)).toBe("REQUEST_FAILED");
  });
});
