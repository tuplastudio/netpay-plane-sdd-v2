import { describe, expect, it } from "vitest";
import { mapConversationStatsRow } from "../src/whatsapp/whatsapp.service.js";

/**
 * `conversationStats` ahora es UNA consulta agregada (COUNT ... FILTER). Los
 * COUNT de Postgres llegan como bigint (o null si el driver no encontró
 * filas): el mapeo debe devolver siempre los ocho contadores como number.
 */
describe("mapConversationStatsRow", () => {
  it("convierte bigint/number/null a number en los ocho contadores", () => {
    expect(
      mapConversationStatsRow({
        open: 3n,
        handedOff: 2,
        unanswered: 1n,
        today: null,
        queue: 0n,
        assigned: 2n,
        pending: 1,
        resolvedToday: 4n,
      }),
    ).toEqual({
      open: 3,
      handedOff: 2,
      unanswered: 1,
      today: 0,
      queue: 0,
      assigned: 2,
      pending: 1,
      resolvedToday: 4,
    });
  });

  it("sin fila (tenant sin hilos) devuelve ceros", () => {
    expect(mapConversationStatsRow(undefined)).toEqual({
      open: 0,
      handedOff: 0,
      unanswered: 0,
      today: 0,
      queue: 0,
      assigned: 0,
      pending: 0,
      resolvedToday: 0,
    });
  });
});
