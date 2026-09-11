import type { ReactNode } from "react";

// Grupo de captura único: `http(s)://…` o un dominio `www.` suelto, hasta el
// próximo espacio. `String.split` con un regex de un solo grupo intercala el
// texto no-URL en índices pares y la URL capturada en los impares.
const URL_PATTERN = /((?:https?:\/\/|www\.)[^\s<>"']+)/gi;
// Puntuación de cierre de frase que casi nunca es parte de la URL misma
// ("visita www.ejemplo.com." termina en punto de la oración, no del dominio).
const TRAILING_PUNCTUATION = /[).,!?;:'"]+$/;

/**
 * Texto plano -> arreglo de strings/`<a>` sin `dangerouslySetInnerHTML`: para
 * un mensaje de WhatsApp basta detectar `http(s)://` y `www.` sueltos y
 * convertirlos en enlaces reales, dejando el resto tal cual para que React lo
 * pinte como nodos de texto normales (no HTML inyectado).
 */
export function linkify(text: string, linkClassName = "underline underline-offset-2"): ReactNode[] {
  if (!text) return [text];
  const parts = text.split(URL_PATTERN);
  const nodes: ReactNode[] = [];
  parts.forEach((part, i) => {
    if (!part) return;
    if (i % 2 === 1) {
      let url = part;
      let trailing = "";
      const match = url.match(TRAILING_PUNCTUATION);
      if (match) {
        trailing = match[0];
        url = url.slice(0, url.length - trailing.length);
      }
      if (!url) {
        nodes.push(part);
        return;
      }
      const href = url.toLowerCase().startsWith("www.") ? `https://${url}` : url;
      nodes.push(
        <a
          key={`link-${i}`}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className={linkClassName}
        >
          {url}
        </a>,
      );
      if (trailing) nodes.push(trailing);
    } else {
      nodes.push(part);
    }
  });
  return nodes;
}
