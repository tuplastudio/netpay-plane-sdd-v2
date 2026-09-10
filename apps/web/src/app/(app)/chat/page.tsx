"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, MessagesSquare, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { api, fetchAuthMe } from "@/lib/api";
import { FullHeightMain } from "@/components/app/app-shell";
import { PageHeader } from "@/components/app/page-header";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Composer } from "./composer";
import { ContextPanels } from "./context-panels";
import { MessageBubble, TypingBubble } from "./message-bubble";
import type {
  AgentHealth,
  AgentResponse,
  CartLine,
  ChatMessage,
} from "./types";

/**
 * Chat con el agente comercial.
 *
 * El agente vive en apps/agent-service y se consume por el rewrite `/agent/*`
 * de Next (mismo origen). El catálogo se manda como respaldo: si el agente ya
 * tiene su API key, consulta el backend por su cuenta y este payload se ignora.
 *
 * Layout: dos paneles. El de la izquierda es la conversación —cabecera fija,
 * hilo con scroll propio y redactor anclado al pie—; el de la derecha es el
 * contexto (carrito, cotización, motor). La página no hace scroll en escritorio,
 * pero el alto no se calcula aquí: `<FullHeightMain />` le pide al shell que el
 * `<main>` ocupe la ventana, y esta pantalla solo se estira dentro de él con
 * `lg:min-h-0 lg:flex-1`. Cada panel resuelve su propio desbordamiento. No
 * vuelvas a poner un alto fijo: se desincroniza con la altura del topbar.
 */

const AGENT_BASE = "/agent";

