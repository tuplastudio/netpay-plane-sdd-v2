"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { cn } from "@/lib/utils";

const AGENT_BASE = "/agent";

interface AgentSettings {
  agent_name: string;
  business_name: string;
  tone: string;
  greeting: string;
  language: string;
  currency: string;
  emoji: boolean | null;
  sales_style: "cerrador" | "consultivo" | "informativo";
  ask_name_before_quote: boolean;
  ask_email_before_quote: boolean;
  auto_history_lookup: boolean;
  max_products_per_message: number;
  default_delivery_mode: "PICKUP" | "LOCAL_DELIVERY";
  handoff_keywords: string[];
  forbidden_topics: string;
  extra_rules: string;
  text_model: string;
  classifier_model: string;
  temperature: number | null;
  max_tokens: number | null;
  whatsapp_plain_text: boolean;
  auto_reply: boolean;
  updated_at: number;
}

interface SettingsView {
  tenantId: string;
  settings: AgentSettings;
  defaults: Record<string, string | number | boolean | null>;
  options: {
    sales_style: string[];
    default_delivery_mode: string[];
    models: Array<{ id: string; toolCalling: boolean; notes: string }>;
  };
}

const SALES_STYLE_LABEL: Record<string, { label: string; hint: string }> = {
  cerrador: { label: "Cerrador", hint: "Cada mensaje empuja al siguiente paso de compra." },
  consultivo: { label: "Consultivo", hint: "Entiende la necesidad antes de cerrar." },
  informativo: { label: "Informativo", hint: "Responde completo, sin presionar." },
};

