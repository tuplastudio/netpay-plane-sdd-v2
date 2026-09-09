"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { ConfirmDialog } from "@/components/confirm-dialog";

/**
 * Chat con el agente comercial.
 *
 * El agente vive en apps/agent-service y se consume por el rewrite `/agent/*`
 * de Next (mismo origen). El catálogo se manda como respaldo: si el agente ya
 * tiene su API key, consulta el backend por su cuenta y este payload se ignora.
 */

const AGENT_BASE = "/agent";

interface Candidate {
  variantId: string;
  score: number;
  reasons: string[];
  matchType: string;
  conflicts: string[];
  variant?: {
    id: string;
    sku: string;
    title: string;
    productTitle?: string;
    price: string;
    stock: number | null;
  };
}

interface CartLine {
  variantId: string;
  sku: string;
  title: string;
  quantity: string;
  unitPrice: string | null;
}

interface AgentResponse {
  conversationId: string;
  reply: string;
  handoff: boolean;
  intent: string | null;
  candidates: Candidate[];
  suggestions: string[];
  totals: Record<string, unknown> | null;
  quote: { quoteId: string; total: string; linkRef: string } | null;
  checkout: { orderId: string; linkRef: string } | null;
  cart: CartLine[];
  knowledgeRefs: string[];
  toolCalls: Array<{ tool: string; ok: boolean; latencyMs: number }>;
  engine: string;
  node: string;
  latencyMs: number;
  transcript?: string | null;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  meta?: {
    candidates?: Candidate[];
    suggestions?: string[];
    knowledgeRefs?: string[];
    quote?: AgentResponse["quote"];
    checkout?: AgentResponse["checkout"];
    engine?: string;
    latencyMs?: number;
    tools?: AgentResponse["toolCalls"];
  };
}

