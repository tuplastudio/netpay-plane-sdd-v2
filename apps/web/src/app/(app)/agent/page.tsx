"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, MessageSquare, Upload, Trash2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page-header";
import { AgentSettingsForm } from "@/components/app/agent-settings-form";
import { ConfirmDialog } from "@/components/confirm-dialog";

/**
 * Consola del agente: qué sabe del negocio, con qué modelo trabaja y qué
 * herramientas puede ejecutar. La edición del conocimiento es por archivo
 * Markdown en apps/agent-service/knowledge; aquí se recarga y se prueba.
 */

const AGENT_BASE = "/agent";

interface KnowledgeStats {
  dir: string;
  docs: string[];
  chunks: number;
  profile: {
    name: string;
    agentName: string;
    tone: string;
    hours: string;
    coverage: string;
    currency: string;
    phone: string;
  };
  warnings: string[];
  outline: Array<{ doc: string; sections: string[] }>;
}

interface Diagnostics {
  llm: { live: boolean; model: string; toolCalling: boolean; registered: boolean; promptVersion: string };
  commerce: { ok: boolean; reason?: string };
  budgets: Record<string, number>;
}

interface ToolSpec {
  name: string;
  description: string;
  scope: string;
  mutating: boolean;
}

interface LearningSignal {
  id: string;
  tenantId: string;
  conversationId: string;
  kind: "unanswered_question" | "handoff";
  question: string;
  reason: string | null;
  createdAt: number;
  status: "pending" | "approved" | "dismissed";
  docId: string | null;
}