export function AgentSettingsForm() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = React.useState<AgentSettings | null>(null);
  const [confirmReset, setConfirmReset] = React.useState(false);

  const me = useQuery({
    queryKey: ["auth-me"],
    queryFn: async (): Promise<{ tenantId: string }> => {
      const res = await fetch("/api/v1/auth/me");
      if (!res.ok) throw new Error("sesión inválida");
      const body = await res.json();
      return body.data ?? body;
    },
  });
  const tenantId = me.data?.tenantId;

  const view = useQuery({
    queryKey: ["agent-settings", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<SettingsView> => {
      const res = await fetch(`${AGENT_BASE}/settings?tenantId=${encodeURIComponent(tenantId!)}`);
      if (!res.ok) throw new Error("agente no disponible");
      return res.json();
    },
  });

  React.useEffect(() => {
    if (view.data) setDraft(view.data.settings);
  }, [view.data]);

  const save = useMutation({
    mutationFn: async (payload: Partial<AgentSettings>) => {
      const res = await fetch(`${AGENT_BASE}/settings?tenantId=${encodeURIComponent(tenantId!)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.detail ?? "no se pudo guardar");
      }
      return res.json() as Promise<SettingsView>;
    },
    onSuccess: (data) => {
      toast.success("Configuración del agente guardada");
      queryClient.setQueryData(["agent-settings", tenantId], data);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const reset = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${AGENT_BASE}/settings?tenantId=${encodeURIComponent(tenantId!)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("no se pudo restablecer");
      return res.json() as Promise<SettingsView>;
    },
    onSuccess: (data) => {
      toast.success("Agente restablecido a valores por defecto");
      setConfirmReset(false);
      queryClient.setQueryData(["agent-settings", tenantId], data);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (view.isLoading || !draft) {
    return (
      <div className="rounded-card border bg-card p-4 text-sm text-muted-foreground">
        Cargando configuración del agente…
      </div>
    );
  }
  if (view.isError) {
    return (
      <div className="rounded-card border border-destructive/30 bg-card p-4 text-sm text-destructive">
        No pude leer la configuración del agente. ¿Está arriba el servicio?
      </div>
    );
  }

  const defaults = view.data!.defaults;
  const models = view.data!.options.models;
  const dirty = JSON.stringify(draft) !== JSON.stringify(view.data!.settings);

  const set = <K extends keyof AgentSettings>(key: K, value: AgentSettings[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    save.mutate(draft);
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Configuración del agente</h2>
          <p className="text-sm text-muted-foreground">
            Identidad, estilo de venta, reglas y modelo. Lo vacío usa el valor de{" "}
            <code className="rounded bg-muted px-1">negocio.md</code> o del entorno.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setConfirmReset(true)}
            disabled={reset.isPending}
          >
            <RotateCcw className="h-4 w-4" />
            Restablecer
          </Button>
          <Button type="submit" disabled={!dirty || save.isPending}>
            <Save className="h-4 w-4" />
            {save.isPending ? "Guardando…" : "Guardar cambios"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Identidad" hint="Cómo se presenta el agente con el cliente.">
          <Field label="Nombre del agente" placeholder={String(defaults.agent_name ?? "")}>
            <Input value={draft.agent_name} onChange={(e) => set("agent_name", e.target.value)} placeholder={String(defaults.agent_name ?? "")} />
          </Field>
          <Field label="Nombre del negocio" placeholder={String(defaults.business_name ?? "")}>
            <Input value={draft.business_name} onChange={(e) => set("business_name", e.target.value)} placeholder={String(defaults.business_name ?? "")} />
          </Field>
          <Field label="Tono" placeholder={String(defaults.tone ?? "")}>
            <Textarea rows={2} value={draft.tone} onChange={(e) => set("tone", e.target.value)} placeholder={String(defaults.tone ?? "")} />
          </Field>
          <Field label="Saludo inicial" placeholder={String(defaults.greeting ?? "")}>
            <Input value={draft.greeting} onChange={(e) => set("greeting", e.target.value)} placeholder={String(defaults.greeting ?? "¡Hola! Soy…")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Idioma" placeholder={String(defaults.language ?? "")}>
              <Input value={draft.language} onChange={(e) => set("language", e.target.value)} placeholder={String(defaults.language ?? "es-MX")} />
            </Field>
            <Field label="Moneda" placeholder={String(defaults.currency ?? "")}>
              <Input value={draft.currency} onChange={(e) => set("currency", e.target.value)} placeholder={String(defaults.currency ?? "MXN")} />
            </Field>
          </div>
          <Toggle
            label="Usar emojis"
            hint="Uno por mensaje como máximo."
            checked={draft.emoji ?? Boolean(defaults.emoji)}
            onChange={(v) => set("emoji", v)}
          />
        </Panel>

        <Panel title="Estilo de venta" hint="Qué tanto empuja al cierre y qué pide antes de cotizar.">
          <div className="grid gap-2 sm:grid-cols-3">
            {view.data!.options.sales_style.map((style) => {
              const meta = SALES_STYLE_LABEL[style] ?? { label: style, hint: "" };
              const active = draft.sales_style === style;
              return (
                <button
                  key={style}
                  type="button"
                  onClick={() => set("sales_style", style as AgentSettings["sales_style"])}
                  className={cn(
                    "rounded-lg border p-3 text-left text-sm transition-colors",
                    active ? "border-primary bg-primary/5" : "hover:bg-muted",
                  )}
                  aria-pressed={active}
                >
                  <span className="block font-medium">{meta.label}</span>
                  <span className="block text-xs text-muted-foreground">{meta.hint}</span>
                </button>
              );
            })}
          </div>
          <Toggle label="Pedir nombre antes de emitir cotización" checked={draft.ask_name_before_quote} onChange={(v) => set("ask_name_before_quote", v)} />
          <Toggle label="Pedir correo antes de emitir cotización" hint="Para enviar el PDF." checked={draft.ask_email_before_quote} onChange={(v) => set("ask_email_before_quote", v)} />
          <Toggle label="Reconocer clientes recurrentes" hint="Busca nombre y correo por teléfono al iniciar." checked={draft.auto_history_lookup} onChange={(v) => set("auto_history_lookup", v)} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Máx. opciones por mensaje">
              <Input type="number" min={1} max={10} value={draft.max_products_per_message} onChange={(e) => set("max_products_per_message", Number(e.target.value) || 3)} />
            </Field>
            <Field label="Entrega por defecto">
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={draft.default_delivery_mode}
                onChange={(e) => set("default_delivery_mode", e.target.value as AgentSettings["default_delivery_mode"])}
              >
                <option value="PICKUP">Recoger en tienda</option>
                <option value="LOCAL_DELIVERY">Entrega local</option>
              </select>
            </Field>
          </div>
        </Panel>

        <Panel title="Reglas del negocio" hint="Instrucciones en lenguaje natural; el agente las obedece por encima de las reglas base.">
          <Field label="Reglas adicionales">
            <Textarea
              rows={5}
              value={draft.extra_rules}
              onChange={(e) => set("extra_rules", e.target.value)}
              placeholder={"Ej.: Nunca ofrezcas envío gratis.\nSi piden factura, pide RFC antes de cotizar."}
            />
          </Field>
          <Field label="Temas que no toca">
            <Textarea rows={2} value={draft.forbidden_topics} onChange={(e) => set("forbidden_topics", e.target.value)} placeholder="Ej.: precios de la competencia, política, salud" />
          </Field>
          <Field label="Palabras que pasan a una persona" hint="Separadas por coma.">
            <Input
              value={draft.handoff_keywords.join(", ")}
              onChange={(e) => set("handoff_keywords", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
              placeholder="abogado, demanda, profeco"
            />
          </Field>
        </Panel>

        <Panel title="Modelo y canal" hint="Cambiar de modelo afecta costo y calidad; el registro marca cuáles soportan herramientas.">
          <Field label="Modelo conversacional" placeholder={String(defaults.text_model ?? "")}>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={draft.text_model}
              onChange={(e) => set("text_model", e.target.value)}
            >
              <option value="">Por defecto ({String(defaults.text_model ?? "")})</option>
              {models.filter((m) => m.toolCalling).map((m) => (
                <option key={m.id} value={m.id}>{m.id}</option>
              ))}
            </select>
          </Field>
          <Field label="Modelo clasificador de intención" placeholder={String(defaults.classifier_model ?? "")}>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={draft.classifier_model}
              onChange={(e) => set("classifier_model", e.target.value)}
            >
              <option value="">Por defecto ({String(defaults.classifier_model ?? "")})</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.id}</option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Temperatura" hint={`Por defecto ${String(defaults.temperature ?? "")}`}>
              <Input type="number" step="0.05" min={0} max={1.5} value={draft.temperature ?? ""} onChange={(e) => set("temperature", e.target.value === "" ? null : Number(e.target.value))} placeholder={String(defaults.temperature ?? "")} />
            </Field>
            <Field label="Máx. tokens por respuesta" hint={`Por defecto ${String(defaults.max_tokens ?? "")}`}>
              <Input type="number" min={64} max={4000} value={draft.max_tokens ?? ""} onChange={(e) => set("max_tokens", e.target.value === "" ? null : Number(e.target.value))} placeholder={String(defaults.max_tokens ?? "")} />
            </Field>
          </div>
          <Toggle label="Formato plano para WhatsApp" hint="Convierte markdown a *negritas* y quita viñetas." checked={draft.whatsapp_plain_text} onChange={(v) => set("whatsapp_plain_text", v)} />
          <Toggle label="Respuesta automática activa" hint="Apagado: el agente registra mensajes pero no contesta." checked={draft.auto_reply} onChange={(v) => set("auto_reply", v)} />
        </Panel>
      </div>

      {draft.updated_at ? (
        <p className="text-xs text-muted-foreground">
          Última actualización: {new Date(draft.updated_at * 1000).toLocaleString("es-MX")}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="¿Restablecer la configuración del agente?"
        description="Se borran todos los ajustes del panel y el agente vuelve a usar negocio.md y las variables de entorno."
        confirmLabel="Restablecer"
        variant="destructive"
        pending={reset.isPending}
        onConfirm={() => reset.mutate()}
      />
    </form>
  );
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-card border bg-card p-4 shadow-airbnb">
      <div>
        <h3 className="font-medium">{title}</h3>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  placeholder: _placeholder,
  children,
}: {
  label: string;
  hint?: string;
  placeholder?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border p-3">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      <span
        role="switch"
        aria-checked={checked}
        tabIndex={0}
        onClick={() => onChange(!checked)}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            onChange(!checked);
          }
        }}
        className={cn(
          "relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-primary" : "bg-border-strong",
        )}
      >
        <span
          className={cn(
            "inline-block h-5 w-5 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-5" : "translate-x-0.5",
          )}
        />
      </span>
    </label>
  );
}
