// Cliente mínimo de POST /chat del agente (contrato: app/contracts.py).
// Vite reenvía /agent/* al agente (ver vite.config.ts).

export type Location = { latitude: number; longitude: number };

export type ChatResponse = {
  conversationId: string;
  reply: string;
  handoff: boolean;
  intent: string | null;
  stage: string | null;
  engine: string;
  latencyMs: number;
  turnId: string;
  toolCalls: Array<Record<string, unknown>>;
};

export async function sendChat(
  body: {
    tenantId: string;
    conversationId: string;
    text?: string;
    location?: Location;
    // Solo pruebas: el puente real de WhatsApp manda los scopes del principal.
    principalScopes?: string[];
  },
  signal?: AbortSignal,
): Promise<ChatResponse> {
  const res = await fetch("/agent/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel: "web", ...body }),
    signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`El agente respondió ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }
  return (await res.json()) as ChatResponse;
}

// Ubicaciones de prueba (centros de localidad, no domicilios): el navegador de
// desarrollo casi nunca está en Sinaloa, así que sirven para probar la cercanía.
export const PRESETS: Array<{ label: string; location: Location }> = [
  { label: "Culiacán centro", location: { latitude: 24.8091, longitude: -107.394 } },
  { label: "Los Mochis", location: { latitude: 25.7928, longitude: -108.9901 } },
  { label: "Mazatlán", location: { latitude: 23.2494, longitude: -106.4111 } },
  { label: "Navolato", location: { latitude: 24.7667, longitude: -107.7 } },
  { label: "Guasave", location: { latitude: 25.5738, longitude: -108.4675 } },
  { label: "Choix", location: { latitude: 26.7089, longitude: -108.3253 } },
  { label: "Escuinapa", location: { latitude: 22.8338, longitude: -105.7783 } },
  { label: "Fuera de Sinaloa (CDMX)", location: { latitude: 19.4326, longitude: -99.1332 } },
];

// ------------------------------------------------------------------ catálogo

export type Ventana = { dias: number[]; abre: string; cierra: string };
export type Unidad = {
  id: string;
  nombre: string;
  region: string;
  municipio: string | null;
  domicilio: string | null;
  codigoPostal: string | null;
  horarioTexto: string | null;
  horario: Ventana[];
  servicios: string[];
  battelle: boolean;
  lat: number | null;
  lon: number | null;
  precision: string;
  notas: string;
};

let catalogo: Promise<Map<string, Unidad>> | null = null;

/** Catálogo público (una sola carga). Falla en silencio: las tarjetas son un extra. */
export function loadUnidades(): Promise<Map<string, Unidad>> {
  catalogo ??= fetch("/agent/unidades")
    .then((r) => (r.ok ? r.json() : { unidades: [] }))
    .then((d: { unidades: Unidad[] }) => new Map(d.unidades.map((u) => [u.id, u])))
    .catch(() => new Map<string, Unidad>());
  return catalogo;
}

const MIN = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** ¿Abierta ahora en hora de Sinaloa? `null` si no hay horario capturado. */
export function abiertaAhora(u: Unidad, now = new Date()): boolean | null {
  if (u.horario.length === 0) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Mazatlan",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const dia = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday"));
  const minuto = (Number(get("hour")) % 24) * 60 + Number(get("minute"));
  return u.horario.some((v) => v.dias.includes(dia) && MIN(v.abre) <= minuto && minuto < MIN(v.cierra));
}

export function mapsUrl(u: Unidad): string {
  // Por domicilio cuando lo hay: las coordenadas son de la localidad, no de la puerta.
  const q = u.domicilio
    ? `${u.domicilio}, ${u.municipio ?? ""}, Sinaloa, México`
    : u.lat != null && u.lon != null
      ? `${u.lat},${u.lon}`
      : `${u.nombre}, Sinaloa, México`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export type CardRef = { id: string; km: string | null };

/** Unidades que salieron de las tools en este turno y que la respuesta menciona. */
export function cardsFromTurn(
  toolCalls: Array<Record<string, unknown>>,
  reply: string,
  units: Map<string, Unidad>,
): CardRef[] {
  // Búsqueda con muchas unidades: el agente solo pregunta la localidad; sin tarjetas.
  const usaDetalle = toolCalls.some((c) => ["unidad_mas_cercana", "detalle_de_unidad"].includes(String(c.tool)));
  if (!usaDetalle && toolCalls.some((c) => /HAY \d+ UNIDADES/.test(String(c.result ?? "")))) return [];
  const found: CardRef[] = [];
  for (const call of toolCalls) {
    if (!["unidad_mas_cercana", "buscar_unidades", "detalle_de_unidad"].includes(String(call.tool))) continue;
    for (const line of String(call.result ?? "").split("\n")) {
      const id = /\[(U\d{3})\]/.exec(line)?.[1];
      if (!id || found.some((f) => f.id === id)) continue;
      const km = /a ~(\d+) km/.exec(line)?.[1] ?? (/a menos de 1 km/.test(line) ? "<1" : null);
      found.push({ id, km });
    }
  }
  const text = fold(reply);
  const mentioned = found.filter((f) => {
    const nombre = units.get(f.id)?.nombre;
    return nombre ? text.includes(fold(nombre).replace(/\s*\(.*\)$/, "")) : false;
  });
  return (mentioned.length ? mentioned : found.slice(0, 1)).filter((f) => units.has(f.id)).slice(0, 3);
}

// ------------------------------------------------------------ presentación
// Espejo de app/unidades/formato.py: el catálogo viene en MAYÚSCULAS.
const MINUSCULAS = new Set(["a", "al", "de", "del", "el", "la", "las", "los", "y", "e", "en", "con", "por", "para", "o"]);
const SIGLAS = new Set(["USPN", "CP", "S/N", "EDI", "CEREDI", "II", "III", "IV", "VI", "N°", "Nº", "SN"]);

export function titulo(texto: string | null | undefined): string {
  if (!texto) return "";
  let primera = true;
  return texto
    .trim()
    .split(/([\s(),.\-/]+)/)
    .map((parte) => {
      if (!/[\p{L}\p{N}]/u.test(parte)) return parte;
      const alta = parte.toUpperCase();
      const out = SIGLAS.has(alta)
        ? alta
        : MINUSCULAS.has(parte.toLowerCase()) && !primera
          ? parte.toLowerCase()
          : parte.charAt(0).toUpperCase() + parte.slice(1).toLowerCase();
      primera = false;
      return out;
    })
    .join("");
}

export function frase(texto: string | null | undefined): string {
  const limpio = (texto ?? "").split(/\s+/).filter(Boolean).join(" ").toLowerCase();
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}

// -------------------------------------------------------------------- audio

const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(blob);
  });

/** Nota de voz -> texto (POST /audio/stt del agente). */
export async function transcribeAudio(blob: Blob, filename: string): Promise<string> {
  const res = await fetch("/agent/audio/stt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audioBase64: await blobToBase64(blob), filename }),
  });
  if (!res.ok) throw new Error(`No pude transcribir el audio (${res.status})`);
  return String(((await res.json()) as { text?: string }).text ?? "").trim();
}