export default function AgentConsolePage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Array<{ ref: string; score: number; body: string }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const [docToDelete, setDocToDelete] = useState<string | null>(null);

  const knowledge = useQuery({
    queryKey: ["agent-knowledge"],
    queryFn: async (): Promise<KnowledgeStats> => {
      const res = await fetch(`${AGENT_BASE}/knowledge`);
      if (!res.ok) throw new Error("agente no disponible");
      return res.json();
    },
  });

  const diagnostics = useQuery({
    queryKey: ["agent-diagnostics"],
    queryFn: async (): Promise<Diagnostics> => {
      const res = await fetch(`${AGENT_BASE}/diagnostics`);
      if (!res.ok) throw new Error("agente no disponible");
      return res.json();
    },
  });

  const tools = useQuery({
    queryKey: ["agent-tools"],
    queryFn: async (): Promise<{ tools: ToolSpec[] }> => {
      const res = await fetch(`${AGENT_BASE}/tools`);
      if (!res.ok) throw new Error("agente no disponible");
      return res.json();
    },
  });

  const reload = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${AGENT_BASE}/knowledge/reload`, { method: "POST" });
      if (!res.ok) throw new Error("no se pudo recargar");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Conocimiento recargado");
      void queryClient.invalidateQueries({ queryKey: ["agent-knowledge"] });
    },
    onError: () => toast.error("El agente no respondió"),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file, file.name);
      const res = await fetch(`${AGENT_BASE}/knowledge/upload`, { method: "POST", body: form });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.detail ?? "no se pudo subir el archivo");
      }
      return res.json();
    },
    onSuccess: (data: { docId: string }) => {
      toast.success(`${data.docId} indexado`);
      void queryClient.invalidateQueries({ queryKey: ["agent-knowledge"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteDoc = useMutation({
    mutationFn: async (docId: string) => {
      const res = await fetch(`${AGENT_BASE}/knowledge/${docId}`, { method: "DELETE" });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.detail ?? "no se pudo borrar");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Documento borrado");
      setDocToDelete(null);
      void queryClient.invalidateQueries({ queryKey: ["agent-knowledge"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function handleFilePicked(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".md")) {
      toast.error("Solo se aceptan archivos .md");
      return;
    }
    upload.mutate(file);
  }

  const learning = useQuery({
    queryKey: ["agent-learning"],
    queryFn: async (): Promise<{ signals: LearningSignal[] }> => {
      const res = await fetch(`${AGENT_BASE}/learning/signals?status=pending`);
      if (!res.ok) throw new Error("agente no disponible");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const approveSignal = useMutation({
    mutationFn: async ({ id, answer }: { id: string; answer: string }) => {
      const res = await fetch(`${AGENT_BASE}/learning/signals/${id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answer }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.detail ?? "no se pudo aprobar");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Aprendizaje incorporado al conocimiento");
      void queryClient.invalidateQueries({ queryKey: ["agent-learning"] });
      void queryClient.invalidateQueries({ queryKey: ["agent-knowledge"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const dismissSignal = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${AGENT_BASE}/learning/signals/${id}/dismiss`, { method: "POST" });
      if (!res.ok) throw new Error("no se pudo descartar");
      return res.json();
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["agent-learning"] }),
    onError: (error: Error) => toast.error(error.message),
  });

  async function search() {
    if (query.trim().length < 2) return;
    const res = await fetch(`${AGENT_BASE}/knowledge/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) {
      toast.error("No pude consultar el conocimiento");
      return;
    }
    const data = await res.json();
    setHits(data.hits ?? []);
  }

  const profile = knowledge.data?.profile;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Agente"
        description="Conocimiento del negocio, modelo y herramientas autorizadas."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/chat">
                <MessageSquare className="h-4 w-4" />
                Probar en el chat
              </Link>
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,text/markdown"
              className="hidden"
              onChange={handleFilePicked}
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={upload.isPending}
            >
              <Upload className="h-4 w-4" />
              {upload.isPending ? "Subiendo…" : "Subir Markdown"}
            </Button>
            <Button onClick={() => reload.mutate()} disabled={reload.isPending}>
              <RefreshCw className="h-4 w-4" />
              {reload.isPending ? "Recargando…" : "Recargar conocimiento"}
            </Button>
          </>
        }
      />

      <AgentSettingsForm />

      <section className="grid gap-4 md:grid-cols-3">
        <Card title="Identidad">
          {profile ? (
            <dl className="space-y-1 text-sm">
              <Row label="Negocio" value={profile.name} />
              <Row label="Agente" value={profile.agentName} />
              <Row label="Moneda" value={profile.currency} />
              <Row label="Horario" value={profile.hours || "—"} />
              <Row label="Cobertura" value={profile.coverage || "—"} />
              <Row label="Teléfono" value={profile.phone || "—"} />
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">Sin datos del agente.</p>
          )}
        </Card>

        <Card title="Modelo">
          {diagnostics.data ? (
            <dl className="space-y-1 text-sm">
              <Row label="Estado" value={diagnostics.data.llm.live ? "LLM activo" : "motor determinista"} />
              <Row label="Modelo" value={diagnostics.data.llm.model} />
              <Row label="Tool calling" value={diagnostics.data.llm.toolCalling ? "sí" : "no"} />
              <Row label="En registro" value={diagnostics.data.llm.registered ? "sí" : "no"} />
              <Row label="Prompt" value={diagnostics.data.llm.promptVersion} />
              <Row
                label="API comercial"
                value={diagnostics.data.commerce.ok ? "conectada" : diagnostics.data.commerce.reason ?? "sin conexión"}
              />
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">Sin diagnóstico.</p>
          )}
        </Card>

        <Card title="Documentos">
          <p className="text-sm">
            {knowledge.data?.docs.length ?? 0} archivos · {knowledge.data?.chunks ?? 0} secciones
          </p>
          <p className="mt-1 break-all text-xs text-muted-foreground">{knowledge.data?.dir}</p>
          <ul className="mt-2 space-y-1 text-xs">
            {(knowledge.data?.docs ?? []).map((doc) => {
              const uploaded = doc.startsWith("uploads/");
              return (
                <li key={doc} className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    • {doc} {uploaded && <Badge variant="muted" className="ml-1 align-middle">subido</Badge>}
                  </span>
                  {uploaded && (
                    <button
                      type="button"
                      title="Borrar documento subido"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setDocToDelete(doc)}
                      disabled={deleteDoc.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {(knowledge.data?.warnings ?? []).map((warning) => (
            <p key={warning} className="mt-2 text-xs text-amber-700">
              ⚠ {warning}
            </p>
          ))}
        </Card>
      </section>

      <section className="rounded-card border bg-card p-4">
        <h2 className="mb-3 font-medium">Probar una pregunta del negocio</h2>
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="¿Hacen envíos a Monterrey?"
            onKeyDown={(event) => {
              if (event.key === "Enter") void search();
            }}
          />
          <Button onClick={() => void search()}>Buscar</Button>
        </div>
        <ul className="mt-3 space-y-2">
          {hits.map((hit) => (
            <li key={hit.ref} className="rounded-md border p-2 text-sm">
              <p className="text-xs text-muted-foreground">
                {hit.ref} · score {hit.score.toFixed(2)}
              </p>
              <p className="mt-1 whitespace-pre-line">{hit.body.slice(0, 400)}</p>
            </li>
          ))}
          {hits.length === 0 && (
            <li className="text-sm text-muted-foreground">
              Sin resultados todavía. Escribe una pregunta como la haría un cliente.
            </li>
          )}
        </ul>
      </section>

      <section className="rounded-card border bg-card p-4">
        <h2 className="mb-3 font-medium">Herramientas autorizadas</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-1">Herramienta</th>
                <th>Scope</th>
                <th>Efecto</th>
                <th>Descripción</th>
              </tr>
            </thead>
            <tbody>
              {(tools.data?.tools ?? []).map((tool) => (
                <tr key={tool.name} className="border-t">
                  <td className="py-1 font-mono text-xs">{tool.name}</td>
                  <td className="font-mono text-xs">{tool.scope}</td>
                  <td className="text-xs">{tool.mutating ? "escribe" : "lee"}</td>
                  <td className="text-xs text-muted-foreground">{tool.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-card border bg-card p-4">
        <h2 className="mb-1 font-medium">Aprendizaje entre sesiones</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Preguntas que el bot no supo responder o que escaló a un humano. Nunca se agregan solas
          al conocimiento: cada una espera que alguien escriba la respuesta y la apruebe.
        </p>
        <ul className="space-y-3">
          {(learning.data?.signals ?? []).map((signal) => (
            <li key={signal.id} className="rounded-md border p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <Badge variant={signal.kind === "handoff" ? "warning" : "secondary"}>
                    {signal.kind === "handoff" ? "handoff a humano" : "sin respuesta"}
                  </Badge>
                  <p className="mt-1 text-sm font-medium">{signal.question}</p>
                  {signal.reason && (
                    <p className="text-xs text-muted-foreground">motivo: {signal.reason}</p>
                  )}
                </div>
                <button
                  type="button"
                  title="Descartar"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => dismissSignal.mutate(signal.id)}
                  disabled={dismissSignal.isPending}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-2 flex gap-2">
                <Textarea
                  placeholder="Respuesta oficial que se guarda como conocimiento…"
                  value={answerDrafts[signal.id] ?? ""}
                  onChange={(event) =>
                    setAnswerDrafts((prev) => ({ ...prev, [signal.id]: event.target.value }))
                  }
                  className="min-h-[60px] text-sm"
                />
                <Button
                  size="sm"
                  className="self-end"
                  disabled={!answerDrafts[signal.id]?.trim() || approveSignal.isPending}
                  onClick={() =>
                    approveSignal.mutate({ id: signal.id, answer: answerDrafts[signal.id]!.trim() })
                  }
                >
                  <Check className="h-4 w-4" />
                  Aprobar
                </Button>
              </div>
            </li>
          ))}
          {(learning.data?.signals ?? []).length === 0 && (
            <li className="text-sm text-muted-foreground">
              Sin sugerencias pendientes. Se generan cuando un cliente pregunta algo que no está en
              el conocimiento o cuando el bot escala a un humano.
            </li>
          )}
        </ul>
      </section>

      <section className="rounded-card border bg-card p-4">
        <h2 className="mb-3 font-medium">Secciones indexadas</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {(knowledge.data?.outline ?? []).map((doc) => (
            <div key={doc.doc}>
              <p className="text-sm font-medium">{doc.doc}</p>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {doc.sections.map((section) => (
                  <li key={section}>• {section.split("#")[1]}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <ConfirmDialog
        open={docToDelete !== null}
        onOpenChange={(open) => !open && setDocToDelete(null)}
        title={`¿Borrar "${docToDelete}"?`}
        description="Se elimina el archivo y su contenido deja de usarse en el conocimiento del agente. No se puede deshacer."
        confirmLabel="Borrar"
        pending={deleteDoc.isPending}
        onConfirm={() => docToDelete && deleteDoc.mutate(docToDelete)}
      />
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border bg-card p-4">
      <h2 className="mb-2 font-medium">{title}</h2>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
