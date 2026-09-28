"use client";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { flushSync } from "react-dom";
import {
  AlertCircle,
  ArrowDown,
  AudioLines,
  Bot,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronLeft,
  Clock,
  ExternalLink,
  FileText,
  Hand,
  History,
  Image as ImageIcon,
  MapPin,
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
import { Skeleton, SkeletonRegion, SkeletonText } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DateTime } from "@/components/app/date-time";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  MAX_ATTACHMENT_BYTES,
  WHATSAPP_TEXT_MAX,
  apiErrorMessage,
  flattenMessages,
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
  type MessageNote,
  type MessageType,
} from "./use-conversations";
import { EntityDetailSheet, type EntityTarget } from "./entity-detail-sheet";
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

/** "14:05" en hora local, para el pie de cada burbuja. */
function formatTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

/** "27 sep 2026, 14:05": fecha completa para los tooltips de acuse. */
function formatFull(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Nombre legible de un documento: el que mande el API o, si no, el último
 * segmento de la URL (solo si parece un archivo con extensión).
 */
function documentName(message: Message): string | null {
  if (message.filename) return message.filename;
  if (!message.mediaUrl) return null;
  try {
    const last = new URL(message.mediaUrl).pathname.split("/").pop() ?? "";
    const name = decodeURIComponent(last);
    return /\.[a-z0-9]{2,5}$/i.test(name) ? name : null;
  } catch {
    return null;
  }
}

/**
 * Notas internas de UN mensaje. El botón es barato (sin query ni mutación);
 * el panel con la query y la mutación solo se monta al abrirlo, así un hilo
 * de 200 mensajes no registra 200 observadores de TanStack Query.
 */
function MessageNotesInline({ messageId, outbound }: { messageId: string; outbound: boolean }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  // Lectura no reactiva del caché: solo sirve para el rótulo con el panel
  // cerrado; al abrirlo, el panel se suscribe de verdad.
  const cached = queryClient.getQueryData<MessageNote[]>(["whatsapp-message-notes", messageId]);
  const count = cached?.length ?? 0;

  return (
    <div className={cn("mt-0.5 flex flex-col", outbound ? "items-end" : "items-start")}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1 rounded p-0.5 text-[11px] text-muted-foreground transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          // En escritorio solo aparece al pasar por el mensaje (menos ruido);
          // en táctil siempre está visible.
          !open && count === 0 && "sm:opacity-0 sm:group-hover:opacity-100",
        )}
        aria-expanded={open}
      >
        <StickyNote aria-hidden className="h-3 w-3" />
        {open ? "Ocultar nota" : count > 0 ? `Nota (${count})` : "Nota"}
      </button>
      {open ? <MessageNotesPanel messageId={messageId} /> : null}
    </div>
  );
}

function MessageNotesPanel({ messageId }: { messageId: string }) {
  const notes = useMessageNotes(messageId);
  const addNote = useAddMessageNote(messageId);
  const [draft, setDraft] = useState("");

  return (
    <div className="mt-1.5 w-72 max-w-full space-y-1.5 rounded-card border border-border bg-card p-2">
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
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              e.preventDefault();
              addNote.mutate(draft.trim(), { onSuccess: () => setDraft("") });
            }
          }}
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
  );
}

/** IMAGE/VIDEO/AUDIO con `mediaUrl`: los tres tienen un visor nativo del navegador. */
const PREVIEWABLE_TYPES = new Set<MessageType>(["IMAGE", "VIDEO", "AUDIO"]);

/**
 * Quién mandó un saliente. El API todavía no manda autoría por mensaje; sin
 * ella el rótulo es neutro ("Enviado"). NUNCA se deduce del estado actual del
 * hilo: que hoy lo atienda una persona no dice quién escribió hace una hora.
 */
function outboundSender(message: Message): { label: string; icon: typeof Bot | null } {
  switch (message.sender) {
    case "BOT":
      return { label: "Bot", icon: Bot };
    case "HUMAN":
      return { label: message.senderUser?.fullName ?? "Asesor", icon: UserCog };
    case "SYSTEM":
      return { label: "Sistema", icon: null };
    default:
      return { label: "Enviado", icon: null };
  }
}

/** Clave de "mismo remitente" para agrupar burbujas consecutivas. */
function senderKey(message: Message): string {
  if (message.direction === "INBOUND") return "in";
  return `out:${message.sender ?? ""}:${message.senderUser?.id ?? ""}`;
}

