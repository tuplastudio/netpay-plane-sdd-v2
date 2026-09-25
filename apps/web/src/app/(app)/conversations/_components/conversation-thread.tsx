"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  AlertCircle,
  AudioLines,
  Bot,
  CheckCircle2,
  ChevronLeft,
  FileText,
  Hand,
  Image as ImageIcon,
  MessageSquare,
  Mic,
  MoreHorizontal,
  Paperclip,
  Plus,
  RotateCcw,
  Send,
  Smile,
  Square,
  StickyNote,
  Tag,
  Trash2,
  UserCog,
  UserRound,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { SkeletonText } from "@/components/ui/skeleton";
import { StatusBadge, statusLabel } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DateTime } from "@/components/app/date-time";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  MAX_ATTACHMENT_BYTES,
  apiErrorMessage,
  providerLabel,
  useAddNote,
  useAddMessageNote,
  useClaim,
  useHandoff,
  useMessageNotes,
  useMessages,
  useNotes,
  useReply,
  useReturnToAgent,
  useSendAttachment,
  useSetConversationStatus,
  useSetTags,
  type Conversation,
  type ConversationNote,
  type Message,
  type MessageType,
} from "./use-conversations";
import { blobToBase64, formatDuration, useVoiceRecorder } from "./use-voice-recorder";
import { EmojiPickerPanel } from "./emoji-picker-panel";
import { linkify } from "./linkify";
import { ShortcutsHelp } from "./shortcuts-help";
import { useConversationContext } from "./use-conversation-context";
import { Money } from "@/components/app/money";

