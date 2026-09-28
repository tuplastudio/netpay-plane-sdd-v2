/**
 * Normaliza un destino de redirección que llega por query (`?next=`).
 *
 * Solo acepta rutas del mismo origen. Rechaza cualquier backslash (los
 * navegadores tratan `/\evil.com` como `//evil.com`), esquemas absolutos y
 * protocol-relative. Devuelve `pathname + search + hash`, nunca un origen.
 */
export function safeRedirect(raw: string | null | undefined, fallback = "/"): string {
  if (!raw || typeof window === "undefined") return fallback;
  if (raw.includes("\\")) return fallback;
  // Caracteres de control (tab, CR, LF) que el parser de URL descarta en silencio.
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return fallback;
  }
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  let url: URL;
  try {
    url = new URL(raw, window.location.origin);
  } catch {
    return fallback;
  }
  if (url.origin !== window.location.origin) return fallback;
  return `${url.pathname}${url.search}${url.hash}` || fallback;
}