interface AgentHealth {
  status: string;
  llm: { live: boolean; model: string; toolCalling: boolean };
  commerce: { configured: boolean };
  knowledge: { docs: number; chunks: number; business: string };
}

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
  const [showTrace, setShowTrace] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);

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
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const send = useCallback(
    async (text: string, audioBase64?: string) => {
      if (!text.trim() && !audioBase64) return;
      setBusy(true);
      if (text.trim()) {
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "user", content: text },
        ]);
      }
      setInput("");

      try {
        const res = await fetch(`${AGENT_BASE}/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            tenantId: "demo",
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
        setConversationId(data.conversationId);
        setCart(data.cart ?? []);
        if (data.quote) setQuote(data.quote);
        if (data.checkout) setCheckout(data.checkout);
        if (data.handoff) setHandoff(true);

        if (data.transcript) {
          setMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), role: "user", content: data.transcript ?? "" },
          ]);
        }
        if (data.reply) {
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: data.reply,
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
        toast.error(
          error instanceof Error ? error.message : "El agente no respondió. Revisa el servicio.",
        );
      } finally {
        setBusy(false);
      }
    },
    [catalogPayload, conversationId],
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
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        const buffer = await blob.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
        await send("", base64);
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      toast.error("No pude usar el micrófono. Revisa los permisos del navegador.");
    }
  }

  async function resetConversation() {
    setResetting(true);
    try {
      if (conversationId) {
        await fetch(`${AGENT_BASE}/conversations/${conversationId}?tenantId=demo`, {
          method: "DELETE",
        }).catch(() => undefined);
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

  const business = health.data?.knowledge.business ?? "el negocio";
  const engineLabel = health.data?.llm.live
    ? `${health.data.llm.model}${health.data.llm.toolCalling ? " · tools" : ""}`
    : "motor determinista (sin OPENROUTER_KEY)";

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <PageHeader
        title={`Agente de ${business}`}
        description="Responde dudas del negocio, busca en el catálogo, cotiza y manda el enlace de pago."
        actions={
          <>
            <StatusDot ok={health.isSuccess} label={health.isSuccess ? "agente en línea" : "agente caído"} />
            <StatusDot
              ok={Boolean(health.data?.commerce.configured)}
              label={health.data?.commerce.configured ? "catálogo conectado" : "catálogo por payload"}
            />
            <Button size="sm" variant="ghost" onClick={handleResetClick}>
              Reiniciar
            </Button>
          </>
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

      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <section className="rounded-card border bg-card">
          <div ref={scrollRef} className="h-[26rem] space-y-4 overflow-y-auto p-4">
            {messages.length === 0 && <EmptyState onPick={(text) => void send(text)} />}
            {messages.map((message) => (
              <Bubble key={message.id} message={message} onPick={(text) => void send(text)} />
            ))}
            {busy && <Typing />}
          </div>

          {handoff && (
            <p className="border-t bg-amber-50 px-4 py-2 text-xs text-amber-900">
              Un asesor humano tomó la conversación. El agente ya no responde en este hilo.
            </p>
          )}

          <form
            className="flex gap-2 border-t p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void send(input);
            }}
          >
            <Input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={`Pregunta por un producto, precios o envíos…`}
              disabled={busy || handoff}
            />
            <Button
              type="button"
              variant={recording ? "destructive" : "outline"}
              size="icon"
              title="Nota de voz"
              onClick={() => void toggleRecording()}
              disabled={busy || handoff}
            >
              {recording ? "■" : "🎙"}
            </Button>
            <Button type="submit" disabled={busy || handoff}>
              Enviar
            </Button>
          </form>
        </section>

        <aside className="space-y-4">
          <Panel title="Carrito en borrador">
            {cart.length === 0 ? (
              <p className="text-xs text-muted-foreground">Todavía no hay líneas.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {cart.map((line) => (
                  <li key={line.variantId} className="flex justify-between gap-2">
                    <span className="truncate">
                      {line.quantity} × {line.title}
                    </span>
                    <span className="text-muted-foreground">{line.sku}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {quote && (
            <Panel title="Cotización emitida">
              <p className="text-xs">Total ${quote.total}</p>
              <a
                className="text-xs text-primary underline"
                href={quote.linkRef}
                target="_blank"
                rel="noreferrer"
              >
                Ver cotización pública
              </a>
            </Panel>
          )}

          {checkout && (
            <Panel title="Enlace de pago">
              <a
                className="text-xs text-primary underline"
                href={checkout.linkRef}
                target="_blank"
                rel="noreferrer"
              >
                Abrir checkout
              </a>
            </Panel>
          )}

          <Panel title="Motor">
            <p className="text-xs text-muted-foreground">{engineLabel}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {health.data?.knowledge.docs ?? 0} documentos · {health.data?.knowledge.chunks ?? 0}{" "}
              secciones del negocio
            </p>
            <button
              className="mt-2 text-xs text-primary underline"
              onClick={() => setShowTrace((value) => !value)}
              type="button"
            >
              {showTrace ? "Ocultar" : "Ver"} herramientas usadas
            </button>
            <p className="mt-2 text-xs">
              <Link className="text-primary underline" href="/admin">
                Editar conocimiento del negocio
              </Link>
            </p>
          </Panel>

          {showTrace && (
            <Panel title="Traza">
              <ul className="space-y-1 text-[11px] text-muted-foreground">
                {messages
                  .flatMap((message) => message.meta?.tools ?? [])
                  .slice(-8)
                  .map((call, index) => (
                    <li key={index}>
                      {call.ok ? "✓" : "✗"} {call.tool} · {call.latencyMs} ms
                    </li>
                  ))}
              </ul>
            </Panel>
          )}
        </aside>
      </div>
    </div>
  );
}

function Bubble({
  message,
  onPick,
}: {
  message: ChatMessage;
  onPick: (text: string) => void;
}) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[85%] space-y-2">
        <div
          className={`whitespace-pre-line rounded-lg px-3 py-2 text-sm ${
            isUser ? "bg-primary text-primary-foreground" : "bg-muted"
          }`}
        >
          {message.content}
        </div>

        {message.meta?.candidates && message.meta.candidates.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {message.meta.candidates.slice(0, 3).map((candidate, index) => (
              <button
                key={candidate.variantId}
                type="button"
                onClick={() => onPick(`opción ${index + 1}`)}
                className="rounded-md border bg-background p-2 text-left text-xs hover:border-primary"
              >
                <p className="font-medium">
                  {candidate.variant?.productTitle
                    ? `${candidate.variant.productTitle} — `
                    : ""}
                  {candidate.variant?.title}
                </p>
                <p className="text-muted-foreground">
                  {candidate.variant?.sku} · ${candidate.variant?.price}
                </p>
                {candidate.conflicts.length > 0 && (
                  <p className="mt-1 text-amber-700">{candidate.conflicts.join(", ")}</p>
                )}
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {candidate.reasons.slice(0, 2).join(" · ")}
                </p>
              </button>
            ))}
          </div>
        )}

        {!isUser && message.meta?.suggestions && message.meta.suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {message.meta.suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => onPick(suggestion)}
                className="rounded-full border px-2 py-1 text-xs hover:bg-accent"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        {!isUser && message.meta?.knowledgeRefs && message.meta.knowledgeRefs.length > 0 && (
          <p className="text-[10px] text-muted-foreground">
            Fuente: {message.meta.knowledgeRefs.join(" · ")}
          </p>
        )}

        {!isUser && message.meta?.checkout?.linkRef ? (
          <a
            href={message.meta.checkout.linkRef}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-emerald-700"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Abrir enlace de pago · ${message.meta.quote?.total ?? ""}
          </a>
        ) : null}

        {!isUser && message.meta?.quote?.linkRef && !message.meta?.checkout?.linkRef ? (
          <a
            href={message.meta.quote.linkRef}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Ver cotización · ${message.meta.quote.total ?? ""}
          </a>
        ) : null}
      </div>
    </div>
  );
}

function Typing() {
  return (
    <div className="flex justify-start">
      <div className="flex gap-1 rounded-lg bg-muted px-3 py-2">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground/50"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  const samples = [
    "¿Qué venden?",
    "¿Hacen envíos a Monterrey?",
    "Quiero 3 Jazyfrut de jamaica",
    "¿Cómo puedo pagar?",
  ];
  return (
    <div className="space-y-3 text-sm text-muted-foreground">
      <p>Escribe o manda una nota de voz. Algunas ideas:</p>
      <div className="flex flex-wrap gap-2">
        {samples.map((sample) => (
          <button
            key={sample}
            type="button"
            onClick={() => onPick(sample)}
            className="rounded-full border px-3 py-1 text-xs hover:bg-accent"
          >
            {sample}
          </button>
        ))}
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border bg-card p-3">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </div>
  );
}

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="flex items-center gap-1 text-muted-foreground">
      <span className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-500" : "bg-red-500"}`} />
      {label}
    </span>
  );
}