const STATUS_TEXT: Record<string, string> = {
  PENDING: "Enviando",
  SENT: "Enviado",
  DELIVERED: "Entregado",
  READ: "Leído",
  FAILED: "No se entregó",
};

/**
 * Acuse estilo WhatsApp: reloj (enviando), ✓ (enviado), ✓✓ (entregado),
 * ✓✓ en acento (leído). El tooltip lista las horas que WhatsApp confirmó.
 */
function DeliveryTicks({ message }: { message: Message }) {
  const status = message.status;
  const text = STATUS_TEXT[status] ?? status;
  const Icon =
    status === "PENDING"
      ? Clock
      : status === "FAILED"
        ? AlertCircle
        : status === "SENT"
          ? Check
          : CheckCheck;
  const lines = [
    message.sentAt ? `Enviado: ${formatFull(message.sentAt)}` : null,
    message.deliveredAt ? `Entregado: ${formatFull(message.deliveredAt)}` : null,
    message.readAt ? `Leído: ${formatFull(message.readAt)}` : null,
  ].filter(Boolean) as string[];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          role="img"
          aria-label={text}
          className="inline-flex rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon
            aria-hidden
            className={cn(
              "h-3.5 w-3.5",
              status === "READ" && "text-primary",
              status === "FAILED" && "text-destructive",
            )}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        {lines.length > 0 ? (
          <div className="space-y-0.5">
            {lines.map((l) => (
              <p key={l}>{l}</p>
            ))}
          </div>
        ) : (
          text
        )}
      </TooltipContent>
    </Tooltip>
  );
}

