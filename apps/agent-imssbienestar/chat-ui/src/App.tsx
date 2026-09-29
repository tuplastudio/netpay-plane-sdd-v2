import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  useLocalRuntime,
  type ChatModelAdapter,
} from "@assistant-ui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PRESETS, cardsFromTurn, loadUnidades, sendChat, type CardRef, type ChatResponse, type Location, type Unidad } from "./agent";
import { FormattedText } from "./format";
import { useVoiceRecorder } from "./voice";
import { UnitCard } from "./UnitCard";

const GREETING =
  "Hola, soy el asistente de IMSS-Bienestar Sinaloa. Te ayudo a encontrar la unidad médica más cercana para la Evaluación del Desarrollo Infantil, la estimulación temprana o la prueba Battelle.\n\n¿Me compartes tu ubicación o tu código postal?";
const INITIAL_OPTIONS = { initialMessages: [{ role: "assistant" as const, content: [{ type: "text" as const, text: GREETING }] }] };
const LOCATION_TEXT = "📍 Compartí mi ubicación";
const START_CHIPS = ["Mi código postal es 80230", "¿Dónde hacen la prueba Battelle?", "Vivo en Navolato", "¿Qué es la EDI?"];

// Lo que cada respuesta del agente lleva pegado (para tarjetas, avisos y chips).
type TurnMeta = { toolCalls: Array<Record<string, unknown>>; engine: string; intent: string | null; handoff: boolean };