const ACCEPTED_FILES = "image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt";
// Mismo criterio que `ACCEPTED_FILES`, pero evaluable en JS: el atributo
// `accept` del `<input type=file>` solo filtra el selector nativo, no lo que
// llega por arrastrar-y-soltar o por pegar, así que ambos caminos validan
// aquí también.
const ACCEPTED_EXTENSIONS = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".txt"];
function isAcceptedFile(file: File): boolean {
  const mime = (file.type || "").toLowerCase();
  if (mime.startsWith("image/") || mime.startsWith("audio/") || mime.startsWith("video/")) return true;
  const name = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function fileTypeIcon(mimetype: string) {
  if (mimetype.startsWith("image/")) return ImageIcon;
  if (mimetype.startsWith("audio/")) return AudioLines;
  if (mimetype.startsWith("video/")) return Video;
  return FileText;
}

const THREAD_SHORTCUTS = [
  { keys: "Esc", label: "Volver a la bandeja" },
  { keys: "Enter", label: "Enviar (Shift+Enter salta de línea)" },
  { keys: "Ctrl/Cmd+Enter", label: "Enviar" },
];

const MEDIA_LABELS: Partial<Record<MessageType, { label: string; icon: typeof FileText }>> = {
  AUDIO: { label: "Nota de voz", icon: AudioLines },
  IMAGE: { label: "Imagen", icon: ImageIcon },
  VIDEO: { label: "Video", icon: Video },
  DOCUMENT: { label: "Archivo", icon: FileText },
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Notas internas de UN mensaje: se abren bajo demanda, no en cada mensaje visible. */
function MessageNotesInline({ messageId }: { messageId: string }) {
  const [open, setOpen] = useState(false);
  const notes = useMessageNotes(open ? messageId : undefined);
  const addNote = useAddMessageNote(messageId);
  const [draft, setDraft] = useState("");
  const count = notes.data?.length ?? 0;

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded p-0.5 text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
        aria-expanded={open}
      >
        <StickyNote aria-hidden className="h-3 w-3" />
        {open ? "Ocultar nota" : count > 0 ? `Nota (${count})` : "Nota"}
      </button>
      {open ? (
        <div className="mt-1.5 max-w-[85%] space-y-1.5 rounded-card border border-border bg-background p-2">
          {notes.isLoading ? (
            <p className="text-[11px] text-muted-foreground">Cargando…</p>
          ) : notes.data && notes.data.length > 0 ? (
            <ul className="space-y-1">
              {notes.data.map((n) => (
                <li key={n.id} className="text-[11px]">
                  <p className="whitespace-pre-wrap break-words text-foreground">{n.body}</p>
                  <p className="text-muted-foreground">
                    {n.author?.fullName ?? "Sin autor"} · <DateTime value={n.createdAt} />
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-muted-foreground">Sin notas en este mensaje.</p>
          )}
          <div className="flex gap-1.5">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Nota interna…"
              className="h-7 text-xs"
              aria-label="Nueva nota sobre este mensaje"
            />
            <Button
              type="button"
              size="sm"
              className="h-7 shrink-0 px-2 text-xs"
              disabled={!draft.trim()}
              loading={addNote.isPending}
              onClick={() => {
                if (!draft.trim()) return;
                addNote.mutate(draft.trim(), { onSuccess: () => setDraft("") });
              }}
            >
              Guardar
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** IMAGE/VIDEO/AUDIO con `mediaUrl`: los tres tienen un visor nativo del navegador. */
const PREVIEWABLE_TYPES = new Set<MessageType>(["IMAGE", "VIDEO", "AUDIO"]);

/**
 * Marcador (etiqueta + ícono + hora + estado) que se pinta ARRIBA de cada
 * burbuja del hilo. Sustituye al único "destinatario" implícito del color de
 * fondo: un nuevo captador del hilo debe poder escanearlo y saber, sin abrir
 * detalle, quién dijo qué y cuándo.
 *
 * - Entrante (cliente) → ícono `UserRound` y el nombre del cliente (o el
 *   teléfono si todavía no hay ficha).
 * - Saliente por el agente de IA → ícono `Bot` y etiqueta "Agente".
 * - Saliente por una persona → ícono `UserCog` y etiqueta "Asesor" + el nombre
 *   de la persona dueña del hilo, si la sabemos.
 *
 * El estado (PENDING / SENT / DELIVERED / READ / FAILED) solo se pinta en
 * mensajes salientes: WhatsApp nunca expone estado para los entrantes, y
 * pintarlo sería ruido.
 */
function MessageMarker({
  message,
  customerName,
  agentLabel,
  agentName,
  compact = false,
}: {
  message: Message;
  customerName: string;
  agentLabel: "Agente" | "Asesor";
  agentName?: string;
  /** Sin icono ni nombre del sender: concatenación visual con el mensaje
   *  anterior (mismo sender, < 5 min). La fecha sigue, alineada al borde
   *  correcto, para que la cronología no se pierda. */
  compact?: boolean;
}) {
  const outbound = message.direction === "OUTBOUND";
  const Icon = outbound ? (agentLabel === "Asesor" ? UserCog : Bot) : UserRound;
  const label = outbound ? (agentName ? `${agentLabel} · ${agentName}` : agentLabel) : customerName;
  return (
    <div
      className={cn(
        "flex items-baseline gap-1.5 px-1 pb-0.5 text-[11px] text-muted-foreground",
        outbound ? "justify-end" : "justify-start",
      )}
    >
      {compact ? (
        <span aria-hidden className="h-3 w-3 shrink-0" />
      ) : (
        <Icon aria-hidden className="h-3 w-3 shrink-0" />
      )}
      {compact ? null : (
        <span className="truncate font-medium text-foreground">{label}</span>
      )}
      <span aria-hidden>·</span>
      <DateTime value={message.createdAt} className="text-[11px]" />
      {outbound ? (
        <>
          <span aria-hidden>·</span>
          <StatusBadge
            status={message.status}
            domain="message"
            size="sm"
            label={
              message.status === "FAILED"
                ? "Falló"
                : message.status === "DELIVERED"
                  ? "Entregado"
                  : message.status === "READ"
                    ? "Leído"
                    : message.status === "SENT"
                      ? "Enviado"
                      : message.status === "PENDING"
                        ? "Enviando"
                        : statusLabel(message.status, "message")
            }
          />
        </>
      ) : null}
    </div>
  );
}

function MessageBubble({
  message,
  customerName,
  agentLabel,
  agentName,
  compactMarker = false,
}: {
  message: Message;
  customerName: string;
  agentLabel: "Agente" | "Asesor";
  agentName?: string;
  /** Concatenación visual con el mensaje anterior. */
  compactMarker?: boolean;
}) {
  const outbound = message.direction === "OUTBOUND";
  const failed = message.status === "FAILED";
  const media = MEDIA_LABELS[message.messageType];
  const MediaIcon = media?.icon;
  const [mediaError, setMediaError] = useState(false);
  const hasPreview = !!message.mediaUrl && !mediaError && PREVIEWABLE_TYPES.has(message.messageType);

  return (
    <li className={cn("flex flex-col", outbound ? "items-end" : "items-start")}>
      <div className={cn("flex max-w-[85%] flex-col gap-0 sm:max-w-[75%]", outbound && "items-end")}>
        <MessageMarker
          message={message}
          customerName={customerName}
          agentLabel={agentLabel}
          agentName={agentName}
          compact={compactMarker}
        />
        <div
          className={cn(
            "overflow-hidden whitespace-pre-wrap break-words rounded-card px-2.5 py-1.5 text-sm",
            outbound
              ? "rounded-br-sm bg-primary-strong text-primary-foreground"
              : "rounded-bl-sm bg-muted text-foreground",
            failed && "ring-2 ring-destructive",
          )}
        >
          <span className="sr-only">
            {outbound ? "Mensaje saliente" : "Mensaje del cliente"}.{" "}
          </span>
          {hasPreview ? (
            message.messageType === "IMAGE" ? (
              // eslint-disable-next-line @next/next/no-img-element -- URL externa (WhatsApp/Evolution), sin optimizador
              <img
                src={message.mediaUrl!}
                alt="Imagen adjunta"
                loading="lazy"
                className="mb-1.5 max-h-64 w-auto max-w-full rounded-card object-contain"
                onError={() => setMediaError(true)}
              />
            ) : message.messageType === "VIDEO" ? (
              <video
                controls
                preload="metadata"
                className="mb-1.5 max-h-64 w-full rounded-card"
                onError={() => setMediaError(true)}
              >
                <source src={message.mediaUrl!} />
              </video>
            ) : (
              <audio controls className="mb-1.5 w-full" onError={() => setMediaError(true)}>
                <source src={message.mediaUrl!} />
              </audio>
            )
          ) : media && MediaIcon ? (
            <p
              className={cn(
                "mb-1 flex items-center gap-1.5 text-xs font-medium",
                outbound ? "opacity-90" : "text-muted-foreground",
              )}
            >
              <MediaIcon aria-hidden className="h-3.5 w-3.5" />
              {media.label}
              {message.mediaUrl ? (
                <a
                  href={message.mediaUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  Abrir
                </a>
              ) : null}
            </p>
          ) : null}
          {message.body ? (
            <p>
              {linkify(message.body, "underline underline-offset-2 font-medium")}
            </p>
          ) : null}
          {failed ? (
            <p role="alert" className="mt-1 text-xs">
              No se entregó{message.errorMessage ? `: ${message.errorMessage}` : "."}
            </p>
          ) : null}
        </div>
      </div>
      <MessageNotesInline messageId={message.id} />
    </li>
  );
}

/**
 * Separador de día dentro del hilo. Pinta la fecha corta (es-MX) sobre una
 * línea tenue; cuando no hay separador (mismo día) no se rinde nada.
 */
function DaySeparator({ iso }: { iso: string }) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const label = date.toLocaleDateString("es-MX", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return (
    <li
      role="separator"
      aria-label={`Mensajes del ${label}`}
      className="my-3 flex items-center gap-2 text-[11px] text-muted-foreground"
    >
      <span aria-hidden className="h-px flex-1 bg-border" />
      <span className="font-medium uppercase tracking-wide">{label}</span>
      <span aria-hidden className="h-px flex-1 bg-border" />
    </li>
  );
}

/**
 * Hilo de mensajes con scroll pegado al final: cada mensaje nuevo (del
 * cliente por el polling, o del operador al enviar) baja la vista.
 *
 * El nombre del cliente y el "asesor/agente" del que viene un mensaje
 * saliente vienen del prop porque vienen del API de la conversación, no del
 * de mensajes: con esa info en mano, `MessageBubble` puede pintar su marcador.
 *
 * Los mensajes vienen intercalados con separadores de día (`DaySeparator`),
 * que aparecen cuando cambia la fecha local del mensaje anterior.
 */
function MessagesPane({
  conversationId,
  handedOff,
  customerName,
  agentLabel,
  agentName,
  scrollContainerRef,
}: {
  conversationId: string;
  handedOff: boolean;
  customerName: string;
  agentLabel: "Agente" | "Asesor";
  agentName?: string;
  /** Ref externo al contenedor scrollable: si el padre (ConversationThread)
   *  lo pasa, lo usamos. ScrollToEndButton comparte el mismo nodo y
   *  necesita el mismo ref para detectar posición. */
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const messages = useMessages(conversationId, { poll: handedOff });
  const internalRef = useRef<HTMLDivElement>(null);
  const listRef = scrollContainerRef ?? internalRef;
  const lastId = messages.data?.[messages.data.length - 1]?.id;

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastId]); // eslint-disable-line react-hooks/exhaustive-deps -- listRef es ref estable

  /** Lista con separadores de día y marcadores compactos; una sola pasada.
   *
   * Concatenación visual: cuando el sender no cambia entre dos mensajes y
   * pasaron menos de 5 minutos, el segundo oculta ícono+nombre (la fecha
   * sí se pinta — la cronología se mantiene). En un hilo de 100 mensajes
   * del mismo cliente, esto recorta el alto a la mitad. WhatsApp/IMessage
   * colapsan igual. */
  const SENDER_GAP_MINUTES = 5;
  const interleaved = useMemo(() => {
    if (!messages.data) return [];
    const out: Array<
      | { kind: "bubble"; key: string; message: Message; compactMarker: boolean }
      | { kind: "day"; key: string; iso: string }
    > = [];
    let prevDay = "";
    let prevMessage: Message | null = null;
    for (const m of messages.data) {
      const d = new Date(m.createdAt);
      const day = Number.isNaN(d.getTime()) ? "" : d.toDateString();
      if (day !== prevDay) {
        out.push({ kind: "day", key: `day-${m.id}`, iso: m.createdAt });
        prevDay = day;
      }
      let compact = false;
      if (prevMessage) {
        const sameDirection = prevMessage.direction === m.direction;
        // Para INBOUND el sender siempre es el cliente de la conversación.
        // Para OUTBOUND asumimos mismo agente mientras el dueño no haya
        // cambiado el `handoffUser` (transición visible en el panel y rara
        // en la práctica): si pasa, el marcador aparece de nuevo — es
        // información útil, no ruido.
        const close =
          Math.abs(d.getTime() - new Date(prevMessage.createdAt).getTime()) <
          SENDER_GAP_MINUTES * 60_000;
        compact = close && sameDirection;
      }
      out.push({ kind: "bubble", key: m.id, message: m, compactMarker: compact });
      prevMessage = m;
    }
    return out;
  }, [messages.data]);

  return (
    <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
      {messages.isError ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>No se pudieron cargar los mensajes</AlertTitle>
          <AlertDescription>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void messages.refetch()}>
              Reintentar
            </Button>
          </AlertDescription>
        </Alert>
      ) : messages.isLoading ? (
        <SkeletonText lines={5} announce label="Cargando la conversación…" />
      ) : !messages.data || messages.data.length === 0 ? (
        <EmptyState
          icon={<MessageSquare className="h-6 w-6" />}
          title="Sin mensajes"
          description="Este hilo aún no tiene mensajes registrados."
        />
      ) : (
        <ol aria-label="Mensajes de la conversación" className="space-y-1">
          {interleaved.map((node) =>
            node.kind === "day" ? (
              <DaySeparator key={node.key} iso={node.iso} />
            ) : (
              <MessageBubble
                key={node.key}
                message={node.message}
                customerName={customerName}
                agentLabel={agentLabel}
                agentName={agentName}
                compactMarker={node.compactMarker}
              />
            ),
          )}
        </ol>
      )}
    </div>
  );
}

/**
 * Lo que una persona puede hacer en un hilo transferido: escribir, adjuntar,
 * grabar una nota de voz y devolver el hilo al agente.
 */
function Composer({ conversationId, onReturn }: { conversationId: string; onReturn: () => void }) {
  const reply = useReply(conversationId);
  const attach = useSendAttachment(conversationId);
  const [draft, setDraft] = useState("");
  const [queue, setQueue] = useState<
    Array<{ name: string; size: number; mimetype: string; status: "uploading" | "queued" }>
  >([]);
  const [dragActive, setDragActive] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiPanelRef = useRef<HTMLDivElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const dragCounterRef = useRef(0);

  const sendText = () => {
    const body = draft.trim();
    if (!body || reply.isPending) return;
    reply.mutate(body, { onSuccess: () => setDraft("") });
  };

  const sendFiles = async (files: File[]) => {
    const accepted = files.filter((file) => {
      if (!isAcceptedFile(file)) {
        toast.error(`${file.name}: tipo de archivo no soportado`);
        return false;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast.error(`${file.name} supera los 25 MB`);
        return false;
      }
      return true;
    });
    if (accepted.length === 0) return;
    setQueue(
      accepted.map((f, i) => ({
        name: f.name,
        size: f.size,
        mimetype: f.type || "application/octet-stream",
        status: i === 0 ? "uploading" : "queued",
      })),
    );
    try {
      for (const file of accepted) {
        setQueue((q) =>
          q.map((item) => (item.name === file.name ? { ...item, status: "uploading" } : item)),
        );
        const base64 = await blobToBase64(file);
        await attach
          .mutateAsync({
            filename: file.name,
            mimetype: file.type || "application/octet-stream",
            base64,
          })
          .catch(() => undefined);
        setQueue((q) => q.filter((item) => item.name !== file.name));
      }
    } finally {
      setQueue([]);
    }
  };

  const onRecorded = useCallback(
    ({ base64, mimetype }: { base64: string; mimetype: string }) => {
      const ext = mimetype.includes("mp4") ? "m4a" : mimetype.includes("ogg") ? "ogg" : "webm";
      attach.mutate({ filename: `nota-de-voz.${ext}`, mimetype, base64 });
    },
    [attach],
  );
  const recorder = useVoiceRecorder(onRecorded);

  useEffect(() => {
    if (recorder.error) toast.error(recorder.error);
  }, [recorder.error]);

  const busy = reply.isPending || attach.isPending;

  // Motivo del bloqueo (p. ej. el filtro de moderación de respuestas humanas
  // rechazando un insulto) visible junto al redactor, no solo en un toast que
  // desaparece solo: la persona necesita leerlo con calma para corregir el
  // texto y reenviar. Se limpia sola en el próximo intento (`mutate` resetea
  // `isError`), así que no hace falta un botón de "cerrar" aparte.
  const blockedMessage = reply.isError
    ? apiErrorMessage(reply.error, "No se pudo enviar el mensaje")
    : attach.isError
      ? apiErrorMessage(attach.error, "No se pudo enviar el adjunto")
      : null;

  // Inserta el emoji en la posición del cursor, no al final del textarea:
  // si la persona ya escribió algo y quiere un emoji a media frase, "enviar
  // + agregado al final" siempre queda mal.
  //
  // `flushSync` (no `requestAnimationFrame`): el clic viene de un
  // `addEventListener` nativo del web component del picker, fuera del árbol
  // de React, así que sin forzar el commit aquí el navegador ya repintó el
  // textarea con el valor nuevo (cursor al final, de fábrica) antes de que
  // `setSelectionRange` alcance a correr — el resultado, comprobado en
  // pruebas manuales, era el emoji bien insertado pero el cursor saltando
  // al final de todos modos.
  const insertEmoji = useCallback((emoji: string) => {
    const el = textareaRef.current;
    if (!el) {
      setDraft((d) => d + emoji);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    flushSync(() => {
      setDraft((d) => d.slice(0, start) + emoji + d.slice(end));
    });
    el.focus();
    const pos = start + emoji.length;
    el.setSelectionRange(pos, pos);
  }, []);

  // Cierra el picker con un clic afuera, como cualquier popover. El cierre
  // con Escape NO vive aquí como listener de `document`: ese evento seguiría
  // subiendo y dispararía también el Escape del hilo entero (volver a la
  // bandeja) porque el foco, al abrir el picker, ya no está en el textarea.
  // En vez de eso se maneja en el `onKeyDown` de React del contenedor del
  // redactor (más abajo), que puede detener la propagación antes de que
  // llegue al contenedor del hilo.
  useEffect(() => {
    if (!emojiOpen) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (emojiPanelRef.current?.contains(target) || emojiButtonRef.current?.contains(target)) return;
      setEmojiOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [emojiOpen]);

  // Arrastrar-y-soltar sobre el redactor entero, como alternativa a
  // "Adjuntar". El contador de enter/leave evita que el overlay parpadee al
  // pasar de un hijo a otro (el navegador dispara dragleave/dragenter por
  // cada elemento que cruza el cursor).
  const onDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    dragCounterRef.current += 1;
    setDragActive(true);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
  };
  const onDragLeave = () => {
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setDragActive(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setDragActive(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) void sendFiles(files);
  };

  return (
    <div
      className="relative shrink-0 space-y-2 border-t border-border p-3"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onKeyDownCapture={(e) => {
        // Captura, no bubble: si el picker de emoji está abierto, este Escape
        // es para él, no para "volver a la bandeja" del hilo (el foco puede
        // estar en el botón/panel del picker, no en el textarea, así que la
        // regla del hilo lo tomaría como "campo vacío" y navegaría).
        if (e.key === "Escape" && emojiOpen) {
          e.stopPropagation();
          setEmojiOpen(false);
        }
      }}
    >
      {dragActive ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-card border-2 border-dashed border-primary-strong bg-primary-strong/10">
          <p className="rounded-card bg-card px-3 py-1.5 text-sm font-medium text-foreground shadow-airbnb">
            Suelta el archivo para adjuntarlo
          </p>
        </div>
      ) : null}
      {queue.length > 0 ? (
        <ul aria-live="polite" className="space-y-1 text-xs text-muted-foreground">
          {queue.map((f) => {
            const Icon = fileTypeIcon(f.mimetype);
            return (
              <li key={f.name} className="flex items-center gap-1.5">
                <Icon aria-hidden className="h-3 w-3" />
                <span className="truncate">{f.name}</span>
                <span>· {formatBytes(f.size)}</span>
                <span>· {f.status === "uploading" ? "enviando…" : "en cola…"}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {recorder.recording ? (
        <div role="status" className="flex items-center gap-1.5 text-xs text-destructive">
          <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-destructive" />
          <span>Grabando nota de voz… {formatDuration(recorder.elapsedMs)}</span>
          <button
            type="button"
            onClick={recorder.cancel}
            className="ml-1 inline-flex items-center gap-1 rounded p-0.5 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
          >
            <Trash2 aria-hidden className="h-3 w-3" />
            Descartar
          </button>
        </div>
      ) : null}
      {blockedMessage ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-card border border-destructive/40 bg-destructive-subtle px-3 py-2 text-xs text-destructive-subtle-foreground"
        >
          <AlertCircle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>{blockedMessage}</p>
        </div>
      ) : null}
      <Textarea
        ref={textareaRef}
        aria-label="Respuesta al cliente"
        placeholder="Escribe una respuesta… (Enter envía, Shift+Enter salta de línea)"
        rows={2}
        className="min-h-[56px] resize-none"
        value={draft}
        disabled={reply.isPending}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            sendText();
            return;
          }
          // Cmd/Ctrl+Enter: mismo atajo que otros redactores del portal,
          // además del Enter normal (no lo reemplaza).
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            sendText();
          }
        }}
        onPaste={(e) => {
          // Pegar una imagen del portapapeles la manda como adjunto, mismo
          // camino que "Adjuntar" — no como texto binario en el textarea.
          const items = e.clipboardData?.items;
          if (!items) return;
          const files: File[] = [];
          for (const item of Array.from(items)) {
            if (item.kind === "file" && item.type.startsWith("image/")) {
              const file = item.getAsFile();
              if (file) files.push(file);
            }
          }
          if (files.length > 0) {
            e.preventDefault();
            void sendFiles(files);
          }
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_FILES}
        multiple
        className="hidden"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) void sendFiles(files);
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={busy || recorder.recording}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip aria-hidden className="h-3.5 w-3.5" />
          Adjuntar
        </Button>
        <div className="relative">
          <Button
            ref={emojiButtonRef}
            type="button"
            variant={emojiOpen ? "secondary" : "outline"}
            size="sm"
            disabled={busy || recorder.recording}
            onClick={() => setEmojiOpen((v) => !v)}
            aria-expanded={emojiOpen}
            aria-label="Insertar emoji"
          >
            <Smile aria-hidden className="h-3.5 w-3.5" />
            Emoji
          </Button>
          {emojiOpen ? (
            <div
              ref={emojiPanelRef}
              className="absolute bottom-full left-0 z-30 mb-2 overflow-hidden rounded-card border border-border bg-card shadow-airbnb-lg"
            >
              <EmojiPickerPanel onPick={insertEmoji} />
            </div>
          ) : null}
        </div>
        <Button
          variant={recorder.recording ? "destructive" : "outline"}
          size="sm"
          disabled={busy}
          onClick={recorder.toggle}
          aria-pressed={recorder.recording}
          aria-label={recorder.recording ? "Detener y enviar la nota de voz" : "Grabar nota de voz"}
        >
          {recorder.recording ? (
            <Square aria-hidden className="h-3.5 w-3.5" />
          ) : (
            <Mic aria-hidden className="h-3.5 w-3.5" />
          )}
          {recorder.recording ? "Detener" : "Nota de voz"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          disabled={busy || recorder.recording}
          onClick={onReturn}
        >
          <Bot aria-hidden className="h-3.5 w-3.5" />
          Devolver al agente
        </Button>
        <Button
          size="sm"
          className="ml-auto"
          disabled={!draft.trim() || recorder.recording}
          loading={reply.isPending}
          onClick={sendText}
        >
          <Send aria-hidden className="h-3.5 w-3.5" />
          Enviar
        </Button>
      </div>
    </div>
  );
}

function NoteItem({ note }: { note: ConversationNote }) {
  return (
    <li className="rounded-card border border-border bg-background px-3 py-2 text-sm">
      <p className="whitespace-pre-wrap break-words">{note.body}</p>
      <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
        <span>{note.author?.fullName ?? note.author?.email ?? "Sin autor"}</span>
        <span aria-hidden>·</span>
        <DateTime value={note.createdAt} />
      </p>
    </li>
  );
}

/** Notas internas de TODO el hilo: solo las ve el equipo, nunca salen al cliente. */
function NotesPane({ conversationId }: { conversationId: string }) {
  const notes = useNotes(conversationId);
  const addNote = useAddNote(conversationId);
  const [draft, setDraft] = useState("");

  const save = () => {
    const body = draft.trim();
    if (!body || addNote.isPending) return;
    addNote.mutate(body, { onSuccess: () => setDraft("") });
  };

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {notes.isError ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>No se pudieron cargar las notas</AlertTitle>
            <AlertDescription>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => void notes.refetch()}>
                Reintentar
              </Button>
            </AlertDescription>
          </Alert>
        ) : notes.isLoading ? (
          <SkeletonText lines={3} announce label="Cargando las notas…" />
        ) : !notes.data || notes.data.length === 0 ? (
          <EmptyState
            icon={<StickyNote className="h-6 w-6" />}
            title="Sin notas"
            description="Deja aquí contexto para el equipo. El cliente no ve estas notas."
          />
        ) : (
          <ol aria-label="Notas internas" className="space-y-2">
            {notes.data.map((n) => (
              <NoteItem key={n.id} note={n} />
            ))}
          </ol>
        )}
      </div>
      <div className="shrink-0 space-y-2 border-t border-border p-3">
        <Textarea
          aria-label="Nueva nota interna"
          placeholder="Nota interna (no se envía al cliente)"
          rows={3}
          className="resize-none"
          value={draft}
          disabled={addNote.isPending}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="flex justify-end">
          <Button size="sm" disabled={!draft.trim()} loading={addNote.isPending} onClick={save}>
            <StickyNote aria-hidden className="h-3.5 w-3.5" />
            Guardar nota
          </Button>
        </div>
      </div>
    </>
  );
}

/**
 * Chips de etiquetas del hilo, con alta/baja inline. Vive en el encabezado, y
 * desde que el encabezado es UNA fila tiene que caber en el hueco que sobre:
 * el botón de alta va fijo a la izquierda (nunca se sale de vista) y los chips
 * se desplazan en horizontal cuando son muchos, en vez de envolver y añadir
 * un renglón al encabezado.
 */
function TagsEditor({
  conversation,
  className,
}: {
  conversation: Conversation;
  className?: string;
}) {
  const setTags = useSetTags(conversation.id);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const commit = () => {
    const tag = draft.trim().toLowerCase();
    if (!tag) {
      setAdding(false);
      return;
    }
    if (conversation.tags.includes(tag)) {
      setDraft("");
      setAdding(false);
      return;
    }
    setTags.mutate([...conversation.tags, tag], {
      onSuccess: () => {
        setDraft("");
        setAdding(false);
      },
    });
  };

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      {adding ? (
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              // No dejar que suba: si burbujea, el Escape del hilo (volver a
              // la bandeja) se dispara justo después de cancelar la etiqueta.
              e.stopPropagation();
              setDraft("");
              setAdding(false);
            }
          }}
          placeholder="etiqueta…"
          maxLength={30}
          className="h-6 w-24 shrink-0 px-1.5 text-[11px]"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          aria-label="Agregar etiqueta a la conversación"
          className="inline-flex shrink-0 items-center gap-0.5 rounded-pill border border-dashed border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:border-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1"
        >
          <Tag aria-hidden className="h-3 w-3" />
          <Plus aria-hidden className="h-2.5 w-2.5" />
        </button>
      )}
      <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
        {conversation.tags.map((t) => (
          <Badge key={t} variant="info" size="sm" className="shrink-0 gap-1 pr-1">
            {t}
            <button
              type="button"
              aria-label={`Quitar etiqueta ${t}`}
              className="rounded-full p-0.5 hover:bg-info-subtle-foreground/10"
              onClick={() => setTags.mutate(conversation.tags.filter((x) => x !== t))}
            >
              <X aria-hidden className="h-2.5 w-2.5" />
            </button>
          </Badge>
        ))}
      </div>
    </div>
  );
}

/** Acción del encabezado: solo ícono, con su nombre en tooltip y en `aria-label`. */
function HeaderAction({
  icon: Icon,
  label,
  onClick,
  loading,
  disabled,
  variant = "outline",
}: {
  icon: typeof UserCog;
  label: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: "outline" | "ghost";
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={variant}
          size="icon"
          className="h-8 w-8 shrink-0"
          aria-label={label}
          disabled={disabled}
          loading={loading}
          onClick={onClick}
        >
          {loading ? null : <Icon aria-hidden className="h-4 w-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Resumen del hilo ARRIBA de los mensajes: cliente, total gastado y lo que
 * está abierto AHORA (pedido/cotización pendiente). Antes toda esta info
 * vivía en la columna derecha, fuera de vista en móvil (ahí es un Sheet
 * que hay que abrir) y enterrada en una columna larga en escritorio.
 *
 * El resumen es de UNA fila en desktop y dos en móvil. El pedido/cotización
 * en curso lleva badge de estado + monto; el resto son chips planos. No es
 * navegable: para detalle del pedido se usa el panel derecho (o el Sheet
 * en móvil); el resumen es de un vistazo, no de acción.
 */
function ThreadContextBar({ conversation }: { conversation: Conversation }) {
  const ctx = useConversationContext(conversation.id);
  const data = ctx.data;
  const customerName = conversation.customer?.fullName ?? conversation.externalPhone;
  const totalSpend = data?.metrics.totalSpend ?? "0";
  const orderCount = data?.metrics.orderCount ?? 0;
  const quoteCount = data?.metrics.quoteCount ?? 0;
  const openOrder = data?.orders.find((o) => o.id === data.openOrderId) ?? null;
  const openQuote = data?.quotes.find((q) => q.id === data.openQuoteId) ?? null;
  const loading = ctx.isLoading;

  return (
    <div
      role="group"
      aria-label="Resumen del hilo"
      className="shrink-0 border-b border-border bg-muted/30 px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <UserRound aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="font-medium text-foreground">{customerName}</span>
        </span>
        <span aria-hidden className="text-muted-foreground/50">·</span>
        <span
          className="text-muted-foreground"
          title={`${data?.metrics.paidOrders ?? 0} pagado(s)`}
        >
          {orderCount} {orderCount === 1 ? "pedido" : "pedidos"} ·{" "}
          {quoteCount} {quoteCount === 1 ? "cotización" : "cotizaciones"}
        </span>
        <span aria-hidden className="text-muted-foreground/50">·</span>
        <span className="text-muted-foreground">
          <Money value={totalSpend} className="font-medium text-foreground" /> gastado
        </span>
      </div>

      {(openOrder || openQuote) && (
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {openOrder ? (
            <li className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-card px-2 py-0.5 text-xs">
              <Badge variant="info" size="sm">
                Pedido
              </Badge>
              <StatusBadge status={openOrder.status} domain="order" size="sm" />
              <Money value={openOrder.total} className="font-medium tabular-nums" />
            </li>
          ) : null}
          {openQuote ? (
            <li className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-card px-2 py-0.5 text-xs">
              <Badge variant="neutral" size="sm">
                Cotización
              </Badge>
              <StatusBadge status={openQuote.status} domain="quote" size="sm" />
              <Money value={openQuote.total} className="font-medium tabular-nums" />
              <span className="text-muted-foreground">· vence</span>
              <DateTime value={openQuote.expiresAt} className="text-muted-foreground" />
            </li>
          ) : null}
        </ul>
      )}
      {loading && !data ? (
        <p className="sr-only" role="status">
          Cargando resumen del cliente…
        </p>
      ) : null}
    </div>
  );
}

/**
 * Botón flotante "ir al final" que aparece cuando el usuario está scroll
 * arriba en una conversación larga: scrollear 14 000 px para encontrar el
 * último mensaje no es trabajo, es castigo.
 */
function ScrollToEndButton({
  containerRef,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function check() {
      if (!el) return;
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      // Muestra cuando hay > 200 px por debajo del borde inferior: un usuario
      // que lee un mensaje largo debería poder saltar al final sin scrollear.
      setShow(distance > 200);
    }
    check();
    el.addEventListener("scroll", check, { passive: true });
    return () => el.removeEventListener("scroll", check);
  }, [containerRef]);

  function go() {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }

  if (!show) return null;
  return (
    <button
      type="button"
      onClick={go}
      aria-label="Ir al mensaje más reciente"
      className="absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-airbnb-lg hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
    >
      <ChevronLeft aria-hidden className="h-3.5 w-3.5 rotate-[270deg]" />
      Ir al más reciente
    </button>
  );
}

/**
 * Panel central de la bandeja: encabezado del hilo, mensajes/notas y el
 * redactor. Reemplaza al `ConversationSheet` (ya no es un overlay: llena la
 * columna central de la página de 3 paneles).
 */
export function ConversationThread({
  conversation,
  userId,
  onBack,
}: {
  conversation: Conversation | null;
  userId: string | undefined;
  /** Solo en móvil: vuelve a la lista. */
  onBack?: () => void;
}) {
  const handoff = useHandoff(userId);
  const claim = useClaim();
  const returnToAgent = useReturnToAgent();
  const setStatus = useSetConversationStatus();
  const [confirmReturn, setConfirmReturn] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  // Ref compartido entre MessagesPane (auto-scroll al fondo al cargar) y
  // ScrollToEndButton (detectar si el usuario está lejos del fondo para
  // mostrar el atajo).
  const messagesListRef = useRef<HTMLDivElement | null>(null);

  // Regla de Escape en el hilo: si el foco está en el textarea del redactor
  // (o el de notas) y tiene texto sin enviar, el primer Escape solo le quita
  // el foco — así no se pierde el borrador por accidente ni se pisa el
  // "vaciar" nativo de un <input type=search>. Con el campo vacío, o ya sin
  // foco ahí (un segundo Escape, o Escape desde cualquier otro lado del
  // hilo), regresa a la bandeja. Los `stopPropagation` de los editores
  // inline (etiqueta, nota) evitan que su propio Escape también dispare esto.
  // Declarado antes del `if (!conversation)` de abajo: los Hooks no pueden
  // llamarse condicionalmente.
  const handleThreadKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "Escape" || !onBack) return;
      const active = document.activeElement;
      if (active instanceof HTMLTextAreaElement && active.value.trim().length > 0) {
        active.blur();
        return;
      }
      onBack();
    },
    [onBack],
  );

  if (!conversation) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyState
          icon={<MessageSquare className="h-6 w-6" />}
          title="Selecciona una conversación"
          description="Elige un hilo de la lista para leerlo y contestar."
        />
      </div>
    );
  }

  const current = conversation;

  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={handleThreadKeyDown}>
      {/*
        Encabezado de UNA fila. Antes eran tres renglones apilados (teléfono +
        proveedor, luego estado + acciones, luego etiquetas) que se comían ~96px
        del alto del hilo — en la bandeja eso es una pantalla menos de mensajes
        a la vista, en la pantalla donde los mensajes son el trabajo.

        Cómo cabe todo: el proveedor pasa a tooltip del teléfono (es un dato que
        se consulta una vez, no cada vez); Transferir/Tomar son ícono con
        tooltip + `aria-label`; y el ciclo de vida (Cerrar / Reabrir / Devolver)
        se va al menú de desbordamiento. `flex-nowrap` garantiza la fila única:
        lo único que se encoge es el teléfono, que conserva su valor completo en
        el tooltip.
      */}
      <div className="flex shrink-0 flex-nowrap items-center gap-2 border-b border-border p-2">
        {onBack ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={onBack}
            aria-label="Volver a la bandeja"
            title="Volver a la bandeja (Esc)"
          >
            <ChevronLeft aria-hidden className="h-4 w-4" />
          </Button>
        ) : null}

        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              className="min-w-0 shrink truncate rounded font-mono text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1"
            >
              {current.externalPhone}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {current.externalPhone} · Por {providerLabel(current.connection.provider)}
            {current.connection.phoneNumber ? ` · ${current.connection.phoneNumber}` : ""}
          </TooltipContent>
        </Tooltip>

        <StatusBadge
          status={current.status}
          domain="conversation"
          size="sm"
          withDot
          className="shrink-0"
        />

        {current.handoffToHuman ? (
          <Badge variant="warning" size="sm" className="max-w-[9rem] shrink-0 truncate">
            {current.handoffUser ? current.handoffUser.fullName : "Con una persona"}
          </Badge>
        ) : current.status !== "CLOSED" ? (
          <>
            <HeaderAction
              icon={UserCog}
              label="Transferir a una persona"
              disabled={!userId}
              loading={handoff.isPending && handoff.variables === current.id}
              onClick={() => handoff.mutate(current.id)}
            />
            <HeaderAction
              icon={Hand}
              label="Tomar la conversación"
              disabled={!userId}
              loading={claim.isPending && claim.variables === current.id}
              onClick={() => claim.mutate(current.id)}
            />
          </>
        ) : null}

        <TagsEditor conversation={current} className="min-w-0 flex-1" />

        <ShortcutsHelp items={THREAD_SHORTCUTS} label="Atajos de teclado del hilo" />

        {/* Ciclo de vida del ticket. Hasta ahora solo el job de inactividad
            podía cerrar un hilo y nada podía reabrirlo. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              aria-label="Más acciones de la conversación"
            >
              <MoreHorizontal aria-hidden className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {current.handoffToHuman ? (
              <DropdownMenuItem
                // Diferido un tick: si el diálogo se monta mientras el menú
                // todavía se está cerrando, Radix se pelea por el foco.
                onSelect={() => setTimeout(() => setConfirmReturn(true), 0)}
              >
                <Bot aria-hidden className="h-4 w-4" />
                Devolver al agente
              </DropdownMenuItem>
            ) : null}
            {current.status === "CLOSED" ? (
              <DropdownMenuItem
                onSelect={() => setStatus.mutate({ id: current.id, status: "OPEN" })}
              >
                <RotateCcw aria-hidden className="h-4 w-4" />
                Reabrir conversación
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => setTimeout(() => setConfirmClose(true), 0)}>
                <CheckCircle2 aria-hidden className="h-4 w-4" />
                Cerrar conversación
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Resumen del hilo: cliente + KPIs + orden/cotización en curso, encima
          de los mensajes. En móvil el panel derecho es un Sheet que hay que
          abrir, así que este resumen es la única forma de ver "qué está
          abierto" sin tocar la barra. */}
      <ThreadContextBar conversation={current} />

      {/* `key` reinicia pestaña, borradores y cola al cambiar de hilo. */}
      <Tabs key={current.id} defaultValue="messages" className="flex min-h-0 flex-1 flex-col">
        <TabsList aria-label="Secciones de la conversación" className="mx-3 mt-2 w-fit">
          <TabsTrigger value="messages">Mensajes</TabsTrigger>
          <TabsTrigger value="notes">Notas del hilo</TabsTrigger>
        </TabsList>
        <TabsContent value="messages" className="mt-2 flex min-h-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1 flex-col">
            <MessagesPane
              conversationId={current.id}
              handedOff={current.handoffToHuman}
              customerName={current.customer?.fullName ?? current.externalPhone}
              agentLabel={current.handoffToHuman ? "Asesor" : "Agente"}
              agentName={current.handoffUser?.fullName.split(" ")[0]}
              scrollContainerRef={messagesListRef}
            />
            <ScrollToEndButton containerRef={messagesListRef} />
          </div>
          {/* Aviso suave, no bloqueante: el agente exige nombre antes de cotizar.
              Aparece solo cuando el hilo todavía no tiene ficha de cliente, para
              que el asesor recuerde pedirlo (o lo pida él antes de transferir de
              regreso al bot y se quede trabado). El panel lateral sigue siendo el
              lugar donde se crea la ficha. */}
          {!current.customerId && current.status !== "CLOSED" ? (
            <div
              role="note"
              className="shrink-0 border-t border-border bg-warning-subtle/40 px-3 py-2 text-xs text-warning-foreground"
            >
              <span className="font-medium">Falta el nombre del cliente.</span> El agente no puede
              emitir cotización ni enlace de pago sin él. Pídelo ahora y créalo en el panel de la
              derecha.
            </div>
          ) : null}
          {current.status === "CLOSED" ? (
            <p className="shrink-0 border-t border-border p-3 text-xs text-muted-foreground">
              Esta conversación está cerrada. Reábrela para volver a escribirle al cliente (si el
              cliente escribe primero, se reabre sola).
            </p>
          ) : current.handoffToHuman ? (
            <Composer conversationId={current.id} onReturn={() => setConfirmReturn(true)} />
          ) : (
            <p className="shrink-0 border-t border-border p-3 text-xs text-muted-foreground">
              El agente atiende este hilo. Transfiérelo o tómalo para responder tú.
            </p>
          )}
        </TabsContent>
        <TabsContent value="notes" className="mt-2 flex min-h-0 flex-1 flex-col">
          <NotesPane conversationId={current.id} />
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={confirmReturn}
        onOpenChange={setConfirmReturn}
        title="¿Devolver la conversación al agente?"
        description="El agente volverá a contestar los mensajes del cliente. Podrás transferirla de nuevo cuando quieras."
        confirmLabel="Devolver al agente"
        variant="default"
        pending={returnToAgent.isPending}
        onConfirm={() => {
          returnToAgent.mutate(current.id, { onSuccess: () => setConfirmReturn(false) });
        }}
      />

      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="¿Cerrar la conversación?"
        description="El hilo sale de los pendientes y se libera la asignación. Si el cliente vuelve a escribir, se reabre solo."
        confirmLabel="Cerrar conversación"
        variant="default"
        pending={setStatus.isPending}
        onConfirm={() => {
          setStatus.mutate(
            { id: current.id, status: "CLOSED" },
            { onSuccess: () => setConfirmClose(false) },
          );
        }}
      />
    </div>
  );
}