/** Tarjeta de ubicación con enlace a Google Maps. */
function LocationCard({ message }: { message: Message }) {
  const hasCoords = typeof message.latitude === "number" && typeof message.longitude === "number";
  const href = hasCoords
    ? `https://www.google.com/maps?q=${message.latitude},${message.longitude}`
    : message.body
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(message.body)}`
      : null;
  return (
    <div className="mb-1 flex items-start gap-2">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-background/60">
        <MapPin aria-hidden className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium">Ubicación</p>
        {message.body ? <p className="text-xs opacity-80">{message.body}</p> : null}
        {hasCoords ? (
          <p className="font-mono text-[11px] opacity-70">
            {message.latitude!.toFixed(5)}, {message.longitude!.toFixed(5)}
          </p>
        ) : null}
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 inline-flex items-center gap-1 rounded text-xs font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Abrir en Google Maps
            <ExternalLink aria-hidden className="h-3 w-3" />
          </a>
        ) : null}
      </div>
    </div>
  );
}

/** Documento: nombre + tamaño (si se conocen) + abrir. */
function DocumentCard({ message }: { message: Message }) {
  const name = documentName(message);
  return (
    <div className="mb-1 flex items-center gap-2 rounded-card bg-background/40 px-2 py-1.5">
      <FileText aria-hidden className="h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium" title={name ?? undefined}>
          {name ?? "Archivo"}
        </p>
        {typeof message.fileSize === "number" ? (
          <p className="text-[11px] opacity-70">{formatBytes(message.fileSize)}</p>
        ) : null}
      </div>
      {message.mediaUrl ? (
        <a
          href={message.mediaUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={`Abrir ${name ?? "archivo"}`}
          className="shrink-0 rounded text-xs font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Abrir
        </a>
      ) : null}
    </div>
  );
}

type BubbleProps = {
  message: Message;
  customerName: string;
  /** Primer mensaje de un grupo (cambia el remitente o pasaron > 5 min). */
  groupStart: boolean;
};

/**
 * Burbuja del hilo. El remitente se rotula una vez por grupo; la hora y el
 * acuse viven al pie de la burbuja, como en WhatsApp. Memoizada: gracias al
 * `structuralSharing` de TanStack, un mensaje que no cambió conserva su
 * referencia entre sondeos y la burbuja no se vuelve a pintar.
 */
const MessageBubble = memo(function MessageBubble({
  message,
  customerName,
  groupStart,
}: BubbleProps) {
  const outbound = message.direction === "OUTBOUND";
  const failed = message.status === "FAILED";
  const media = MEDIA_LABELS[message.messageType];
  const MediaIcon = media?.icon;
  const [mediaError, setMediaError] = useState(false);
  const hasPreview =
    !!message.mediaUrl && !mediaError && PREVIEWABLE_TYPES.has(message.messageType);
  const sender = outbound ? outboundSender(message) : { label: customerName, icon: UserRound };
  const SenderIcon = sender.icon;
  const isDocument = message.messageType === "DOCUMENT";
  const isLocation = message.messageType === "LOCATION";
  // En documentos el cuerpo suele repetir el nombre del archivo.
  const body =
    isDocument && message.body && message.body === documentName(message) ? "" : message.body;
  const showBody = !!body && !isLocation;

  return (
    <li
      className={cn("group flex flex-col", outbound ? "items-end" : "items-start", groupStart ? "mt-3" : "mt-0.5")}
    >
      <div className={cn("flex max-w-[85%] flex-col sm:max-w-[75%]", outbound && "items-end")}>
        {groupStart ? (
          <div
            className={cn(
              "flex items-center gap-1 px-1 pb-0.5 text-[11px] text-muted-foreground",
              outbound ? "justify-end" : "justify-start",
            )}
          >
            {SenderIcon ? <SenderIcon aria-hidden className="h-3 w-3 shrink-0" /> : null}
            <span className="truncate font-medium">{sender.label}</span>
          </div>
        ) : null}
        <div
          className={cn(
            "overflow-hidden whitespace-pre-wrap break-words rounded-card px-2.5 py-1.5 text-sm",
            failed
              ? "bg-destructive-subtle text-destructive-subtle-foreground ring-1 ring-destructive/60"
              : outbound
                ? "bg-primary-strong text-primary-foreground"
                : "bg-secondary text-foreground",
            groupStart && (outbound ? "rounded-tr-sm" : "rounded-tl-sm"),
          )}
        >
          <span className="sr-only">
            {outbound ? `Mensaje saliente (${sender.label})` : `Mensaje de ${customerName}`}.{" "}
          </span>
          {isLocation ? (
            <LocationCard message={message} />
          ) : isDocument ? (
            <DocumentCard message={message} />
          ) : hasPreview ? (
            message.messageType === "IMAGE" ? (
              <a href={message.mediaUrl!} target="_blank" rel="noreferrer" className="block">
                {/* eslint-disable-next-line @next/next/no-img-element -- URL externa (WhatsApp/Evolution), sin optimizador */}
                <img
                  src={message.mediaUrl!}
                  alt="Imagen adjunta"
                  loading="lazy"
                  className="mb-1.5 max-h-64 w-auto max-w-full rounded-card object-contain"
                  onError={() => setMediaError(true)}
                />
              </a>
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
            <p className="mb-1 flex items-center gap-1.5 text-xs font-medium opacity-80">
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
          {showBody ? (
            <p>{linkify(body, "underline underline-offset-2 font-medium")}</p>
          ) : null}
          <span
            className={cn(
              "float-right ml-2 mt-0.5 inline-flex translate-y-0.5 items-center gap-1 text-[10px] leading-none",
              failed ? "" : "opacity-70",
            )}
          >
            <time dateTime={message.createdAt} title={formatFull(message.createdAt)}>
              {formatTime(message.createdAt)}
            </time>
            {outbound ? <DeliveryTicks message={message} /> : null}
          </span>
        </div>
        {failed ? (
          <p
            role="alert"
            className="mt-0.5 flex items-center gap-1 px-1 text-[11px] font-medium text-destructive"
          >
            <AlertCircle aria-hidden className="h-3 w-3 shrink-0" />
            No se entregó{message.errorMessage ? `: ${message.errorMessage}` : "."}
          </p>
        ) : null}
      </div>
      <MessageNotesInline messageId={message.id} outbound={outbound} />
    </li>
  );
});

/**
 * Separador de día: "Hoy", "Ayer" o la fecha (con año solo si no es el actual).
 */
function DaySeparator({ iso }: { iso: string }) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const label =
    date.toDateString() === today.toDateString()
      ? "Hoy"
      : date.toDateString() === yesterday.toDateString()
        ? "Ayer"
        : date.toLocaleDateString("es-MX", {
            weekday: "short",
            day: "numeric",
            month: "short",
            ...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
          });
  return (
    <li
      role="separator"
      aria-label={`Día: ${label}`}
      className="sticky top-0 z-[1] my-3 flex justify-center"
    >
      <span className="rounded-pill bg-card px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground shadow-sm ring-1 ring-border">
        {label}
      </span>
    </li>
  );
}

/** Skeleton del hilo: burbujas alternadas en vez de renglones de texto. */
function ThreadSkeleton() {
  const widths = ["w-48", "w-64", "w-40", "w-56", "w-32", "w-60"];
  return (
    <SkeletonRegion label="Cargando la conversación…" className="space-y-3 py-2">
      {widths.map((w, i) => (
        <div key={w} className={cn("flex", i % 2 ? "justify-end" : "justify-start")}>
          <Skeleton className={cn("h-10 max-w-[75%] rounded-card", w)} />
        </div>
      ))}
    </SkeletonRegion>
  );
}

/** Distancia al fondo (px) bajo la cual se considera que la persona "está al día". */
const NEAR_BOTTOM_PX = 120;
/** Mismo remitente y menos de esto entre mensajes → misma burbuja-grupo. */
const GROUP_GAP_MS = 5 * 60_000;

/**
 * Hilo de mensajes.
 *
 * Scroll: al abrir el hilo baja al final. Después, un mensaje nuevo solo baja
 * la vista si la persona ya estaba a menos de `NEAR_BOTTOM_PX` del fondo o si
 * es el saliente que ella misma acaba de mandar (`ownSendRef`); si está
 * leyendo más arriba, no se la jala: el botón de "ir al final" cuenta los
 * nuevos.
 *
 * "Cargar anteriores" pide la página previa (`before=pageInfo.nextBefore`) y
 * conserva la posición de lectura al anteponerla. Sin `pageInfo` (API sin
 * paginar) el control no aparece.
 */
function MessagesPane({
  conversationId,
  handedOff,
  customerName,
  ownSendRef,
}: {
  conversationId: string;
  handedOff: boolean;
  customerName: string;
  /** Lo prende el redactor al enviar: el siguiente saliente sí baja la vista. */
  ownSendRef: React.MutableRefObject<boolean>;
}) {
  const queryClient = useQueryClient();
  const messages = useMessages(conversationId, { pollMs: handedOff ? 5_000 : 15_000 });
  const list = useMemo(() => flattenMessages(messages.data?.pages), [messages.data]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const nearBottomRef = useRef(true);
  const [nearBottom, setNearBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const initialScrollDoneRef = useRef(false);
  const prevFirstIdRef = useRef<string | undefined>(undefined);
  const prevLastIdRef = useRef<string | undefined>(undefined);
  const restoreRef = useRef<{ height: number; top: number } | null>(null);

  const lastPage = messages.data?.pages[messages.data.pages.length - 1];
  const paginated = !!lastPage?.pageInfo;
  const lastId = list[list.length - 1]?.id;

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    nearBottomRef.current = near;
    setNearBottom(near);
    if (near) setUnseen(0);
  }, []);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    nearBottomRef.current = true;
    setUnseen(0);
  }, []);

  // Antes de pintar: posición inicial, restauración al anteponer y decisión
  // de seguir (o no) al fondo cuando llega algo nuevo.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || list.length === 0) return;
    const firstId = list[0]!.id;
    const last = list[list.length - 1]!;

    if (!initialScrollDoneRef.current) {
      el.scrollTop = el.scrollHeight;
      initialScrollDoneRef.current = true;
      nearBottomRef.current = true;
    } else {
      if (firstId !== prevFirstIdRef.current && restoreRef.current) {
        el.scrollTop = el.scrollHeight - restoreRef.current.height + restoreRef.current.top;
        restoreRef.current = null;
      }
      if (last.id !== prevLastIdRef.current) {
        const prevIdx = list.findIndex((m) => m.id === prevLastIdRef.current);
        const fresh = prevIdx >= 0 ? list.slice(prevIdx + 1) : [last];
        const mine = last.direction === "OUTBOUND" && ownSendRef.current;
        if (nearBottomRef.current || mine) {
          el.scrollTop = el.scrollHeight;
          nearBottomRef.current = true;
          if (mine) ownSendRef.current = false;
        } else {
          setUnseen((n) => n + fresh.length);
        }
        const inbound = fresh.filter((m) => m.direction === "INBOUND");
        if (inbound.length > 0) {
          const preview = inbound[inbound.length - 1]!.body?.slice(0, 120) ?? "";
          setAnnouncement(
            inbound.length === 1
              ? `Nuevo mensaje de ${customerName}: ${preview}`
              : `${inbound.length} mensajes nuevos de ${customerName}`,
          );
        }
      }
    }
    prevFirstIdRef.current = firstId;
    prevLastIdRef.current = last.id;
  }, [list, customerName, ownSendRef]);

  // Llegó algo nuevo (no la carga inicial): el panel de contexto puede haber
  // cambiado (el bot creó una cotización, se pagó un pedido…).
  const seenLastIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!lastId) return;
    if (seenLastIdRef.current && seenLastIdRef.current !== lastId) {
      void queryClient.invalidateQueries({ queryKey: ["whatsapp-context", conversationId] });
    }
    seenLastIdRef.current = lastId;
  }, [lastId, conversationId, queryClient]);

  // Imágenes/videos que terminan de cargar agrandan el hilo: si la persona
  // estaba al día, se mantiene pegada al fondo.
  useEffect(() => {
    const el = scrollRef.current;
    const ol = listRef.current;
    if (!el || !ol || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (nearBottomRef.current && !restoreRef.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(ol);
    return () => ro.disconnect();
  }, [list.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps -- se engancha cuando existe la lista

  const loadOlder = () => {
    const el = scrollRef.current;
    if (el) restoreRef.current = { height: el.scrollHeight, top: el.scrollTop };
    void messages.fetchNextPage().then((r) => {
      if (r.isError) restoreRef.current = null;
    });
  };

  const nodes = useMemo(() => {
    const out: Array<
      | { kind: "bubble"; key: string; message: Message; groupStart: boolean }
      | { kind: "day"; key: string; iso: string }
    > = [];
    let prevDay = "";
    let prev: Message | null = null;
    for (const m of list) {
      const d = new Date(m.createdAt);
      const day = Number.isNaN(d.getTime()) ? "" : d.toDateString();
      let dayChanged = false;
      if (day !== prevDay) {
        out.push({ kind: "day", key: `day-${m.id}`, iso: m.createdAt });
        prevDay = day;
        dayChanged = true;
      }
      const groupStart =
        !prev ||
        dayChanged ||
        senderKey(prev) !== senderKey(m) ||
        d.getTime() - new Date(prev.createdAt).getTime() > GROUP_GAP_MS;
      out.push({ kind: "bubble", key: m.id, message: m, groupStart });
      prev = m;
    }
    return out;
  }, [list]);

  const hardError = messages.isError && !messages.data;

  return (
    <>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto px-3 pb-3"
      >
        {hardError ? (
          <Alert variant="destructive" className="mt-2">
            <AlertCircle />
            <AlertTitle>No se pudieron cargar los mensajes</AlertTitle>
            <AlertDescription>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => void messages.refetch()}>
                Reintentar
              </Button>
            </AlertDescription>
          </Alert>
        ) : messages.isLoading ? (
          <ThreadSkeleton />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="h-6 w-6" />}
            title="Sin mensajes"
            description="Este hilo aún no tiene mensajes registrados."
          />
        ) : (
          <>
            {paginated ? (
              <div className="flex justify-center pt-2">
                {messages.hasNextPage ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-7 text-xs"
                    loading={messages.isFetchingNextPage}
                    onClick={loadOlder}
                  >
                    <History aria-hidden className="h-3.5 w-3.5" />
                    Cargar anteriores
                  </Button>
                ) : (
                  <p className="text-[11px] text-muted-foreground">Inicio de la conversación</p>
                )}
              </div>
            ) : null}
            {messages.isFetchNextPageError ? (
              <p role="alert" className="mt-1 text-center text-[11px] text-destructive">
                No se pudieron cargar los mensajes anteriores.
              </p>
            ) : null}
            <ol ref={listRef} aria-label="Mensajes de la conversación">
              {nodes.map((node) =>
                node.kind === "day" ? (
                  <DaySeparator key={node.key} iso={node.iso} />
                ) : (
                  <MessageBubble
                    key={node.key}
                    message={node.message}
                    customerName={customerName}
                    groupStart={node.groupStart}
                  />
                ),
              )}
            </ol>
          </>
        )}
      </div>

      {messages.isError && messages.data ? (
        <div
          role="status"
          className="absolute left-1/2 top-2 z-10 inline-flex -translate-x-1/2 items-center gap-2 rounded-pill bg-destructive-subtle px-3 py-1 text-[11px] text-destructive-subtle-foreground shadow-sm"
        >
          <AlertCircle aria-hidden className="h-3 w-3" />
          Sin conexión; reintentando…
          <button
            type="button"
            onClick={() => void messages.refetch()}
            className="rounded font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Reintentar
          </button>
        </div>
      ) : null}

      {!nearBottom && list.length > 0 ? (
        <button
          type="button"
          onClick={() => scrollToBottom(true)}
          aria-label={
            unseen > 0
              ? `${unseen} ${unseen === 1 ? "mensaje nuevo" : "mensajes nuevos"}; ir al más reciente`
              : "Ir al mensaje más reciente"
          }
          className={cn(
            "absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-pill px-3 py-1.5 text-xs font-medium shadow-airbnb-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            unseen > 0
              ? "bg-primary-strong text-primary-foreground hover:bg-primary-strong-hover"
              : "bg-secondary text-foreground hover:bg-accent",
          )}
        >
          <ArrowDown aria-hidden className="h-3.5 w-3.5" />
          {unseen > 0 ? `${unseen} ${unseen === 1 ? "nuevo" : "nuevos"}` : "Ir al más reciente"}
        </button>
      ) : null}

      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
    </>
  );
}

/**
 * Lo que una persona puede hacer en un hilo transferido: escribir, adjuntar,
 * grabar una nota de voz y devolver el hilo al agente.
 */
/** A partir de cuántos caracteres se muestra el contador (tope: `WHATSAPP_TEXT_MAX`). */
const COUNTER_FROM = 3500;

function Composer({
  conversationId,
  onReturn,
  onSend,
}: {
  conversationId: string;
  onReturn: () => void;
  /** Avisa al hilo que el próximo saliente es propio (para bajar la vista). */
  onSend?: () => void;
}) {
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

  const overLimit = draft.length > WHATSAPP_TEXT_MAX;

  const sendText = () => {
    const body = draft.trim();
    if (!body || reply.isPending || overLimit) return;
    onSend?.();
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
    onSend?.();
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
      onSend?.();
      attach.mutate({ filename: `nota-de-voz.${ext}`, mimetype, base64 });
    },
    [attach, onSend],
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
        aria-invalid={overLimit || undefined}
        aria-describedby={draft.length > COUNTER_FROM ? `composer-count-${conversationId}` : undefined}
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
      {draft.length > COUNTER_FROM ? (
        <p
          id={`composer-count-${conversationId}`}
          aria-live="polite"
          className={cn(
            "-mt-1 text-right text-[11px] tabular-nums",
            overLimit ? "font-medium text-destructive" : "text-muted-foreground",
          )}
        >
          {draft.length.toLocaleString("es-MX")} / {WHATSAPP_TEXT_MAX.toLocaleString("es-MX")}
          {overLimit ? " · WhatsApp no acepta mensajes tan largos" : ""}
        </p>
      ) : null}
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
          disabled={!draft.trim() || overLimit || recorder.recording}
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
          className="inline-flex shrink-0 items-center gap-0.5 rounded-pill border border-dashed border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:border-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
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
 * está abierto AHORA (pedido/cotización pendiente). En móvil el panel derecho
 * es un Sheet que hay que abrir, así que este resumen es la única forma de ver
 * "qué está abierto" sin tocar la barra.
 *
 * Los chips del pedido/cotización en curso son botones: abren la misma hoja de
 * detalle (`EntityDetailSheet`) que usa el panel de contexto. La hoja vive
 * aquí con su propio estado; Radix la cierra con Esc.
 */
function ThreadContextBar({ conversation }: { conversation: Conversation }) {
  const ctx = useConversationContext(conversation.id);
  const [target, setTarget] = useState<EntityTarget | null>(null);
  const data = ctx.data;
  const customerName = conversation.customer?.fullName ?? conversation.externalPhone;
  const totalSpend = data?.metrics.totalSpend ?? "0";
  const orderCount = data?.metrics.orderCount ?? 0;
  const quoteCount = data?.metrics.quoteCount ?? 0;
  const openOrder = data?.orders.find((o) => o.id === data.openOrderId) ?? null;
  const openQuote = data?.quotes.find((q) => q.id === data.openQuoteId) ?? null;
  const loading = ctx.isLoading;
  const chipClass =
    "inline-flex items-center gap-1.5 rounded-pill bg-card px-2 py-0.5 text-xs ring-1 ring-border transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div
      role="group"
      aria-label="Resumen del hilo"
      className="shrink-0 border-b border-border px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <UserRound aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="font-medium text-foreground">{customerName}</span>
        </span>
        <span aria-hidden className="text-muted-foreground/50">·</span>
        {loading && !data ? (
          <Skeleton className="h-3 w-40" />
        ) : (
          <>
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
          </>
        )}
      </div>

      {(openOrder || openQuote) && (
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {openOrder ? (
            <li>
              <button
                type="button"
                className={chipClass}
                aria-label="Ver el detalle del pedido en curso"
                onClick={() => setTarget({ kind: "order", id: openOrder.id })}
              >
                <Badge variant="info" size="sm">
                  Pedido
                </Badge>
                <StatusBadge status={openOrder.status} domain="order" size="sm" />
                <Money value={openOrder.total} className="font-medium tabular-nums" />
              </button>
            </li>
          ) : null}
          {openQuote ? (
            <li>
              <button
                type="button"
                className={chipClass}
                aria-label="Ver el detalle de la cotización en curso"
                onClick={() => setTarget({ kind: "quote", id: openQuote.id })}
              >
                <Badge variant="neutral" size="sm">
                  Cotización
                </Badge>
                <StatusBadge status={openQuote.status} domain="quote" size="sm" />
                <Money value={openQuote.total} className="font-medium tabular-nums" />
                <span className="text-muted-foreground">· vence</span>
                <DateTime value={openQuote.expiresAt} className="text-muted-foreground" />
              </button>
            </li>
          ) : null}
        </ul>
      )}
      {loading && !data ? (
        <p className="sr-only" role="status">
          Cargando resumen del cliente…
        </p>
      ) : null}

      <EntityDetailSheet
        target={target}
        conversation={conversation}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
      />
    </div>
  );
}

/**
 * Barra que reemplaza al redactor cuando la persona no puede escribir: el bot
 * atiende (→ "Tomar conversación") o el hilo está cerrado (→ "Reabrir").
 */
function HandoffBar({
  conversation,
  userId,
}: {
  conversation: Conversation;
  userId: string | undefined;
}) {
  const claim = useClaim();
  const setStatus = useSetConversationStatus();
  const closed = conversation.status === "CLOSED";
  return (
    <div className="shrink-0 border-t border-border p-3">
      <div
        role="status"
        className="flex flex-wrap items-center gap-3 rounded-card bg-secondary px-3 py-2.5"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-card">
          {closed ? (
            <CheckCircle2 aria-hidden className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Bot aria-hidden className="h-4 w-4 text-muted-foreground" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            {closed ? "Conversación cerrada" : "El bot está atendiendo esta conversación"}
          </p>
          <p className="text-xs text-muted-foreground">
            {closed
              ? "Reábrela para escribirle al cliente. Si el cliente escribe primero, se reabre sola."
              : "Tómala para responder tú; el bot deja de contestar mientras la atiendas."}
          </p>
        </div>
        {closed ? (
          <Button
            variant="secondary"
            size="sm"
            className="shrink-0"
            loading={setStatus.isPending}
            onClick={() => setStatus.mutate({ id: conversation.id, status: "OPEN" })}
          >
            <RotateCcw aria-hidden className="h-3.5 w-3.5" />
            Reabrir
          </Button>
        ) : (
          <Button
            size="sm"
            className="shrink-0"
            disabled={!userId}
            loading={claim.isPending && claim.variables === conversation.id}
            onClick={() => claim.mutate(conversation.id)}
          >
            <Hand aria-hidden className="h-3.5 w-3.5" />
            Tomar conversación
          </Button>
        )}
      </div>
    </div>
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
  // El redactor lo prende al enviar; MessagesPane lo consume para bajar la
  // vista con el saliente propio aunque la persona estuviera leyendo arriba.
  const ownSendRef = useRef(false);
  const markOwnSend = useCallback(() => {
    ownSendRef.current = true;
  }, []);

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
      // Los eventos de React burbujean a través de portales: un Esc dentro de
      // una hoja, diálogo o menú (que Radix ya usa para cerrarse) no debe
      // además sacar a la persona del hilo.
      if (!(e.target instanceof Node) || !e.currentTarget.contains(e.target)) return;
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
              className="min-w-0 shrink truncate rounded font-mono text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
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
              ownSendRef={ownSendRef}
            />
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
          {current.status !== "CLOSED" && current.handoffToHuman ? (
            <Composer
              conversationId={current.id}
              onReturn={() => setConfirmReturn(true)}
              onSend={markOwnSend}
            />
          ) : (
            <HandoffBar conversation={current} userId={userId} />
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