function newConversationId() {
  return `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

/** Chips de respuesta rápida según lo que pasó en el último turno. */
function chipsFor(last: { reply: string; meta: TurnMeta; cards: CardRef[] } | null): string[] {
  if (!last) return START_CHIPS;
  if (last.meta.intent === "URGENCIA") return ["Ya está atendido", "Ubicar la unidad más cercana"];
  if (last.meta.handoff) return [];
  if (last.cards.length > 0)
    return ["Otra opción cercana", "Solo con prueba Battelle", "Solo con estimulación temprana", "Hablar con una persona"];
  if (/ubicaci[oó]n|c[oó]digo postal|municipio/i.test(last.reply)) return ["__LOCATION__", "Mi código postal es 80230", "Vivo en Culiacán"];
  return ["Ubicar la unidad más cercana", "Hablar con una persona"];
}

export function App() {
  const [tenantId, setTenantId] = useState("imss-sinaloa");
  const [conversationId, setConversationId] = useState(newConversationId);
  const [scopes, setScopes] = useState(true);
  const [debug, setDebug] = useState(false);
  const [meta, setMeta] = useState<ChatResponse | null>(null);
  const live = useRef({ tenantId, conversationId, scopes });
  live.current = { tenantId, conversationId, scopes };

  return (
    <div className={`shell ${debug ? "with-panel" : ""}`}>
      <Chat
        key={conversationId}
        live={live}
        onMeta={setMeta}
        debug={debug}
        onToggleDebug={() => setDebug((d) => !d)}
        onReset={() => {
          setMeta(null);
          setConversationId(newConversationId());
        }}
      />
      {debug && (
        <aside className="panel">
          <h2>Prueba</h2>
          <label>
            Tenant
            <input value={tenantId} onChange={(e) => setTenantId(e.target.value.trim())} />
          </label>
          <label className="check">
            <input type="checkbox" checked={scopes} onChange={(e) => setScopes(e.target.checked)} />
            Enviar scope <code>chat.write</code> (permite handoff)
          </label>
          <p className="muted">
            Conversación <code>{conversationId}</code>
          </p>
          <h2>Última respuesta</h2>
          {meta ? (
            <dl>
              <dt>engine</dt>
              <dd>{meta.engine}</dd>
              <dt>intent</dt>
              <dd>{meta.intent ?? "—"}</dd>
              <dt>handoff</dt>
              <dd className={meta.handoff ? "warn" : ""}>{String(meta.handoff)}</dd>
              <dt>latencia</dt>
              <dd>{meta.latencyMs} ms</dd>
              <dt>tools</dt>
              <dd>{meta.toolCalls.length === 0 ? "ninguna" : <pre>{JSON.stringify(meta.toolCalls, null, 1)}</pre>}</dd>
            </dl>
          ) : (
            <p className="muted">Aún no hay turnos.</p>
          )}
        </aside>
      )}
    </div>
  );
}

type LiveConfig = { tenantId: string; conversationId: string; scopes: boolean };

function Chat(props: {
  live: React.MutableRefObject<LiveConfig>;
  onMeta: (m: ChatResponse) => void;
  onReset: () => void;
  debug: boolean;
  onToggleDebug: () => void;
}) {
  const { live, onMeta, onReset, debug, onToggleDebug } = props;
  const pendingLocation = useRef<Location | null>(null);
  const [units, setUnits] = useState<Map<string, Unidad>>(new Map());
  const [last, setLast] = useState<{ reply: string; meta: TurnMeta; cards: CardRef[] } | null>(null);
  const [geoError, setGeoError] = useState("");
  const [custom, setCustom] = useState("");
  const [showMore, setShowMore] = useState(false);
  const unitsRef = useRef(units);
  unitsRef.current = units;

  useEffect(() => {
    void loadUnidades().then(setUnits);
  }, []);

  const adapter = useMemo<ChatModelAdapter>(
    () => ({
      async *run({ messages, abortSignal }) {
        const lastUser = [...messages].reverse().find((m) => m.role === "user");
        const raw = (lastUser?.content ?? [])
          .map((p) => (p.type === "text" ? p.text : ""))
          .join("\n")
          .trim();
        const location = pendingLocation.current ?? undefined;
        const texto = raw.replace(/^🎤\s*/, "");
        pendingLocation.current = null;
        const { tenantId, conversationId, scopes } = live.current;
        let res: ChatResponse;
        try {
          res = await sendChat(
            {
              tenantId,
              conversationId,
              text: location && raw === LOCATION_TEXT ? undefined : texto,
              location,
              principalScopes: scopes ? ["chat.write"] : [],
            },
            abortSignal,
          );
        } catch (error) {
          if (abortSignal.aborted) return;
          yield {
            content: [{ type: "text", text: "No pude consultar el catálogo en este momento. Intenta de nuevo en unos segundos." }],
            status: { type: "incomplete", reason: "error", error: String(error) },
          };
          return;
        }
        onMeta(res);
        // Con handoff activo el agente calla a propósito (contesta una persona): se avisa en vez de mostrar un hueco.
        const reply =
          res.reply || (res.handoff ? "Una persona del equipo ya tomó esta conversación y te responderá por aquí." : "…");
        const units = await loadUnidades();
        const cards = cardsFromTurn(res.toolCalls, reply, units);
        const turn: TurnMeta = { toolCalls: res.toolCalls, engine: res.engine, intent: res.intent, handoff: res.handoff };
        setLast({ reply, meta: turn, cards });

        // Efecto de escritura: el agente no hace streaming, así que se revela por palabras.
        // El avance depende del reloj (no de un número fijo de pasos): en una pestaña en
        // segundo plano los timers se frenan y así igual termina en un tick.
        const words = reply.split(/(\s+)/);
        const REVEAL_MS = Math.min(1200, 200 + words.length * 12);
        const start = Date.now();
        for (;;) {
          const fraction = Math.min(1, (Date.now() - start) / REVEAL_MS);
          if (fraction >= 1 || abortSignal.aborted) break;
          yield { content: [{ type: "text", text: words.slice(0, Math.max(1, Math.floor(words.length * fraction))).join("") }] };
          await sleep(30, abortSignal);
        }
        yield {
          content: [{ type: "text", text: reply }],
          metadata: { custom: { ...turn, cards, at: Date.now() } },
        };
      },
    }),
    [live, onMeta],
  );
  const runtime = useLocalRuntime(adapter, INITIAL_OPTIONS);

  const send = (text: string) => {
    setLast((l) => l && { ...l, cards: [] });
    runtime.thread.append({ role: "user", content: [{ type: "text", text }] });
  };
  const shareLocation = (location: Location) => {
    pendingLocation.current = location;
    send(LOCATION_TEXT);
  };
  const shareFromBrowser = () => {
    setGeoError("");
    if (!navigator.geolocation) return setGeoError("Este navegador no tiene geolocalización.");
    navigator.geolocation.getCurrentPosition(
      (pos) => shareLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      (err) => setGeoError(`No se pudo leer tu ubicación: ${err.message}`),
      { timeout: 10_000 },
    );
  };
  const shareCustom = () => {
    const [lat, lon] = custom.split(",").map((v) => Number(v.trim()));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return setGeoError("Usa el formato: 24.80, -107.39");
    setGeoError("");
    shareLocation({ latitude: lat, longitude: lon });
  };

  const voice = useVoiceRecorder({
    onText: (text) => {
      setGeoError("");
      send(`🎤 ${text}`);
    },
    onError: setGeoError,
  });

  const chips = chipsFor(last);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="chat">
        <header>
          <div className="title">
            <span className="logo">✚</span>
            <div>
              <strong>Unidades médicas</strong>
              <span className="muted">IMSS-Bienestar Sinaloa</span>
            </div>
          </div>
          <div className="header-actions">
            <button type="button" className={debug ? "on" : ""} onClick={onToggleDebug}>
              Modo prueba
            </button>
            <button type="button" onClick={onReset}>
              Nueva conversación
            </button>
          </div>
        </header>

        <ThreadPrimitive.Viewport className="viewport">
          <ThreadPrimitive.Messages>
            {({ message }) => (message.role === "user" ? <UserMessage /> : <AssistantMessage units={units} />)}
          </ThreadPrimitive.Messages>
        </ThreadPrimitive.Viewport>

        {chips.length > 0 && (
          <div className="chips">
            {chips.map((c) =>
              c === "__LOCATION__" ? (
                <button key={c} type="button" onClick={shareFromBrowser}>
                  📍 Compartir mi ubicación
                </button>
              ) : (
                <button key={c} type="button" onClick={() => send(c)}>
                  {c}
                </button>
              ),
            )}
          </div>
        )}

        {voice.state === "idle" ? (
          <ComposerPrimitive.Root className="composer">
            <button type="button" className="icon" onClick={shareFromBrowser} title="Compartir mi ubicación" aria-label="Compartir mi ubicación">
              📍
            </button>
            <ComposerPrimitive.Input placeholder="Escribe tu código postal, municipio o pregunta…" rows={1} autoFocus />
            <button type="button" className="icon mic" onClick={() => void voice.start()} title="Enviar nota de voz" aria-label="Enviar nota de voz">
              🎤
            </button>
            <ComposerPrimitive.Send>Enviar</ComposerPrimitive.Send>
            <button type="button" className="icon" onClick={() => setShowMore((v) => !v)} title="Simular ubicación" aria-label="Simular ubicación">
              ⋯
            </button>
          </ComposerPrimitive.Root>
        ) : (
          <div className="composer recording" role="status">
            {voice.state === "recording" ? (
              <>
                <span className="rec-dot" />
                <span className="rec-time">
                  {Math.floor(voice.seconds / 60)}:{String(voice.seconds % 60).padStart(2, "0")}
                </span>
                <span className="muted rec-hint">Grabando… habla con calma</span>
                <button type="button" onClick={voice.cancel}>
                  Cancelar
                </button>
                <button type="button" className="primary" onClick={voice.stop}>
                  Enviar audio
                </button>
              </>
            ) : voice.state === "requesting" ? (
              <>
                <span className="muted rec-hint">Permite el micrófono en tu navegador para grabar…</span>
                <button type="button" onClick={voice.cancel}>
                  Cancelar
                </button>
              </>
            ) : (
              <span className="muted">Transcribiendo tu audio…</span>
            )}
          </div>
        )}

        {(showMore || geoError) && (
          <div className="location-bar">
            <select
              defaultValue=""
              onChange={(e) => {
                const preset = PRESETS[Number(e.target.value)];
                if (preset) shareLocation(preset.location);
                e.target.value = "";
              }}
              aria-label="Simular ubicación"
            >
              <option value="" disabled>
                Simular ubicación…
              </option>
              {PRESETS.map((p, i) => (
                <option key={p.label} value={i}>
                  {p.label}
                </option>
              ))}
            </select>
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && shareCustom()}
              placeholder="lat, lon"
              aria-label="Coordenadas"
            />
            <button type="button" onClick={shareCustom}>
              Enviar
            </button>
            {geoError && <span className="error">{geoError}</span>}
          </div>
        )}
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

const hora = (ms?: number) => (ms ? new Date(ms).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) : "");

function TextPart({ text }: { text: string }) {
  return <FormattedText text={text} />;
}

function UserMessage() {
  // assistant-ui no expone timestamp del mensaje: se captura el instante del
  // primer render (justo después de enviarlo), suficiente para el reloj visible.
  const [sentAt] = useState(() => Date.now());
  return (
    <MessagePrimitive.Root className="row user">
      <div className="bubble user">
        <MessagePrimitive.Parts components={{ Text: TextPart }} />
        <span className="bubble-meta">
          <span className="time">{hora(sentAt)}</span>
          <span className="ticks" aria-hidden>
            ✓✓
          </span>
        </span>
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage({ units }: { units: Map<string, Unidad> }) {
  const message = useAuiState((s) => s.message);
  const custom = (message.metadata?.custom ?? {}) as Partial<TurnMeta> & { cards?: CardRef[]; at?: number };
  const text = message.content.map((p) => (p.type === "text" ? p.text : "")).join("");
  const running = message.status?.type === "running";
  const urgent = custom.intent === "URGENCIA";

  return (
    <MessagePrimitive.Root className="row assistant">
      <div className="avatar" aria-hidden>
        ✚
      </div>
      <div className="stack">
        {urgent && <div className="banner urgent">🚨 Emergencia: llama al 911</div>}
        {custom.handoff && <div className="banner handoff">Una persona del equipo tomará la conversación</div>}
        <div className={`bubble assistant ${urgent ? "urgent" : ""}`}>
          {text ? <MessagePrimitive.Parts components={{ Text: TextPart }} /> : running ? <span className="dots"><i /><i /><i /></span> : null}
          {custom.at && !running && (
            <span className="bubble-meta">
              <span className="time">{hora(custom.at)}</span>
            </span>
          )}
        </div>
        {!running &&
          custom.cards?.map((c) => {
            const u = units.get(c.id);
            return u ? <UnitCard key={c.id} unidad={u} km={c.km} /> : null;
          })}
      </div>
    </MessagePrimitive.Root>
  );
}
