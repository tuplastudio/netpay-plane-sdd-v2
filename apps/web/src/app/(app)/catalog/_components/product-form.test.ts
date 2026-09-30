import { describe, expect, it } from "vitest";
import {
  suggestVariantSku,
  toAddVariantPayload,
  toCreateProductPayload,
  toUpdateProductPayload,
  toUpdateVariantPayload,
} from "./product-form";
import { ORIGIN_SYSTEM_OTHER_VALUE } from "./origin-system";

const createValues = {
  sku: " PINT-MATE ",
  title: " Pintura mate ",
  description: "",
  tags: ["pintura"],
  synonyms: [],
  variantSku: "PINT-MATE-1L",
  variantTitle: "1 L",
  price: "99.00",
  stock: "",
  satProductCode: "",
  satUnitCode: "H87",
  originSystem: "",
  originSystemOther: "",
  originExternalId: "",
};

describe("toCreateProductPayload", () => {
  it("recorta, omite vacíos y arma una variante inicial", () => {
    expect(toCreateProductPayload(createValues)).toEqual({
      sku: "PINT-MATE",
      title: "Pintura mate",
      description: undefined,
      tags: ["pintura"],
      synonyms: [],
      variants: [
        {
          sku: "PINT-MATE-1L",
          title: "1 L",
          price: "99.00",
          stock: undefined,
          satProductCode: undefined,
          satUnitCode: "H87",
          originSystem: undefined,
          originExternalId: undefined,
        },
      ],
    });
  });

  it("resuelve el sistema de origen «Otro…» con el texto libre", () => {
    const out = toCreateProductPayload({
      ...createValues,
      description: "Detalle",
      stock: "25.5",
      originSystem: ORIGIN_SYSTEM_OTHER_VALUE,
      originSystemOther: " Mi ERP ",
      originExternalId: " 42 ",
    });
    expect(out.description).toBe("Detalle");
    expect(out.variants[0]).toMatchObject({ stock: "25.5", originSystem: "Mi ERP", originExternalId: "42" });
  });

  it("con un sistema de la lista ignora el texto libre", () => {
    const out = toAddVariantPayload({
      sku: "A",
      title: "A",
      price: "1.00",
      stock: "",
      satProductCode: "",
      satUnitCode: "",
      originSystem: "Shopify",
      originSystemOther: "ignorado",
      originExternalId: "",
    });
    expect(out.originSystem).toBe("Shopify");
  });
});

describe("toUpdateProductPayload", () => {
  it("manda la versión esperada y omite la descripción vacía", () => {
    expect(
      toUpdateProductPayload(
        { title: " T ", description: "  ", tags: [], synonyms: ["x"], status: "ACTIVE" },
        3,
      ),
    ).toEqual({ expectedVersion: 3, title: "T", description: undefined, tags: [], synonyms: ["x"], status: "ACTIVE" });
  });
});

describe("toUpdateVariantPayload", () => {
  it("un campo vacío significa null (borrar), no «no tocar»", () => {
    const out = toUpdateVariantPayload(
      {
        title: "A",
        price: "10.00",
        stock: "",
        satProductCode: "",
        satUnitCode: "",
        status: "DRAFT",
        originSystem: "",
        originSystemOther: "",
        originExternalId: "",
      },
      2,
    );
    expect(out).toEqual({
      expectedVersion: 2,
      title: "A",
      price: "10.00",
      stock: null,
      satProductCode: undefined,
      satUnitCode: undefined,
      status: "DRAFT",
      originSystem: null,
      originExternalId: null,
    });
  });

  it("conserva existencias y origen cuando vienen", () => {
    const out = toUpdateVariantPayload(
      {
        title: "A",
        price: "10.00",
        stock: "3",
        satProductCode: "01010101",
        satUnitCode: "H87",
        status: "ACTIVE",
        originSystem: ORIGIN_SYSTEM_OTHER_VALUE,
        originSystemOther: "ERP casero",
        originExternalId: "id-9",
      },
      1,
    );
    expect(out).toMatchObject({ stock: "3", satProductCode: "01010101", originSystem: "ERP casero", originExternalId: "id-9" });
  });
});

describe("suggestVariantSku", () => {
  it("sugiere BASE-1 y respeta el tope de 64", () => {
    expect(suggestVariantSku(" ABC ")).toBe("ABC-1");
    expect(suggestVariantSku("")).toBe("");
    expect(suggestVariantSku("X".repeat(70))).toHaveLength(64);
  });
});
