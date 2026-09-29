import { describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { buildPageInfo, parsePaging } from "../src/common/pagination.js";

const OPTS = { defaultLimit: 25, maxLimit: 100 };

describe("parsePaging", () => {
  it("sin params devuelve la primera página con el default", () => {
    expect(parsePaging({}, OPTS)).toEqual({ limit: 25, offset: 0 });
    expect(parsePaging({ limit: "", offset: "" }, OPTS)).toEqual({ limit: 25, offset: 0 });
  });

  it("acepta strings y números", () => {
    expect(parsePaging({ limit: "10", offset: "30" }, OPTS)).toEqual({ limit: 10, offset: 30 });
    expect(parsePaging({ limit: 5, offset: 0 }, OPTS)).toEqual({ limit: 5, offset: 0 });
  });

  it("recorta limit al máximo del endpoint", () => {
    expect(parsePaging({ limit: "500" }, OPTS).limit).toBe(100);
    expect(parsePaging({ limit: "500" }, { defaultLimit: 50, maxLimit: 200 }).limit).toBe(200);
  });

  it("rechaza NaN, decimales y fuera de rango con 400", () => {
    for (const bad of [{ limit: "abc" }, { limit: "0" }, { limit: "-1" }, { limit: "1.5" }]) {
      expect(() => parsePaging(bad, OPTS)).toThrow(BadRequestException);
    }
    for (const bad of [{ offset: "-1" }, { offset: "x" }, { offset: "2.5" }]) {
      expect(() => parsePaging(bad, OPTS)).toThrow(BadRequestException);
    }
  });
});

describe("buildPageInfo", () => {
  it("arma total/limit/offset", () => {
    expect(buildPageInfo(120, { limit: 25, offset: 50 })).toEqual({ total: 120, limit: 25, offset: 50 });
  });
});
