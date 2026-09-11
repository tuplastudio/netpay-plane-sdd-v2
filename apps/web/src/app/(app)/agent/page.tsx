"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  Check,
  CircleHelp,
  FileText,
  Globe,
  GraduationCap,
  MessageSquare,
  RefreshCw,
  Search as SearchIcon,
  Trash2,
  Upload,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SkeletonText } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { AgentSettingsForm } from "@/components/app/agent-settings-form";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DescriptionList, FieldRow } from "@/components/app/field-row";
import { EntityId } from "@/components/app/entity-id";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/**
 * Consola del agente organizada en 4 pestañas:
 *
 * 1. General       — estado del servicio + identidad del modelo + ajustes
 *                    editables (identidad, estilo, OpenRouter key, WhatsApp).
 * 2. Conocimiento  — qué sabe: documentos, búsqueda de prueba, secciones
 *                    indexadas, herramientas para subir más.
 * 3. Aprendizaje   — preguntas que el agente no supo contestar o que
 *                    escaló a un humano. Cada una espera respuesta humana.
 * 4. Herramientas  — tabla de tools del agente y sus scopes.
 *
 * El estado de salud (LLM vivo, modelo, prompt, conexión a commerce-api)
 * vive en una franja superior visible desde todas las pestañas: es la
 * única señal operativa de "el agente responde".
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
  llm?: { live: boolean; model: string; toolCalling?: boolean; registered?: boolean; promptVersion?: string };
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

interface WebPreviewSection {
  heading: string;
  body: string;
}

interface WebPreviewResult {
  url: string;
  title: string;
  sections: WebPreviewSection[];
}

/** Valida http(s) sin llamar al backend, solo para habilitar "Previsualizar". */
function isPreviewableUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function QueryError({
  title,
  onRetry,
  retrying,
}: {
  title: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <Alert variant="destructive">
      <AlertCircle aria-hidden />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>El servicio del agente no respondió. Revisa que esté arriba.</p>
        <Button variant="outline" size="sm" loading={retrying} onClick={onRetry}>
          <RefreshCw aria-hidden className="h-3.5 w-3.5" />
          Reintentar
        </Button>
      </AlertDescription>
    </Alert>
  );
}

