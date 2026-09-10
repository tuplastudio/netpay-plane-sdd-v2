/**
 * Paginación cursor-based reutilizable para endpoints de listado.
 *
 * Patrón: el cliente manda `cursor` (id del último elemento visto) y
 * `limit`. El backend devuelve `{ items, nextCursor }` donde `nextCursor`
 * es `null` cuando ya no hay más resultados. Esto evita los problemas
 * del offset (que se desordena cuando se insertan filas mientras el
 * usuario pagina) y se queda escalable: solo lee `limit + 1` filas de
 * la BD y corta la última.
 *
 * El orden por defecto es `updatedAt DESC, id DESC` (id como
 * desempate para claves con el mismo timestamp): cualquier entidad que
 * use este helper comparte ese orden, lo que hace que los cursors
 * sean comparables entre páginas sin "saltarse" filas.
 */
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export interface PageInfo {
  /** Cursor para pedir la siguiente página. `null` cuando no hay más. */
  nextCursor: string | null;
  /** Tamaño efectivo de la página devuelta (≤ limit). */
  size: number;
  /** Si el cliente pidió un cursor pero no devolvimos nada, fue inválido. */
  invalidCursor?: boolean;
}

/**
 * Toma una lista ordenada por (updatedAt DESC, id DESC) y devuelve la
 * página más `limit` elementos posteriores al `cursor`. Si el cursor no
 * existe en la lista (p. ej. porque se borró la fila), lo ignora y
 * devuelve desde el principio.
 *
 * El caller debe pedir `limit + 1` filas a la BD: la fila extra es la
 * señal de "hay más". Esta función se encarga del corte.
 */
export function paginate<T extends { id: string; updatedAt: Date }>(
  rows: T[],
  limit: number,
  cursor: string | null | undefined,
): { items: T[]; pageInfo: PageInfo } {
  const safeLimit = Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);
  let startIndex = 0;
  let invalidCursor = false;
  if (cursor) {
    const idx = rows.findIndex((r) => r.id === cursor);
    if (idx === -1) {
      invalidCursor = true;
    } else {
      startIndex = idx + 1;
    }
  }
  const slice = rows.slice(startIndex, startIndex + safeLimit);
  const hasMore = startIndex + safeLimit < rows.length;
  return {
    items: slice,
    pageInfo: {
      nextCursor: hasMore ? slice[slice.length - 1]!.id : null,
      size: slice.length,
      invalidCursor,
    },
  };
}

/**
 * Helper para hacer el `findMany` + `paginate` en una sola línea.
 * Pide `limit + 1` filas; corta la última y devuelve el cursor.
 */
export async function listPage<T extends { id: string; updatedAt: Date }>(
  query: (take: number) => Promise<T[]>,
  limit: number,
  cursor: string | null | undefined,
): Promise<{ items: T[]; pageInfo: PageInfo }> {
  const safeLimit = Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);
  const rows = await query(safeLimit + 1);
  // Si la última fila es la "+1", hay siguiente página.
  let startIndex = 0;
  let invalidCursor = false;
  if (cursor) {
    const idx = rows.findIndex((r) => r.id === cursor);
    if (idx === -1) {
      invalidCursor = true;
    } else {
      startIndex = idx + 1;
    }
  }
  const slice = rows.slice(startIndex, startIndex + safeLimit);
  return {
    items: slice,
    pageInfo: {
      nextCursor: slice.length === safeLimit && startIndex + safeLimit < rows.length
        ? slice[slice.length - 1]!.id
        : null,
      size: slice.length,
      invalidCursor,
    },
  };
}