const SAMPLE_PROMPTS = [
  "¿Qué venden?",
  "¿Hacen envíos a Monterrey?",
  "Quiero 3 Jazyfrut de jamaica",
  "¿Cómo puedo pagar?",
];

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [quote, setQuote] = useState<AgentResponse["quote"]>(null);
  const [checkout, setCheckout] = useState<AgentResponse["checkout"]>(null);
  const [handoff, setHandoff] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  /** Candado contra el doble envío: el estado de React llega tarde a un doble clic. */
  const sendingRef = useRef(false);

  /**
   * Tenant real de la sesión, con el mismo patrón que `AgentSettingsForm`:
   * misma consulta `["auth-me"]` contra `/auth/me`, que es quien sabe a qué
   * comercio pertenece la cookie.
   *
   * Se usa la UUID canónica, igual que WhatsApp y Commerce API, para que todos
   * los canales compartan ajustes y conocimiento sin mezclar empresas.
   */
  const me = useQuery({
    queryKey: ["auth-me"],
    queryFn: fetchAuthMe,
    retry: false,
  });
  const tenantId = me.data?.tenantId ?? null;
  const tenantResolving = me.isPending;
  const tenantFailed = !tenantResolving && !tenantId;

  const health = useQuery({
    queryKey: ["agent-health"],
    queryFn: async (): Promise<AgentHealth> => {
      const res = await fetch(`${AGENT_BASE}/healthz`);
      if (!res.ok) throw new Error("agente no disponible");
      return res.json();
    },
    retry: 1,
  });

  const products = useQuery({
    queryKey: ["catalog-for-agent"],
    queryFn: async () => {
      const res = await api.get<{
        data: Array<{
          title: string;
          description?: string;
          variants: Array<{
            id: string;
            sku: string;
            title: string;
            price: string;
            stock: string | null;
            status: string;
            satProductCode?: string;
            satUnitCode?: string;
          }>;
        }>;
      }>("/catalog/products");
      return res.data.data;
    },
    retry: false,
  });

  const catalogPayload = useMemo(
    () =>
      (products.data ?? []).flatMap((product) =>
        (product.variants ?? []).map((variant) => ({
          id: variant.id,
          sku: variant.sku,
          title: variant.title,
          productTitle: product.title,
          description: product.description ?? "",
          price: variant.price,
          satProductCode: variant.satProductCode ?? "01010101",
          satUnitCode: variant.satUnitCode ?? "H87",
          stock: variant.stock === null ? null : Number(variant.stock),
          status: variant.status ?? "ACTIVE",
        })),
      ),
    [products.data],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, busy]);

  const send = useCallback(
    async (text: string, audioBase64?: string) => {
      if (!text.trim() && !audioBase64) return;
      // Sin tenant no se manda nada: adivinarlo escribiría el hilo en el
      // comercio equivocado. El redactor ya está bloqueado en ese estado; esto
      // cubre la ruta por teclado y las sugerencias.
      if (!tenantId) return;
      if (sendingRef.current) return;
      sendingRef.current = true;
      setBusy(true);

      const outboundId = crypto.randomUUID();
      if (text.trim()) {
        setMessages((prev) => [
          ...prev,
          {
            id: outboundId,
            role: "user",
            content: text,
            createdAt: Date.now(),
            status: "PENDING",
          },
        ]);
      }
      setInput("");

      const markOutbound = (status: ChatMessage["status"]) =>
        setMessages((prev) =>
          prev.map((m) => (m.id === outboundId ? { ...m, status } : m)),
        );

      try {
        const res = await fetch(`${AGENT_BASE}/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            tenantId,
            conversationId,
            messageId: crypto.randomUUID(),
            text: text || null,
            audioBase64: audioBase64 ?? null,
            channel: "web",
            catalog: catalogPayload,
            principalScopes: [
              "catalog.read",
              "quotes.read",
              "quotes.write",
              "orders.read",
              "orders.write",
              "chat.read",
              "chat.write",
            ],
          }),
        });

        if (!res.ok) {
          const detail = await res.json().catch(() => ({}));
          throw new Error(detail.detail ?? `error ${res.status}`);
        }

        const data: AgentResponse = await res.json();
        markOutbound("DELIVERED");
        setConversationId(data.conversationId);
        setCart(data.cart ?? []);
        if (data.quote) setQuote(data.quote);
        if (data.checkout) setCheckout(data.checkout);
        if (data.handoff) setHandoff(true);

        if (data.transcript) {
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "user",
              content: data.transcript ?? "",
              createdAt: Date.now(),
              status: "DELIVERED",
            },
          ]);
        }
        if (data.reply) {
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: data.reply,
              createdAt: Date.now(),
              meta: {
                candidates: data.candidates,
                suggestions: data.suggestions,
                knowledgeRefs: data.knowledgeRefs,
                quote: data.quote,
                checkout: data.checkout,
                engine: data.engine,
                latencyMs: data.latencyMs,
                tools: data.toolCalls,
              },
            },
          ]);
        }
        if (data.handoff) {
          toast.warning("Un asesor humano toma la conversación");
        }
      } catch (error) {
        markOutbound("FAILED");
        toast.error(
          error instanceof Error
            ? error.message
            : "El agente no respondió. Revisa el servicio.",
        );
      } finally {
        sendingRef.current = false;
        setBusy(false);
      }
    },
    [catalogPayload, conversationId, tenantId],
  );

  async function toggleRecording() {
    if (recording) {
      recorderRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => chunks.push(event.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks, {
          type: recorder.mimeType || "audio/webm",
        });
        const buffer = await blob.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
        await send("", base64);
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      toast.error(
        "No pude usar el micrófono. Revisa los permisos del navegador.",
      );
    }
  }

  async function resetConversation() {
    setResetting(true);
    try {
      // Sin tenant no hay a quién pedirle el borrado remoto: se limpia el hilo
      // local y ya. Borrar en el tenant equivocado sería peor.
      if (conversationId && tenantId) {
        await fetch(
          `${AGENT_BASE}/conversations/${conversationId}?tenantId=${encodeURIComponent(tenantId)}`,
          {
            method: "DELETE",
          },
        ).catch(() => undefined);
      }
      setMessages([]);
      setConversationId(null);
      setCart([]);
      setQuote(null);
      setCheckout(null);
      setHandoff(false);
    } finally {
      setResetting(false);
      setResetConfirmOpen(false);
    }
  }

  function handleResetClick() {
    if (messages.length === 0) {
      void resetConversation();
      return;
    }
    setResetConfirmOpen(true);
  }

  const business = health.data?.knowledge?.business ?? "el negocio";
  // El handoff bloquea el redactor, igual que antes: un healthcheck en rojo se
  // avisa pero no impide intentar mandar, porque /chat puede seguir vivo aunque
  // /healthz falle. Lo que sí bloquea es no saber el tenant: mandar sin él
  // guardaría la conversación en otro comercio.
  const composerDisabled = handoff || !tenantId;
  const composerDisabledReason = handoff
    ? "El hilo lo lleva una persona: el agente ya no responde aquí."
    : tenantResolving
      ? "Identificando tu comercio…"
      : "Sin comercio identificado no se puede escribir al agente.";

  return (
    <>
      {/* Deja que el shell fije la altura: solo el hilo scrollea, el redactor queda anclado. */}
      <FullHeightMain />
      <div className="flex flex-col lg:min-h-0 lg:flex-1">
        <PageHeader
          className="mb-4 shrink-0"
          title={`Agente de ${business}`}
          description="Responde dudas del negocio, busca en el catálogo, cotiza y manda el enlace de pago."
          meta={
            <>
              <StatusBadge
                status={
                  health.isSuccess
                    ? "ACTIVE"
                    : health.isError
                      ? "ERROR"
                      : "PENDING"
                }
                tone={
                  health.isSuccess
                    ? "success"
                    : health.isError
                      ? "destructive"
                      : "neutral"
                }
                label={
                  health.isSuccess
                    ? "Agente en línea"
                    : health.isError
                      ? "Agente caído"
                      : "Verificando agente…"
                }
                withDot
              />
              {health.data?.commerce ? (
                <StatusBadge
                  status={
                    health.data.commerce.configured ? "ACTIVE" : "PENDING"
                  }
                  tone={health.data.commerce.configured ? "success" : "warning"}
                  label={
                    health.data.commerce.configured
                      ? "Catálogo conectado"
                      : "Catálogo por payload"
                  }
                  withDot
                />
              ) : null}
            </>
          }
          actions={
            <Button
              size="sm"
              variant="outline"
              onClick={handleResetClick}
              loading={resetting}
            >
              Reiniciar conversación
            </Button>
          }
        />

        <ConfirmDialog
          open={resetConfirmOpen}
          onOpenChange={setResetConfirmOpen}
          title="¿Reiniciar conversación?"
          description="Se borra el historial del chat, carrito y cotización en curso. No se puede deshacer."
          confirmLabel="Reiniciar"
          pending={resetting}
          onConfirm={resetConversation}
        />

        <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_20rem]">
          {/* Panel de conversación: solo el hilo hace scroll; el redactor va anclado. */}
          <section
            aria-label="Conversación con el agente"
            className="flex h-[60vh] min-h-[24rem] flex-col overflow-hidden rounded-card border bg-card shadow-airbnb lg:h-auto lg:min-h-0"
          >
            <div
              ref={scrollRef}
              // role="log" anuncia los mensajes nuevos sin robar el foco ni releer
              // el hilo completo, que es lo que pasaría con aria-live en un
              // contenedor sin rol.
              role="log"
              aria-live="polite"
              aria-relevant="additions text"
              aria-label="Mensajes"
              tabIndex={0}
              className="min-h-0 flex-1 overflow-y-auto p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground"
            >
              {messages.length === 0 && conversationId === null ? (
                <EmptyState
                  icon={<MessagesSquare className="h-6 w-6" />}
                  title="Sin conversación iniciada"
                  description="Escribe o manda una nota de voz para arrancar. Estas son algunas ideas:"
                  action={
                    <>
                      {SAMPLE_PROMPTS.map((sample) => (
                        <Button
                          key={sample}
                          variant="outline"
                          size="sm"
                          disabled={composerDisabled || busy}
                          className="h-8 rounded-pill px-3 text-xs font-normal"
                          onClick={() => void send(sample)}
                        >
                          {sample}
                        </Button>
                      ))}
                    </>
                  }
                />
              ) : messages.length === 0 ? (
                <EmptyState
                  icon={<MessagesSquare className="h-6 w-6" />}
                  title="Este hilo quedó vacío"
                  description="La conversación sigue abierta pero ya no tiene mensajes. Escribe abajo para continuarla."
                />
              ) : (
                <ol className="space-y-4">
                  {messages.map((message) => (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      disabled={composerDisabled || busy}
                      onPick={(text) => void send(text)}
                    />
                  ))}
                  {busy && <TypingBubble />}
                </ol>
              )}
            </div>

            {tenantFailed ? (
              <Alert
                variant="destructive"
                className="shrink-0 rounded-none border-x-0 border-b-0"
              >
                <AlertCircle aria-hidden />
                <AlertTitle>No pudimos identificar tu comercio</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>
                    El chat no puede mandar mensajes sin saber a qué comercio
                    pertenece tu sesión. Vuelve a intentar; si sigue igual,
                    inicia sesión de nuevo.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    loading={me.isFetching}
                    onClick={() => void me.refetch()}
                  >
                    Reintentar
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}

            {health.isError && !handoff ? (
              <Alert
                variant="destructive"
                className="shrink-0 rounded-none border-x-0 border-b-0"
              >
                <AlertCircle aria-hidden />
                <AlertTitle>El agente no está disponible</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>
                    No respondió el healthcheck, así que no se pueden mandar
                    mensajes.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    loading={health.isFetching}
                    onClick={() => void health.refetch()}
                  >
                    Reintentar
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}

            {handoff ? (
              <Alert
                variant="warning"
                className="shrink-0 rounded-none border-x-0 border-b-0"
              >
                <UserRound aria-hidden />
                <AlertTitle>Un asesor humano tomó la conversación</AlertTitle>
                <AlertDescription>
                  El agente ya no responde en este hilo.
                </AlertDescription>
              </Alert>
            ) : null}

            <Composer
              value={input}
              onChange={setInput}
              onSend={() => void send(input)}
              onToggleRecording={() => void toggleRecording()}
              recording={recording}
              busy={busy}
              disabled={composerDisabled}
              disabledReason={composerDisabledReason}
            />
          </section>

          <aside
            aria-label="Contexto de la conversación"
            className="lg:min-h-0 lg:overflow-y-auto lg:pb-1"
          >
            <ContextPanels
              cart={cart}
              quote={quote}
              checkout={checkout}
              messages={messages}
              health={{
                data: health.data,
                isLoading: health.isLoading,
                isError: health.isError,
                isFetching: health.isFetching,
              }}
              catalogError={products.isError}
              onRetryHealth={() => void health.refetch()}
              onRetryCatalog={() => void products.refetch()}
              retryingHealth={health.isFetching}
              retryingCatalog={products.isFetching}
            />
          </aside>
        </div>
      </div>
    </>
  );
}