export default function AgentConsolePage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("general");
  const [query, setQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const [docToDelete, setDocToDelete] = useState<string | null>(null);
  const [webUrl, setWebUrl] = useState("");
  const [selectedWebSections, setSelectedWebSections] = useState<Record<string, boolean>>({});
  const [expandedWebSections, setExpandedWebSections] = useState<Set<string>>(new Set());
  const [selectedTool, setSelectedTool] = useState<ToolSpec | null>(null);

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

  const learning = useQuery({
    queryKey: ["agent-learning"],
    queryFn: async (): Promise<{ signals: LearningSignal[] }> => {
      const res = await fetch(`${AGENT_BASE}/learning/signals?status=pending`);
      if (!res.ok) throw new Error("agente no disponible");
      return res.json();
    },
    refetchInterval: 30_000,
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

  const webPreview = useMutation<WebPreviewResult, Error, string>({
    mutationFn: async (url: string) => {
      const res = await fetch(`${AGENT_BASE}/knowledge/web/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.detail ?? "No pude leer la página");
      }
      return res.json();
    },
    onSuccess: (data) => {
      // Todas las secciones arrancan marcadas: el checkbox es para EXCLUIR,
      // no para tener que elegir una por una.
      setSelectedWebSections(
        Object.fromEntries(data.sections.map((_, index) => [`${index}`, true])),
      );
      setExpandedWebSections(new Set());
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const webSectionEntries = (webPreview.data?.sections ?? []).map((section, index) => ({
    section,
    key: `${index}`,
    checked: selectedWebSections[`${index}`] ?? true,
  }));
  const checkedWebSections = webSectionEntries.filter((entry) => entry.checked);
  const webSelectedCharCount = checkedWebSections.reduce(
    (sum, entry) => sum + entry.section.heading.length + entry.section.body.length,
    0,
  );

  const webSave = useMutation<{ docId: string; chars: number }, Error, void>({
    mutationFn: async () => {
      const preview = webPreview.data;
      if (!preview) throw new Error("Primero previsualiza la página");
      const sections = checkedWebSections.map((entry) => entry.section.heading);
      const res = await fetch(`${AGENT_BASE}/knowledge/web/save`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: preview.url, title: preview.title, sections }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.detail ?? "No pude guardar la página");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast.success(`${data.docId} indexado`);
      setWebUrl("");
      setSelectedWebSections({});
      setExpandedWebSections(new Set());
      webPreview.reset();
      void queryClient.invalidateQueries({ queryKey: ["agent-knowledge"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function runWebPreview() {
    const url = webUrl.trim();
    if (!isPreviewableUrl(url)) return;
    webPreview.mutate(url);
  }

  function toggleWebSectionExpanded(key: string) {
    setExpandedWebSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

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

  const search = useMutation({
    mutationFn: async (q: string): Promise<Array<{ ref: string; score: number; body: string }>> => {
      const res = await fetch(`${AGENT_BASE}/knowledge/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error("No pude consultar el conocimiento");
      const data = await res.json();
      return data.hits ?? [];
    },
    onError: () => toast.error("No pude consultar el conocimiento"),
  });

  function runSearch() {
    if (query.trim().length < 2) return;
    search.mutate(query);
  }

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

  const profile = knowledge.data?.profile;
  const docs = knowledge.data?.docs ?? [];
  const warnings = knowledge.data?.warnings ?? [];
  const outline = knowledge.data?.outline ?? [];
  const signals = learning.data?.signals ?? [];
  const hits = search.data;
  const pendingSignals = signals.length;

  const toolColumns: Array<DataTableColumn<ToolSpec>> = [
    {
      key: "name",
      header: "Herramienta",
      width: "14rem",
      className: "font-mono text-xs",
      cell: (t) => t.name,
    },
    {
      key: "scope",
      header: "Scope",
      width: "10rem",
      className: "font-mono text-xs",
      cell: (t) => t.scope,
    },
    {
      key: "mutating",
      header: "Efecto",
      width: "7rem",
      cell: (t) => (
        <Badge variant={t.mutating ? "warning" : "neutral"}>
          {t.mutating ? "Escribe" : "Lee"}
        </Badge>
      ),
    },
    {
      key: "description",
      header: "Descripción",
      className: "text-xs text-muted-foreground",
      cell: (t) => t.description,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Agente"
        description="Conocimiento del negocio, modelo, herramientas y aprendizaje."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/chat">
                <MessageSquare aria-hidden className="h-4 w-4" />
                Probar en el chat
              </Link>
            </Button>
            <Button onClick={() => reload.mutate()} loading={reload.isPending}>
              <RefreshCw aria-hidden className="h-4 w-4" />
              {reload.isPending ? "Recargando…" : "Recargar conocimiento"}
            </Button>
          </>
        }
      />

      <div className="space-y-6">
        <HealthBanner knowledge={knowledge.data} diagnostics={diagnostics.data} />

        <Tabs value={tab} defaultValue={tab} onValueChange={setTab} className="space-y-4">
          <div className="overflow-x-auto pb-1">
            <TabsList>
              <TabsTrigger value="general" className="gap-1.5">
                <CircleHelp aria-hidden className="h-3.5 w-3.5" />
                General
              </TabsTrigger>
              <TabsTrigger value="knowledge" className="gap-1.5">
                <BookOpen aria-hidden className="h-3.5 w-3.5" />
                Conocimiento
                {docs.length > 0 ? (
                  <span className="ml-1 tabular-nums text-muted-foreground">
                    {docs.length}
                  </span>
                ) : null}
              </TabsTrigger>
              <TabsTrigger value="learning" className="gap-1.5">
                <GraduationCap aria-hidden className="h-3.5 w-3.5" />
                Aprendizaje
                {pendingSignals > 0 ? (
                  <span className="ml-1 rounded-full bg-warning px-1.5 tabular-nums text-[10px] text-warning-foreground">
                    {pendingSignals}
                  </span>
                ) : null}
              </TabsTrigger>
              <TabsTrigger value="tools" className="gap-1.5">
                <Wrench aria-hidden className="h-3.5 w-3.5" />
                Herramientas
              </TabsTrigger>
            </TabsList>
          </div>

          {/* ============== GENERAL ============== */}
          <TabsContent value="general" className="space-y-4">
            <AgentSettingsForm />

            <div className="grid items-start gap-4 md:grid-cols-2">
              <Section as="h3" title="Identidad" description="Lo que negocio.md declara del negocio.">
                {knowledge.isError ? (
                  <QueryError
                    title="Sin datos del agente"
                    retrying={knowledge.isFetching}
                    onRetry={() => void knowledge.refetch()}
                  />
                ) : knowledge.isLoading ? (
                  <SkeletonText lines={6} label="Cargando la identidad del agente…" />
                ) : profile ? (
                  <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                    <Row label="Negocio" value={profile.name} />
                    <Row label="Agente" value={profile.agentName} />
                    <Row label="Tono" value={profile.tone} />
                    <Row label="Moneda" value={profile.currency} />
                    <Row label="Horario" value={profile.hours} />
                    <Row label="Cobertura" value={profile.coverage} />
                    <Row label="Teléfono" value={profile.phone} mono />
                  </dl>
                ) : (
                  <EmptyState
                    title="Sin perfil"
                    description="El agente no expuso un perfil de negocio. Revisa negocio.md."
                  />
                )}
              </Section>

              <Section as="h3" title="Modelo" description="Estado del LLM y conexión a commerce-api.">
                {diagnostics.isError ? (
                  <QueryError
                    title="Sin diagnóstico"
                    retrying={diagnostics.isFetching}
                    onRetry={() => void diagnostics.refetch()}
                  />
                ) : diagnostics.isLoading ? (
                  <SkeletonText lines={6} label="Cargando el diagnóstico del modelo…" />
                ) : diagnostics.data?.llm ? (
                  <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                    <Row
                      label="Estado"
                      value={
                        <Badge variant={diagnostics.data.llm.live ? "success" : "neutral"}>
                          {diagnostics.data.llm.live ? "LLM activo" : "Motor determinista"}
                        </Badge>
                      }
                    />
                    <Row label="Modelo" value={diagnostics.data.llm.model} mono />
                    <Row
                      label="Tool calling"
                      value={
                        diagnostics.data.llm.toolCalling === undefined
                          ? "—"
                          : diagnostics.data.llm.toolCalling
                            ? "Sí"
                            : "No"
                        }
                    />
                    <Row
                      label="En registro"
                      value={
                        diagnostics.data.llm.registered === undefined
                          ? "—"
                          : diagnostics.data.llm.registered
                            ? "Sí"
                            : "No"
                        }
                    />
                    <Row
                      label="Prompt"
                      value={diagnostics.data.llm.promptVersion ?? "—"}
                      mono
                    />
                    <Row
                      label="API comercial"
                      value={
                        diagnostics.data.commerce?.ok ? (
                          <Badge variant="success">Conectada</Badge>
                        ) : (
                          <span className="text-warning-foreground">
                            {diagnostics.data.commerce?.reason ?? "Sin conexión"}
                          </span>
                        )
                      }
                    />
                  </dl>
                ) : null}
              </Section>
            </div>
          </TabsContent>

          {/* ============== CONOCIMIENTO ============== */}
          <TabsContent value="knowledge" className="space-y-4">
            <Section
              as="h3"
              title="Documentos"
              description={
                knowledge.data
                  ? `${docs.length} archivos · ${knowledge.data.chunks} secciones indexadas`
                  : undefined
              }
              actions={
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".md,text/markdown"
                    className="hidden"
                    aria-hidden
                    tabIndex={-1}
                    onChange={handleFilePicked}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    loading={upload.isPending}
                  >
                    <Upload aria-hidden className="h-3.5 w-3.5" />
                    {upload.isPending ? "Subiendo…" : "Subir Markdown"}
                  </Button>
                </>
              }
            >
              {knowledge.isError ? (
                <QueryError
                  title="Sin documentos"
                  retrying={knowledge.isFetching}
                  onRetry={() => void knowledge.refetch()}
                />
              ) : knowledge.isLoading ? (
                <SkeletonText lines={5} label="Cargando los documentos indexados…" />
              ) : (
                <div className="space-y-3">
                  <p className="break-all font-mono text-xs text-muted-foreground">
                    {knowledge.data?.dir}
                  </p>
                  {docs.length === 0 ? (
                    <EmptyState
                      icon={<FileText className="h-6 w-6" />}
                      title="Sin documentos"
                      description="Sube un .md para que el agente tenga qué responder."
                      action={
                        <Button size="sm" onClick={() => fileInputRef.current?.click()}>
                          <Upload aria-hidden className="h-4 w-4" />
                          Subir Markdown
                        </Button>
                      }
                    />
                  ) : (
                    <ul className="space-y-1 text-xs">
                      {docs.map((doc) => {
                        const uploaded = doc.startsWith("uploads/");
                        return (
                          <li
                            key={doc}
                            className="flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2"
                          >
                            <span className="min-w-0 truncate">
                              {doc}
                              {uploaded && (
                                <Badge variant="muted" className="ml-1 align-middle">
                                  subido
                                </Badge>
                              )}
                            </span>
                            {uploaded ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                                aria-label={`Borrar el documento ${doc}`}
                                onClick={() => setDocToDelete(doc)}
                                disabled={deleteDoc.isPending}
                              >
                                <Trash2 aria-hidden className="h-3.5 w-3.5" />
                              </Button>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {warnings.length > 0 ? (
                    <Alert variant="warning">
                      <AlertTriangle aria-hidden />
                      <AlertTitle>
                        {warnings.length === 1
                          ? "Una advertencia"
                          : `${warnings.length} advertencias`}
                      </AlertTitle>
                      <AlertDescription>
                        <ul className="list-disc space-y-1 pl-4">
                          {warnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                          ))}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  ) : null}
                </div>
              )}
            </Section>

            <Section
              as="h3"
              title="Leer una página web"
              description="Trae el contenido de una URL pública y guárdalo como conocimiento del negocio, igual que un .md subido a mano."
            >
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="web-url">URL</Label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      id="web-url"
                      type="url"
                      inputMode="url"
                      value={webUrl}
                      onChange={(event) => setWebUrl(event.target.value)}
                      placeholder="https://ejemplo.com/preguntas-frecuentes"
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          runWebPreview();
                        }
                      }}
                    />
                    <Button
                      className="sm:w-auto"
                      variant="outline"
                      onClick={runWebPreview}
                      loading={webPreview.isPending}
                      disabled={!isPreviewableUrl(webUrl)}
                    >
                      <Globe aria-hidden className="h-4 w-4" />
                      Previsualizar
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Solo páginas públicas (http/https). No se leen direcciones locales o de red interna.
                  </p>
                </div>

                {webPreview.isError ? (
                  <Alert variant="destructive">
                    <AlertCircle aria-hidden />
                    <AlertTitle>No pude leer la página</AlertTitle>
                    <AlertDescription>{webPreview.error.message}</AlertDescription>
                  </Alert>
                ) : null}

                {webPreview.isPending ? (
                  <SkeletonText lines={4} label="Leyendo la página…" />
                ) : null}

                {webPreview.data ? (
                  <div className="space-y-3 rounded-lg border bg-card p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{webPreview.data.title}</p>
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {webPreview.data.url}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {webSelectedCharCount.toLocaleString("es-MX")} caracteres seleccionados
                      </span>
                    </div>

                    {webSectionEntries.length === 0 ? (
                      <EmptyState
                        icon={<FileText className="h-6 w-6" />}
                        title="Sin secciones"
                        description="La página no tiene contenido de texto que se pueda guardar."
                      />
                    ) : (
                      <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
                        {webSectionEntries.map(({ section, key, checked }) => {
                          const isLong = section.body.length > 240;
                          const isExpanded = expandedWebSections.has(key);
                          const preview =
                            isLong && !isExpanded ? `${section.body.slice(0, 240)}…` : section.body;
                          const checkboxId = `web-section-${key}`;
                          return (
                            <li key={key} className="rounded-md border bg-background p-2.5">
                              <div className="flex items-start gap-2">
                                <Checkbox
                                  id={checkboxId}
                                  checked={checked}
                                  onChange={(event) =>
                                    setSelectedWebSections((prev) => ({
                                      ...prev,
                                      [key]: event.target.checked,
                                    }))
                                  }
                                  className="mt-0.5"
                                />
                                <div className="min-w-0 flex-1">
                                  <Label htmlFor={checkboxId} className="text-sm font-medium">
                                    {section.heading}
                                  </Label>
                                  <p className="mt-1 whitespace-pre-line break-words text-xs text-muted-foreground">
                                    {preview || "(sin contenido)"}
                                  </p>
                                  {isLong ? (
                                    <button
                                      type="button"
                                      className="mt-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
                                      onClick={() => toggleWebSectionExpanded(key)}
                                    >
                                      {isExpanded ? "Ver menos" : "Ver más"}
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    <Button
                      onClick={() => webSave.mutate()}
                      loading={webSave.isPending}
                      disabled={checkedWebSections.length === 0}
                    >
                      <BookOpen aria-hidden className="h-4 w-4" />
                      Guardar como conocimiento
                    </Button>
                  </div>
                ) : null}
              </div>
            </Section>

            <Section
              as="h3"
              title="Probar una pregunta del negocio"
              description="Consulta el índice tal como lo hace el agente, sin gastar tokens del modelo."
            >
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="knowledge-query">Pregunta</Label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      id="knowledge-query"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="¿Hacen envíos a Monterrey?"
                      aria-describedby="knowledge-query-hint"
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          runSearch();
                        }
                      }}
                    />
                    <Button
                      className="sm:w-auto"
                      onClick={runSearch}
                      loading={search.isPending}
                      disabled={query.trim().length < 2}
                    >
                      <SearchIcon aria-hidden className="h-4 w-4" />
                      Buscar
                    </Button>
                  </div>
                  <p id="knowledge-query-hint" className="text-xs text-muted-foreground">
                    Mínimo dos caracteres. Enter también busca.
                  </p>
                </div>

                {search.isError ? (
                  <Alert variant="destructive">
                    <AlertCircle aria-hidden />
                    <AlertTitle>No pude consultar el conocimiento</AlertTitle>
                    <AlertDescription>
                      El servicio del agente no respondió. Inténtalo de nuevo.
                    </AlertDescription>
                  </Alert>
                ) : search.isPending ? (
                  <SkeletonText lines={4} label="Buscando en el conocimiento…" />
                ) : hits === undefined ? (
                  <EmptyState
                    icon={<SearchIcon className="h-6 w-6" />}
                    title="Sin búsquedas todavía"
                    description="Escribe una pregunta como la haría un cliente y mira qué secciones encuentra el agente."
                  />
                ) : hits.length === 0 ? (
                  <EmptyState
                    icon={<SearchIcon className="h-6 w-6" />}
                    title="Sin resultados"
                    description="Ninguna sección coincide. Es candidata a agregarse al conocimiento del negocio."
                  />
                ) : (
                  <ul className="space-y-2">
                    {hits.map((hit) => (
                      <li key={hit.ref} className="rounded-lg border bg-card p-3 text-sm">
                        <p className="font-mono text-xs text-muted-foreground">
                          {hit.ref} · score{" "}
                          <span className="tabular-nums">{hit.score.toFixed(2)}</span>
                        </p>
                        <p className="mt-1 whitespace-pre-line break-words">
                          {hit.body.slice(0, 400)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Section>

            <Section
              as="h3"
              title="Secciones indexadas"
              description="El índice que consulta el agente, documento por documento."
            >
              {knowledge.isError ? (
                <QueryError
                  title="No pude leer el índice"
                  retrying={knowledge.isFetching}
                  onRetry={() => void knowledge.refetch()}
                />
              ) : knowledge.isLoading ? (
                <SkeletonText lines={6} label="Cargando el índice de secciones…" />
              ) : outline.length === 0 ? (
                <EmptyState
                  icon={<FileText className="h-6 w-6" />}
                  title="Nada indexado"
                  description="Sube un documento Markdown y recarga el conocimiento."
                />
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {outline.map((doc) => (
                    <div key={doc.doc} className="min-w-0 rounded-lg border bg-card p-3">
                      <h4 className="break-all text-sm font-medium">{doc.doc}</h4>
                      <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                        {doc.sections.map((section) => (
                          <li key={section} className="break-words">
                            • {section.split("#")[1] ?? section}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </TabsContent>

          {/* ============== APRENDIZAJE ============== */}
          <TabsContent value="learning" className="space-y-4">
            <Section
              as="h3"
              title="Aprendizaje entre sesiones"
              description="Preguntas que el bot no supo responder o que escaló a un humano. Nunca se agregan solas al conocimiento: cada una espera que alguien escriba la respuesta y la apruebe."
            >
              {learning.isError ? (
                <QueryError
                  title="No pude leer las sugerencias"
                  retrying={learning.isFetching}
                  onRetry={() => void learning.refetch()}
                />
              ) : learning.isLoading ? (
                <SkeletonText lines={5} label="Cargando sugerencias de aprendizaje…" />
              ) : signals.length === 0 ? (
                <EmptyState
                  icon={<GraduationCap className="h-6 w-6" />}
                  title="Sin sugerencias pendientes"
                  description="Se generan cuando un cliente pregunta algo que no está en el conocimiento o cuando el bot escala a un humano."
                />
              ) : (
                <ul className="space-y-3">
                  {signals.map((signal) => {
                    const answerId = `answer-${signal.id}`;
                    const draftAnswer = answerDrafts[signal.id] ?? "";
                    return (
                      <li key={signal.id} className="rounded-lg border bg-card p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge
                                variant={signal.kind === "handoff" ? "warning" : "secondary"}
                              >
                                {signal.kind === "handoff"
                                  ? "Handoff a humano"
                                  : "Sin respuesta"}
                              </Badge>
                              <span className="text-xs text-muted-foreground tabular-nums">
                                {new Date(signal.createdAt * 1000).toLocaleString("es-MX", {
                                  dateStyle: "medium",
                                  timeStyle: "short",
                                })}
                              </span>
                            </div>
                            <p className="break-words text-sm font-medium">{signal.question}</p>
                            {signal.reason ? (
                              <p className="break-words text-xs text-muted-foreground">
                                Motivo: {signal.reason}
                              </p>
                            ) : null}
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                            aria-label={`Descartar la sugerencia "${signal.question}"`}
                            onClick={() => dismissSignal.mutate(signal.id)}
                            disabled={dismissSignal.isPending}
                          >
                            <X aria-hidden className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="mt-3 space-y-1.5">
                          <Label htmlFor={answerId} className="text-xs">
                            Respuesta oficial
                          </Label>
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <Textarea
                              id={answerId}
                              placeholder="Se guarda tal cual como conocimiento del negocio…"
                              value={draftAnswer}
                              onChange={(event) =>
                                setAnswerDrafts((prev) => ({
                                  ...prev,
                                  [signal.id]: event.target.value,
                                }))
                              }
                              className="min-h-[60px] text-sm"
                            />
                            <Button
                              size="sm"
                              className="self-end"
                              disabled={!draftAnswer.trim()}
                              loading={approveSignal.isPending}
                              onClick={() =>
                                approveSignal.mutate({
                                  id: signal.id,
                                  answer: draftAnswer.trim(),
                                })
                              }
                            >
                              <Check aria-hidden className="h-4 w-4" />
                              Aprobar
                            </Button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>
          </TabsContent>

          {/* ============== HERRAMIENTAS ============== */}
          <TabsContent value="tools" className="space-y-4">
            <Section
              as="h3"
              title="Herramientas autorizadas"
              description="Lo que el agente puede ejecutar contra la API comercial."
              padded={false}
            >
              <DataTable
                columns={toolColumns}
                rows={tools.data?.tools}
                isLoading={tools.isLoading}
                isError={tools.isError}
                error={tools.error}
                onRetry={() => void tools.refetch()}
                getRowId={(t) => t.name}
                onRowClick={(t) => setSelectedTool(t)}
                getRowActionLabel={(t) => `Ver detalle de ${t.name}`}
                caption="Herramientas que el agente puede ejecutar, con su scope y su efecto."
                empty={{
                  icon: <Wrench className="h-6 w-6" />,
                  title: "Sin herramientas",
                  description:
                    "El agente no declaró herramientas: solo puede responder con el conocimiento indexado.",
                }}
              />
            </Section>
          </TabsContent>
        </Tabs>
      </div>

      <ConfirmDialog
        open={docToDelete !== null}
        onOpenChange={(open) => !open && setDocToDelete(null)}
        title={`¿Borrar "${docToDelete}"?`}
        description="Se elimina el archivo y su contenido deja de usarse en el conocimiento del agente. No se puede deshacer."
        confirmLabel="Borrar"
        pending={deleteDoc.isPending}
        onConfirm={() => docToDelete && deleteDoc.mutate(docToDelete)}
      />

      <ToolDetailSheet
        tool={selectedTool}
        open={selectedTool !== null}
        onOpenChange={(open) => !open && setSelectedTool(null)}
      />
    </div>
  );
}

/**
 * Detalle de una herramienta autorizada, en panel lateral.
 *
 * `GET /agent/tools` (apps/agent-v2/app/main.py `list_tools`) hoy solo manda
 * name/description/scope/mutating — la descripción ya es la primera línea
 * del docstring de la tool en apps/agent-v2/app/tools.py. No hay parámetros
 * ni "cuándo se usa" en la respuesta, así que el panel no los inventa: se
 * queda en nombre, scope(s), efecto y descripción. Mostrar parámetros reales
 * necesitaría que el backend los exponga (fuera de este cambio).
 */
function ToolDetailSheet({
  tool,
  open,
  onOpenChange,
}: {
  tool: ToolSpec | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        title="Detalle de la herramienta"
        className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg"
      >
        {tool ? (
          <>
            <SheetHeader className="border-b px-6 py-4">
              <SheetTitle className="font-mono text-base">{tool.name}</SheetTitle>
              <SheetDescription>
                {tool.mutating ? "Escribe en la API comercial" : "Solo lee de la API comercial"}
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 space-y-6 px-6 py-4">
              <DescriptionList divided>
                <FieldRow label="Herramienta">
                  <EntityId value={tool.name} length={40} toastLabel="Nombre de la herramienta" />
                </FieldRow>
                <FieldRow label="Scope" mono>
                  {tool.scope}
                </FieldRow>
                <FieldRow label="Efecto">
                  <Badge variant={tool.mutating ? "warning" : "neutral"}>
                    {tool.mutating ? "Escribe" : "Lee"}
                  </Badge>
                </FieldRow>
              </DescriptionList>

              <section aria-labelledby="tool-description-title" className="space-y-2">
                <h3 id="tool-description-title" className="text-sm font-semibold">
                  Qué hace
                </h3>
                <p className="text-sm text-muted-foreground">
                  {tool.description || "El agente no declaró una descripción para esta herramienta."}
                </p>
              </section>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** Franja superior visible en todas las pestañas: estado de salud compacto
 *  (LLM, modelo, conexión a commerce-api). Se ve "el agente responde"
 *  sin tener que abrir la pestaña General. */
function HealthBanner({
  knowledge,
  diagnostics,
}: {
  knowledge: KnowledgeStats | undefined;
  diagnostics: Diagnostics | undefined;
}) {
  const state = useMemo(() => {
    if (!diagnostics) {
      return knowledge ? "ok" : "loading";
    }
    if (!diagnostics.llm?.live) return "fallback";
    return diagnostics.commerce?.ok ? "ok" : "degraded";
  }, [diagnostics, knowledge]);

  const tone =
    state === "ok"
      ? "border-success/30 bg-success-subtle text-success-foreground"
      : state === "fallback"
        ? "border-warning/30 bg-warning-subtle text-warning-foreground"
        : state === "degraded"
          ? "border-warning/30 bg-warning-subtle text-warning-foreground"
          : "border-muted bg-muted text-foreground";

  const label =
    state === "ok"
      ? "Agente en línea"
      : state === "fallback"
        ? "Motor determinista (sin LLM)"
        : state === "degraded"
          ? "Agente sin conexión al catálogo"
          : "Cargando estado…";

  return (
    <div className={`rounded-card border px-4 py-3 ${tone}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-2 font-semibold">
          <span
            aria-hidden
            className={`inline-block h-2 w-2 rounded-full ${
              state === "ok"
                ? "bg-success"
                : state === "fallback"
                  ? "bg-warning"
                  : "bg-muted-foreground"
            }`}
          />
          {label}
        </span>
        {diagnostics?.llm?.model ? (
          <span className="text-xs">
            Modelo:{" "}
            <code className="font-mono">{diagnostics.llm.model}</code>
          </span>
        ) : null}
        {diagnostics?.llm?.promptVersion ? (
          <span className="text-xs">
            Prompt:{" "}
            <code className="font-mono">{diagnostics.llm.promptVersion}</code>
          </span>
        ) : null}
        {knowledge ? (
          <span className="text-xs">
            {knowledge.docs.length} docs ·{" "}
            <span className="tabular-nums">{knowledge.chunks}</span> secciones
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono text-sm" : "text-sm"}>{value}</dd>
    </div>
  );
}