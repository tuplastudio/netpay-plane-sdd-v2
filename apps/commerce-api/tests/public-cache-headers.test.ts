import { describe, expect, it } from "vitest";
import {
  PUBLIC_CACHE_CONTROL,
  isPublicReadRequest,
  publicCacheHeaders,
} from "../src/common/http/public-cache-headers.js";

/**
 * Lecturas públicas por token (cotización, checkout, seguimiento): siempre
 * revalidar (`private, no-cache`) y dejar que el ETag de Express dé 304. Las
 * mutaciones y las rutas autenticadas no reciben la cabecera.
 */
const PREFIXES = ["/api/v1/quotes/public", "/api/v1/orders/public"];

describe("isPublicReadRequest", () => {
  it("GET/HEAD bajo un prefijo público", () => {
    expect(isPublicReadRequest("GET", "/api/v1/quotes/public/abc", PREFIXES)).toBe(true);
    expect(isPublicReadRequest("GET", "/api/v1/quotes/public/abc/pdf", PREFIXES)).toBe(true);
    expect(isPublicReadRequest("HEAD", "/api/v1/orders/public/track/t1", PREFIXES)).toBe(true);
  });

  it("no aplica a mutaciones ni a rutas autenticadas ni a prefijos parecidos", () => {
    expect(isPublicReadRequest("POST", "/api/v1/orders/public/abc/checkout", PREFIXES)).toBe(false);
    expect(isPublicReadRequest("GET", "/api/v1/orders", PREFIXES)).toBe(false);
    expect(isPublicReadRequest("GET", "/api/v1/orders/publicity", PREFIXES)).toBe(false);
    expect(isPublicReadRequest("GET", "/api/v1/quotes/abc", PREFIXES)).toBe(false);
  });
});

describe("publicCacheHeaders", () => {
  function run(method: string, path: string) {
    const headers: Record<string, string> = {};
    let nextCalled = false;
    const mw = publicCacheHeaders(PREFIXES);
    mw(
      { method, path } as never,
      { setHeader: (k: string, v: string) => (headers[k] = v) } as never,
      () => {
        nextCalled = true;
      },
    );
    return { headers, nextCalled };
  }

  it("pone Cache-Control en la lectura pública y siempre llama next", () => {
    const pub = run("GET", "/api/v1/quotes/public/tok");
    expect(pub.headers["Cache-Control"]).toBe(PUBLIC_CACHE_CONTROL);
    expect(pub.nextCalled).toBe(true);

    const priv = run("GET", "/api/v1/orders");
    expect(priv.headers["Cache-Control"]).toBeUndefined();
    expect(priv.nextCalled).toBe(true);
  });

  it("la política exige revalidar y es privada", () => {
    expect(PUBLIC_CACHE_CONTROL).toBe("private, no-cache");
  });
});
