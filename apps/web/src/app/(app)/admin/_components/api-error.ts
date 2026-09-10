/**
 * Mensaje legible de un error de axios contra commerce-api. El backend responde
 * `{ message }` o `{ error: { message } }`; si no hay nada útil, cae al texto
 * que pasa la pantalla.
 */
export function apiErrorMessage(error: unknown, fallback: string): string {
  const detail = (
    error as { response?: { data?: { message?: string; error?: { message?: string } } } } | null
  )?.response?.data;
  return detail?.error?.message ?? detail?.message ?? fallback;
}
