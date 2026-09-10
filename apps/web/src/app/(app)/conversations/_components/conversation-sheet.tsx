"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  AudioLines,
  Bot,
  FileText,
  Image as ImageIcon,
  MessageSquare,
  Mic,
  Paperclip,
  Send,
  Square,
  StickyNote,
  UserCog,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonText } from "@/components/ui/skeleton";
import { StatusBadge, statusLabel } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { DateTime } from "@/components/app/date-time";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  MAX_ATTACHMENT_BYTES,
  providerLabel,
  useAddNote,
  useHandoff,
  useMessages,
  useNotes,
  useReply,
  useReturnToAgent,
  useSendAttachment,
  type Conversation,
  type ConversationNote,
  type Message,
  type MessageType,
} from "./use-conversations";
import { blobToBase64, useVoiceRecorder } from "./use-voice-recorder";

const ACCEPTED_FILES = "image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt";

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

function MessageBubble({ message }: { message: Message }) {
  const outbound = message.direction === "OUTBOUND";
  const failed = message.status === "FAILED";
  const media = MEDIA_LABELS[message.messageType];
  const MediaIcon = media?.icon;
  return (
    <li className={cn("flex", outbound ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-card px-3 py-2 text-sm",
          outbound ? "bg-primary-strong text-primary-foreground" : "bg-muted text-foreground",
          failed && "ring-2 ring-destructive",
        )}
      >
        <span className="sr-only">
          {outbound ? "Mensaje saliente" : "Mensaje del cliente"}.{" "}
        </span>
        {media && MediaIcon ? (
          <p className={cn("mb-1 flex items-center gap-1.5 text-xs font-medium", outbound ? "opacity-90" : "text-muted-foreground")}>
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
        <p className="whitespace-pre-wrap break-words">{message.body}</p>
        <p className={cn("mt-1 flex flex-wrap gap-x-2 text-xs", outbound ? "opacity-80" : "text-muted-foreground")}>
          <DateTime value={message.createdAt} />
          {outbound ? <span>{statusLabel(message.status, "message")}</span> : null}
        </p>
        {failed ? (
          <p role="alert" className="mt-1 text-xs">
            No se entregó{message.errorMessage ? `: ${message.errorMessage}` : "."}
          </p>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Hilo de mensajes con scroll pegado al final: cada mensaje nuevo (del
 * cliente por el polling, o del operador al enviar) baja la vista.
 */
function MessagesPane({ conversationId, handedOff }: { conversationId: string; handedOff: boolean }) {
  const messages = useMessages(conversationId, { poll: handedOff });
  const listRef = useRef<HTMLDivElement>(null);
  const lastId = messages.data?.[messages.data.length - 1]?.id;

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastId]);

  return (
    <div ref={listRef} className="flex-1 overflow-y-auto pr-1">
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
        <ol aria-label="Mensajes de la conversación" className="space-y-3">
          {messages.data.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
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
  const [queue, setQueue] = useState<Array<{ name: string; size: number }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sendText = () => {
    const body = draft.trim();
    if (!body || reply.isPending) return;
    reply.mutate(body, { onSuccess: () => setDraft("") });
  };

  // Los archivos salen uno por uno, en orden, para que el cliente los reciba
  // como los eligió el operador y no en el orden en que terminó cada subida.
  const sendFiles = async (files: File[]) => {
    const accepted = files.filter((file) => {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast.error(`${file.name} supera los 25 MB`);
        return false;
      }
      return true;
    });
    if (accepted.length === 0) return;
    setQueue(accepted.map((f) => ({ name: f.name, size: f.size })));
    try {
      for (const file of accepted) {
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

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      {queue.length > 0 ? (
        <ul aria-live="polite" className="space-y-1 text-xs text-muted-foreground">
          {queue.map((f) => (
            <li key={f.name} className="flex items-center gap-1.5">
              <Paperclip aria-hidden className="h-3 w-3" />
              <span className="truncate">{f.name}</span>
              <span>· {formatBytes(f.size)}</span>
              <span>· enviando…</span>
            </li>
          ))}
        </ul>
      ) : null}
      {recorder.recording ? (
        <p role="status" className="flex items-center gap-1.5 text-xs text-destructive">
          <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-destructive" />
          Grabando nota de voz… pulsa el cuadrado para enviarla.
        </p>
      ) : null}
      <Textarea
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

/** Notas internas: solo las ve el equipo, nunca salen al cliente. */
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
      <div className="flex-1 overflow-y-auto pr-1">
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
      <div className="mt-3 space-y-2 border-t border-border pt-3">
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
 * Panel lateral con el hilo completo de una conversación. Permite transferir
 * el hilo a una persona, y cuando ya está con una persona, responderle al
 * cliente (texto, adjuntos, nota de voz), dejar notas internas y devolver el
 * hilo al agente.
 */
export function ConversationSheet({
  conversation,
  onOpenChange,
  userId,
}: {
  conversation: Conversation | null;
  onOpenChange: (open: boolean) => void;
  userId: string | undefined;
}) {
  // La página dueña del panel pasa la fila fresca de la lista cacheada (o la
  // copia con la que se abrió si esa fila dejó de coincidir con los filtros),
  // así que tras transferir/devolver el encabezado se actualiza solo.
  const current = conversation;
  const handoff = useHandoff(userId);
  const returnToAgent = useReturnToAgent();
  const [confirmReturn, setConfirmReturn] = useState(false);

  return (
    <Sheet open={conversation !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="font-mono">{current?.externalPhone ?? "Conversación"}</SheetTitle>
          <SheetDescription>
            {current
              ? `Por ${providerLabel(current.connection.provider)}${
                  current.connection.phoneNumber ? ` · ${current.connection.phoneNumber}` : ""
                }`
              : null}
          </SheetDescription>
          {current ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <StatusBadge status={current.status} domain="conversation" withDot />
              {current.handoffToHuman ? (
                <Badge variant="warning">Con una persona</Badge>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!userId}
                  loading={handoff.isPending && handoff.variables === current.id}
                  onClick={() => handoff.mutate(current.id)}
                >
                  <UserCog aria-hidden className="h-3.5 w-3.5" />
                  Transferir a una persona
                </Button>
              )}
            </div>
          ) : null}
        </SheetHeader>

        {current ? (
          // `key` reinicia pestaña, borradores y cola al cambiar de hilo.
          <Tabs key={current.id} defaultValue="messages" className="mt-4 flex min-h-0 flex-1 flex-col">
            <TabsList aria-label="Secciones de la conversación">
              <TabsTrigger value="messages">Mensajes</TabsTrigger>
              <TabsTrigger value="notes">Notas</TabsTrigger>
            </TabsList>
            <TabsContent value="messages" className="mt-3 flex min-h-0 flex-1 flex-col">
              <MessagesPane conversationId={current.id} handedOff={current.handoffToHuman} />
              {current.handoffToHuman ? (
                <Composer conversationId={current.id} onReturn={() => setConfirmReturn(true)} />
              ) : (
                <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                  El agente atiende este hilo. Transfiérelo a una persona para responder tú.
                </p>
              )}
            </TabsContent>
            <TabsContent value="notes" className="mt-3 flex min-h-0 flex-1 flex-col">
              <NotesPane conversationId={current.id} />
            </TabsContent>
          </Tabs>
        ) : null}
      </SheetContent>

      <ConfirmDialog
        open={confirmReturn}
        onOpenChange={setConfirmReturn}
        title="¿Devolver la conversación al agente?"
        description="El agente volverá a contestar los mensajes del cliente. Podrás transferirla de nuevo cuando quieras."
        confirmLabel="Devolver al agente"
        variant="default"
        pending={returnToAgent.isPending}
        onConfirm={() => {
          if (!current) return;
          returnToAgent.mutate(current.id, { onSuccess: () => setConfirmReturn(false) });
        }}
      />
    </Sheet>
  );
}
