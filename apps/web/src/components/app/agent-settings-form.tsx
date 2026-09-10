"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CircleHelp, RotateCcw, Save, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioCard, RadioGroup } from "@/components/ui/radio";
import { Select } from "@/components/ui/select";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Section } from "@/components/app/section";
import { DateTime } from "@/components/app/date-time";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { fetchAuthMe } from "@/lib/api";
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
  /** true si el tenant ya guardó su propia OpenRouter key. La key en claro
   * nunca viaja de vuelta: solo este booleano. */
  openrouter_api_key_set: boolean;
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

/**
 * Límites que aplica `agent_settings.py` (`_STR_LIMITS`) al guardar. Se
 * replican como `maxLength` para que el recorte no ocurra en silencio del
 * lado del servidor.
 */
const STR_LIMITS = {
  agent_name: 60,
  business_name: 120,
  tone: 300,
  greeting: 300,
  language: 10,
  currency: 8,
  forbidden_topics: 2000,
  extra_rules: 4000,
} as const;

const SALES_STYLE_LABEL: Record<string, { label: string; hint: string }> = {
  cerrador: { label: "Cerrador", hint: "Cada mensaje empuja al siguiente paso de compra." },
  consultivo: { label: "Consultivo", hint: "Entiende la necesidad antes de cerrar." },
  informativo: { label: "Informativo", hint: "Responde completo, sin presionar." },
};

const DELIVERY_MODE_LABEL: Record<string, string> = {
  PICKUP: "Recoger en tienda",
  LOCAL_DELIVERY: "Entrega local",
};

/** Valores de fábrica del dataclass `AgentSettings` del backend. Son los que
 *  aplica «Restablecer» y los que se muestran como "Predeterminado" en los
 *  campos que no dependen de `negocio.md`. */
const FACTORY = {
  sales_style: "cerrador",
  ask_name_before_quote: true,
  ask_email_before_quote: false,
  auto_history_lookup: true,
  max_products_per_message: 3,
  default_delivery_mode: "PICKUP",
  whatsapp_plain_text: true,
  auto_reply: true,
} as const;

/**
 * Errores de rango de los tres campos numéricos. Son los mismos límites que ya
 * declaraban los `min`/`max` de los inputs (y que el navegador bloqueaba en
 * silencio al enviar): aquí solo se hacen visibles y en español.
 */
function validate(draft: AgentSettings): Partial<Record<keyof AgentSettings, string>> {
  const errors: Partial<Record<keyof AgentSettings, string>> = {};
  const max = draft.max_products_per_message;
  if (!Number.isFinite(max) || max < 1 || max > 10) {
    errors.max_products_per_message = "Debe ser un número entre 1 y 10.";
  }
  if (draft.temperature !== null && (draft.temperature < 0 || draft.temperature > 1.5)) {
    errors.temperature = "Debe estar entre 0 y 1.5.";
  }
  if (draft.max_tokens !== null && (draft.max_tokens < 64 || draft.max_tokens > 4000)) {
    errors.max_tokens = "Debe estar entre 64 y 4000.";
  }
  return errors;
}

/** Misma regla que `sanitize()` del backend: coma o salto de línea separan,
 *  se recorta y se pasa a minúsculas, máximo 30 palabras de 60 caracteres. */
function parseHandoffKeywords(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((s) => s.trim().toLowerCase().slice(0, 60))
    .filter(Boolean)
    .slice(0, 30);
}

/** Texto del valor por defecto de un campo: lo que trae `defaults` (negocio.md
 *  o entorno) si lo declara, o "" si tampoco. */
function defaultOf(defaults: SettingsView["defaults"], key: string): string {
  const value = defaults[key];
  if (value === null || value === undefined || value === "") return "";
  return String(value);
}

export function AgentSettingsForm({ tenantIdOverride }: { tenantIdOverride?: string }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = React.useState<AgentSettings | null>(null);
  const [confirmReset, setConfirmReset] = React.useState(false);
  // Write-only: la key en claro nunca llega en la respuesta del servidor, así
  // que vive fuera de `draft` (que sí se compara contra lo guardado para
  // saber si hay cambios pendientes).
  const [openrouterKeyDraft, setOpenrouterKeyDraft] = React.useState("");
  // «Quitar key»: manda `openrouter_api_key: ""` explícitamente, que es lo que
  // el backend interpreta como borrar. Omitir el campo conserva la guardada.
  const [removeOpenrouterKey, setRemoveOpenrouterKey] = React.useState(false);
  // Texto crudo del campo de palabras de escalamiento. Se parsea a lista en
  // `draft`, pero el input muestra lo que el usuario teclea: si se
  // re-generara desde la lista en cada pulsación, una coma al final
  // desaparecería antes de poder escribir la siguiente palabra.
  const [handoffText, setHandoffText] = React.useState("");

  /**
   * Tenant de la sesión, con la misma consulta compartida `["auth-me"]` y el
   * mismo `fetchAuthMe()` que usa la consola de chat. El agente particiona sus
   * ajustes y sus conversaciones por esta cadena, así que las dos pantallas
   * tienen que mandarle exactamente la misma: si el panel guardara bajo una
   * clave y el chat conversara bajo otra, la configuración no aplicaría a los
   * hilos que debe gobernar.
   *
   * La UUID es la clave canónica: WhatsApp ya la usa y Commerce API deriva sus
   * permisos de ella. Usar el slug aquí creaba un segundo bucket de ajustes y
   * conocimiento para la misma empresa.
   *
   * En modo super-admin (`tenantIdOverride`) la sesión del visitante no es el
   * tenant destino; el proxy server-side valida que sí sea super-admin antes
   * de aceptar el override.
   */
  const me = useQuery({
    queryKey: ["auth-me"],
    queryFn: fetchAuthMe,
    // Un 401 es la respuesta, no un fallo de red: reintentarlo no cambia nada.
    retry: false,
    // Si el llamador ya conoce el tenant (panel super-admin) no hace falta
    // pedir la sesión: ahorra una consulta y evita estados de carga falsos.
    enabled: !tenantIdOverride,
  });
  const tenantId = tenantIdOverride ?? me.data?.tenantId ?? null;
  const tenantResolving = !tenantIdOverride && me.isPending;
  // Solo "no tenemos comercio" cuando no hay override Y la sesión tampoco lo
  // trae: con override el llamador ya garantiza el tenant.
  const tenantFailed = !tenantIdOverride && !tenantResolving && !tenantId;

  const view = useQuery({
    queryKey: ["agent-settings", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<SettingsView> => {
      if (!tenantId) throw new Error("sin comercio identificado");
      const res = await fetch(`${AGENT_BASE}/settings?tenantId=${encodeURIComponent(tenantId)}`);
      if (!res.ok) throw new Error("agente no disponible");
      return res.json();
    },
  });

  React.useEffect(() => {
    if (view.data) {
      setDraft(view.data.settings);
      setHandoffText(view.data.settings.handoff_keywords.join(", "));
    }
  }, [view.data]);

  const save = useMutation({
    mutationFn: async (payload: Partial<AgentSettings> & { openrouter_api_key?: string }) => {
      // Sin tenant resuelto no se guarda: escribiría los ajustes de otro
      // comercio. La UI ya bloquea este camino; esto lo cierra de todos modos.
      if (!tenantId) throw new Error("Sin comercio identificado");
      const res = await fetch(`${AGENT_BASE}/settings?tenantId=${encodeURIComponent(tenantId)}`, {
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
      setOpenrouterKeyDraft("");
      setRemoveOpenrouterKey(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const reset = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("Sin comercio identificado");
      const res = await fetch(`${AGENT_BASE}/settings?tenantId=${encodeURIComponent(tenantId)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("no se pudo restablecer");
      return res.json() as Promise<SettingsView>;
    },
    onSuccess: (data) => {
      toast.success("Agente restablecido a valores por defecto");
      setConfirmReset(false);
      setOpenrouterKeyDraft("");
      setRemoveOpenrouterKey(false);
      queryClient.setQueryData(["agent-settings", tenantId], data);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Precede al error del agente: sin tenant la consulta de ajustes ni siquiera
  // corre, así que este es el estado que hay que explicar.
  if (tenantFailed) {
    return (
      <Alert variant="destructive">
        <AlertCircle aria-hidden />
        <AlertTitle>No pudimos identificar tu comercio</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>
            La configuración se guarda por comercio, así que no se puede abrir
            sin saber a cuál pertenece tu sesión. Vuelve a intentar; si sigue
            igual, inicia sesión de nuevo.
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
    );
  }

  if (view.isError) {
    return (
      <Alert variant="destructive">
        <AlertCircle aria-hidden />
        <AlertTitle>No pude leer la configuración del agente</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>El servicio del agente no respondió. Revisa que esté arriba y vuelve a intentar.</p>
          <Button
            variant="outline"
            size="sm"
            loading={view.isFetching}
            onClick={() => void view.refetch()}
          >
            Reintentar
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  // Mientras el tenant se resuelve no se pinta el formulario: un control
  // editable aquí guardaría contra un comercio adivinado.
  if (tenantResolving || view.isLoading || !draft) {
    return (
      <SkeletonRegion
        label="Cargando la configuración del agente…"
        className="grid gap-4 lg:grid-cols-2"
      >
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-3 rounded-card border bg-card p-4 sm:p-6">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ))}
      </SkeletonRegion>
    );
  }

  const defaults = view.data!.defaults;
  const models = view.data!.options.models;
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(view.data!.settings) ||
    openrouterKeyDraft !== "" ||
    removeOpenrouterKey;
  const errors = validate(draft);
  const hasErrors = Object.keys(errors).length > 0;

  const set = <K extends keyof AgentSettings>(key: K, value: AgentSettings[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    // `openrouter_api_key` solo viaja cuando el usuario decidió algo: una key
    // nueva la reemplaza, "" la borra, ausente conserva la guardada.
    const keyPayload = removeOpenrouterKey
      ? { openrouter_api_key: "" }
      : openrouterKeyDraft.trim()
        ? { openrouter_api_key: openrouterKeyDraft.trim() }
        : {};
    save.mutate({ ...draft, ...keyPayload });
  }

  // Valores efectivos de negocio.md para mostrarlos como "Predeterminado" y
  // como placeholder. Si negocio.md tampoco los declara, un ejemplo.
  const d = {
    agent_name: defaultOf(defaults, "agent_name"),
    business_name: defaultOf(defaults, "business_name"),
    tone: defaultOf(defaults, "tone"),
    greeting: defaultOf(defaults, "greeting"),
    language: defaultOf(defaults, "language"),
    currency: defaultOf(defaults, "currency"),
    text_model: defaultOf(defaults, "text_model"),
    classifier_model: defaultOf(defaults, "classifier_model"),
    temperature: defaultOf(defaults, "temperature"),
    max_tokens: defaultOf(defaults, "max_tokens"),
  };
  const emojiDefault =
    defaults.emoji === null || defaults.emoji === undefined
      ? null
      : Boolean(defaults.emoji);

  const textModelNotes = models.find((m) => m.id === draft.text_model)?.notes;

  return (
    <form onSubmit={submit} noValidate className="space-y-6" aria-busy={save.isPending || undefined}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h2 className="text-base font-semibold tracking-tight">Configuración del agente</h2>
          <p className="text-sm text-muted-foreground">
            Identidad, estilo de venta, reglas y modelo. Lo que dejes vacío usa el valor de{" "}
            <code className="rounded bg-muted px-1 font-mono text-xs">negocio.md</code> o del
            entorno; cada campo muestra cuál es. Pasa el cursor por{" "}
            <CircleHelp aria-hidden className="inline h-3.5 w-3.5 align-text-bottom" /> para ver
            en qué se usa.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setConfirmReset(true)}
            loading={reset.isPending}
          >
            <RotateCcw aria-hidden className="h-4 w-4" />
            Restablecer todo
          </Button>
          <Button type="submit" disabled={!dirty || hasErrors} loading={save.isPending}>
            <Save aria-hidden className="h-4 w-4" />
            {save.isPending ? "Guardando…" : "Guardar cambios"}
          </Button>
        </div>
      </div>

      {hasErrors ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertTitle>Revisa los campos marcados</AlertTitle>
          <AlertDescription>
            Hay valores fuera de rango. Corrígelos para poder guardar.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        {/* ============== IDENTIDAD ============== */}
        <Section
          as="h3"
          title="Identidad"
          description="Cómo se presenta el agente. Todo lo vacío se toma del frontmatter de negocio.md."
          contentClassName="space-y-4"
        >
          <Field
            id="agent_name"
            label="Nombre del agente"
            tip="Nombre con el que el agente se presenta y firma sus mensajes en chat y WhatsApp."
            hint={emptyHint(d.agent_name)}
            defaultLabel={d.agent_name || undefined}
            overridden={draft.agent_name !== ""}
            onReset={() => set("agent_name", "")}
          >
            {(aria) => (
              <Input
                {...aria}
                value={draft.agent_name}
                maxLength={STR_LIMITS.agent_name}
                onChange={(e) => set("agent_name", e.target.value)}
                placeholder={d.agent_name || "Ej.: Sofía"}
              />
            )}
          </Field>

          <Field
            id="business_name"
            label="Nombre del negocio"
            tip="Nombre comercial que el agente menciona al presentarse y al cotizar."
            hint={emptyHint(d.business_name)}
            defaultLabel={d.business_name || undefined}
            overridden={draft.business_name !== ""}
            onReset={() => set("business_name", "")}
          >
            {(aria) => (
              <Input
                {...aria}
                value={draft.business_name}
                maxLength={STR_LIMITS.business_name}
                onChange={(e) => set("business_name", e.target.value)}
                placeholder={d.business_name || "Nombre de tu negocio"}
              />
            )}
          </Field>

          <Field
            id="tone"
            label="Tono"
            tip="Se inyecta tal cual en el prompt como «Tono: …». Define cómo suena el agente, no qué puede hacer."
            hint={emptyHint(d.tone, "Ej.: cercano, breve, sin tecnicismos.")}
            defaultLabel={d.tone || undefined}
            overridden={draft.tone !== ""}
            onReset={() => set("tone", "")}
          >
            {(aria) => (
              <Textarea
                {...aria}
                rows={2}
                value={draft.tone}
                maxLength={STR_LIMITS.tone}
                onChange={(e) => set("tone", e.target.value)}
                placeholder={d.tone || "Cercano y directo, tutea al cliente"}
              />
            )}
          </Field>

          <Field
            id="greeting"
            label="Saludo inicial"
            tip="Se sugiere al modelo solo para el primer mensaje de cada conversación."
            hint={emptyHint(d.greeting, "Sin saludo definido, el agente improvisa uno con su nombre.")}
            defaultLabel={d.greeting || undefined}
            overridden={draft.greeting !== ""}
            onReset={() => set("greeting", "")}
          >
            {(aria) => (
              <Input
                {...aria}
                value={draft.greeting}
                maxLength={STR_LIMITS.greeting}
                onChange={(e) => set("greeting", e.target.value)}
                placeholder={d.greeting || "¡Hola! Soy Sofía, ¿qué estás buscando hoy?"}
              />
            )}
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              id="language"
              label="Idioma"
              tip="Idioma en el que el agente atiende («Atiendes clientes en …»). Código corto: es, es-MX, en."
              hint={emptyHint(d.language, "Vacío = español.")}
              defaultLabel={d.language || undefined}
              overridden={draft.language !== ""}
              onReset={() => set("language", "")}
            >
              {(aria) => (
                <Input
                  {...aria}
                  value={draft.language}
                  maxLength={STR_LIMITS.language}
                  onChange={(e) => set("language", e.target.value)}
                  placeholder={d.language || "es"}
                />
              )}
            </Field>
            <Field
              id="currency"
              label="Moneda"
              tip="Moneda en la que el agente expresa importes y cotizaciones. Código ISO de 3 letras."
              hint={emptyHint(d.currency, "Vacío = MXN.")}
              defaultLabel={d.currency || undefined}
              overridden={draft.currency !== ""}
              onReset={() => set("currency", "")}
            >
              {(aria) => (
                <Input
                  {...aria}
                  value={draft.currency}
                  maxLength={STR_LIMITS.currency}
                  onChange={(e) => set("currency", e.target.value)}
                  placeholder={d.currency || "MXN"}
                />
              )}
            </Field>
          </div>

          <Toggle
            id="emoji"
            label="Usar emojis"
            tip="Apagado agrega «No uses emojis» al prompt. Encendido permite uno por mensaje como máximo."
            hint="Uno por mensaje como máximo."
            checked={draft.emoji ?? emojiDefault ?? true}
            onChange={(v) => set("emoji", v)}
            defaultLabel={
              emojiDefault === null ? "según negocio.md" : emojiDefault ? "activado" : "desactivado"
            }
            overridden={draft.emoji !== null}
            onReset={() => set("emoji", null)}
          />
        </Section>

        {/* ============== COMPORTAMIENTO COMERCIAL ============== */}
        <Section
          as="h3"
          title="Comportamiento comercial"
          description="Qué tanto empuja al cierre, qué pide antes de cotizar y cómo lista productos."
          contentClassName="space-y-4"
        >
          {/* Radios nativos agrupados, ahora con la primitiva del DS en vez de
              la copia a mano: mismo comportamiento de teclado, una sola fuente
              de estilos. */}
          <RadioGroup
            legend={
              <span className="inline-flex items-center gap-1.5">
                Estilo de venta
                <InfoTip
                  label="Estilo de venta"
                  text="Cerrador: cada mensaje propone el siguiente paso de compra. Consultivo: pregunta y entiende antes de recomendar. Informativo: responde completo y no presiona."
                />
              </span>
            }
            name="sales_style"
            description={`Cambia el tono de cada respuesta, no lo que el agente puede hacer. Predeterminado: ${SALES_STYLE_LABEL[FACTORY.sales_style]?.label ?? FACTORY.sales_style}.`}
            optionsClassName="grid gap-2 sm:grid-cols-3"
          >
            {view.data!.options.sales_style.map((style) => {
              const meta = SALES_STYLE_LABEL[style] ?? { label: style, hint: "" };
              return (
                <RadioCard
                  key={style}
                  value={style}
                  label={meta.label}
                  description={meta.hint}
                  checked={draft.sales_style === style}
                  onChange={() => set("sales_style", style as AgentSettings["sales_style"])}
                />
              );
            })}
          </RadioGroup>

          <Toggle
            id="ask_name_before_quote"
            label="Pedir nombre antes de cotizar"
            tip="Apagado: si no tiene el nombre, cotiza como «Cliente de WhatsApp» y sigue adelante."
            hint="Encendido: no emite la cotización hasta tener el nombre del cliente."
            checked={draft.ask_name_before_quote}
            onChange={(v) => set("ask_name_before_quote", v)}
            defaultLabel={FACTORY.ask_name_before_quote ? "activado" : "desactivado"}
          />
          <Toggle
            id="ask_email_before_quote"
            label="Pedir correo antes de cotizar"
            tip="Pide el correo una sola vez antes de cotizar, para enviar el PDF, y lo guarda en la ficha del cliente."
            hint="Para enviar el PDF de la cotización."
            checked={draft.ask_email_before_quote}
            onChange={(v) => set("ask_email_before_quote", v)}
            defaultLabel={FACTORY.ask_email_before_quote ? "activado" : "desactivado"}
          />
          <Toggle
            id="auto_history_lookup"
            label="Reconocer clientes recurrentes"
            tip="Busca pedidos y cotizaciones previas del cliente por su teléfono al iniciar la conversación."
            hint="Recupera nombre y correo por teléfono para no volver a pedirlos."
            checked={draft.auto_history_lookup}
            onChange={(v) => set("auto_history_lookup", v)}
            defaultLabel={FACTORY.auto_history_lookup ? "activado" : "desactivado"}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              id="max_products_per_message"
              label="Máx. opciones por mensaje"
              tip="Cuántos productos lista por respuesta antes de ofrecer ver más. Menos = mensajes más cortos en WhatsApp."
              hint="Entre 1 y 10."
              error={errors.max_products_per_message}
              defaultLabel={String(FACTORY.max_products_per_message)}
              overridden={draft.max_products_per_message !== FACTORY.max_products_per_message}
              onReset={() => set("max_products_per_message", FACTORY.max_products_per_message)}
            >
              {(aria) => (
                <Input
                  {...aria}
                  type="number"
                  min={1}
                  max={10}
                  className="tabular-nums"
                  value={draft.max_products_per_message}
                  onChange={(e) =>
                    set(
                      "max_products_per_message",
                      Number(e.target.value) || FACTORY.max_products_per_message,
                    )
                  }
                  placeholder={String(FACTORY.max_products_per_message)}
                />
              )}
            </Field>
            <Field
              id="default_delivery_mode"
              label="Entrega por defecto"
              tip="Modo de entrega que asume al calcular totales y generar el enlace de pago si el cliente no dice otra cosa."
              hint="Se usa cuando el cliente no la especifica."
              defaultLabel={DELIVERY_MODE_LABEL[FACTORY.default_delivery_mode]}
              overridden={draft.default_delivery_mode !== FACTORY.default_delivery_mode}
              onReset={() => set("default_delivery_mode", FACTORY.default_delivery_mode)}
            >
              {(aria) => (
                <Select
                  {...aria}
                  value={draft.default_delivery_mode}
                  onChange={(e) =>
                    set(
                      "default_delivery_mode",
                      e.target.value as AgentSettings["default_delivery_mode"],
                    )
                  }
                >
                  {view.data!.options.default_delivery_mode.map((mode) => (
                    <option key={mode} value={mode}>
                      {DELIVERY_MODE_LABEL[mode] ?? mode}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </Section>

        {/* ============== REGLAS DEL NEGOCIO ============== */}
        <Section
          as="h3"
          title="Reglas del negocio"
          description="Instrucciones en lenguaje natural. Vacías no agregan nada al prompt."
          contentClassName="space-y-4"
        >
          <Field
            id="extra_rules"
            label="Reglas adicionales"
            tip="Se agregan al prompt como «Reglas adicionales del negocio», con prioridad sobre las reglas base."
            hint={`Una por renglón. Se mandan tal cual al modelo. Máximo ${STR_LIMITS.extra_rules.toLocaleString("es-MX")} caracteres.`}
            defaultLabel="sin reglas extra"
            overridden={draft.extra_rules !== ""}
            onReset={() => set("extra_rules", "")}
          >
            {(aria) => (
              <Textarea
                {...aria}
                rows={5}
                value={draft.extra_rules}
                maxLength={STR_LIMITS.extra_rules}
                onChange={(e) => set("extra_rules", e.target.value)}
                placeholder={
                  "Ej.: Nunca ofrezcas envío gratis.\nSi piden factura, pide RFC antes de cotizar.\nNo prometas fechas de entrega exactas."
                }
              />
            )}
          </Field>
          <Field
            id="forbidden_topics"
            label="Temas que no toca"
            tip="El agente responde que no puede ayudar con eso y ofrece pasar a una persona. También refuerza el guardarraíl de tema."
            hint={`Separados por coma. Máximo ${STR_LIMITS.forbidden_topics.toLocaleString("es-MX")} caracteres.`}
            defaultLabel="ninguno"
            overridden={draft.forbidden_topics !== ""}
            onReset={() => set("forbidden_topics", "")}
          >
            {(aria) => (
              <Textarea
                {...aria}
                rows={2}
                value={draft.forbidden_topics}
                maxLength={STR_LIMITS.forbidden_topics}
                onChange={(e) => set("forbidden_topics", e.target.value)}
                placeholder="Ej.: precios de la competencia, política, temas de salud"
              />
            )}
          </Field>
          <Field
            id="handoff_keywords"
            label="Palabras que pasan a una persona"
            tip="Si el cliente menciona cualquiera de estas palabras, el agente transfiere la conversación a una persona sin discutir."
            hint="Separadas por coma. Hasta 30 palabras de 60 caracteres; se guardan en minúsculas."
            defaultLabel="ninguna"
            overridden={draft.handoff_keywords.length > 0}
            onReset={() => {
              set("handoff_keywords", []);
              setHandoffText("");
            }}
          >
            {(aria) => (
              <Input
                {...aria}
                value={handoffText}
                onChange={(e) => {
                  setHandoffText(e.target.value);
                  set("handoff_keywords", parseHandoffKeywords(e.target.value));
                }}
                onBlur={() => setHandoffText(draft.handoff_keywords.join(", "))}
                placeholder="humano, asesor, persona"
              />
            )}
          </Field>
        </Section>

        {/* ============== MODELO ============== */}
        <Section
          as="h3"
          title="Modelo"
          description="Cambiar de modelo afecta costo y calidad; el registro marca cuáles soportan herramientas."
          contentClassName="space-y-4"
        >
          <Field
            id="text_model"
            label="Modelo conversacional"
            tip="Modelo de OpenRouter que redacta las respuestas y ejecuta las herramientas (catálogo, cotización, pago)."
            hint={textModelNotes || "Solo se listan modelos con soporte de herramientas."}
            defaultLabel={d.text_model || undefined}
            overridden={draft.text_model !== ""}
            onReset={() => set("text_model", "")}
          >
            {(aria) => (
              <Select
                {...aria}
                value={draft.text_model}
                onChange={(e) => set("text_model", e.target.value)}
              >
                <option value="">
                  {d.text_model ? `Predeterminado (${d.text_model})` : "Predeterminado del entorno"}
                </option>
                {models
                  .filter((m) => m.toolCalling)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id}
                    </option>
                  ))}
              </Select>
            )}
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              id="temperature"
              label="Temperatura"
              tip="Creatividad del modelo. Bajo = respuestas más predecibles y repetibles; alto = más variación."
              hint="Entre 0 y 1.5."
              error={errors.temperature}
              defaultLabel={d.temperature || undefined}
              overridden={draft.temperature !== null}
              onReset={() => set("temperature", null)}
            >
              {(aria) => (
                <Input
                  {...aria}
                  type="number"
                  step="0.05"
                  min={0}
                  max={1.5}
                  className="tabular-nums"
                  value={draft.temperature ?? ""}
                  onChange={(e) =>
                    set("temperature", e.target.value === "" ? null : Number(e.target.value))
                  }
                  placeholder={d.temperature || "0.55"}
                />
              )}
            </Field>
            <Field
              id="max_tokens"
              label="Máx. tokens por respuesta"
              tip="Tope de longitud de cada respuesta. Más tokens = respuestas más largas y más costo por mensaje."
              hint="Entre 64 y 4000."
              error={errors.max_tokens}
              defaultLabel={d.max_tokens || undefined}
              overridden={draft.max_tokens !== null}
              onReset={() => set("max_tokens", null)}
            >
              {(aria) => (
                <Input
                  {...aria}
                  type="number"
                  min={64}
                  max={4000}
                  className="tabular-nums"
                  value={draft.max_tokens ?? ""}
                  onChange={(e) =>
                    set("max_tokens", e.target.value === "" ? null : Number(e.target.value))
                  }
                  placeholder={d.max_tokens || "700"}
                />
              )}
            </Field>
          </div>

          <Field
            id="openrouter_api_key"
            label={
              <span className="inline-flex flex-wrap items-center gap-2">
                OpenRouter API key propia
                {draft.openrouter_api_key_set && !removeOpenrouterKey ? (
                  <Badge variant="success" size="sm">
                    Configurada
                  </Badge>
                ) : removeOpenrouterKey ? (
                  <Badge variant="warning" size="sm">
                    Se quitará al guardar
                  </Badge>
                ) : (
                  <Badge variant="neutral" size="sm">
                    Usa la de la plataforma
                  </Badge>
                )}
              </span>
            }
            tipLabel="OpenRouter API key propia"
            tip="Con tu propia key, el consumo del modelo se cobra a tu cuenta de OpenRouter en vez de a la compartida. Nunca se muestra después de guardarla."
            hint={
              removeOpenrouterKey
                ? "Al guardar, el agente volverá a usar la key compartida de la plataforma."
                : draft.openrouter_api_key_set
                  ? "Ya tienes una guardada. Escribe una nueva para reemplazarla, o deja el campo vacío para conservarla."
                  : "Opcional: sin esto, el agente usa la key compartida de la plataforma."
            }
          >
            {(aria) => (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  {...aria}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={openrouterKeyDraft}
                  disabled={removeOpenrouterKey}
                  onChange={(e) => {
                    setOpenrouterKeyDraft(e.target.value);
                    if (e.target.value) setRemoveOpenrouterKey(false);
                  }}
                  placeholder={draft.openrouter_api_key_set ? "•••••••• (guardada)" : "sk-or-v1-…"}
                />
                {draft.openrouter_api_key_set ? (
                  removeOpenrouterKey ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="sm:w-auto"
                      onClick={() => setRemoveOpenrouterKey(false)}
                    >
                      <Undo2 aria-hidden className="h-4 w-4" />
                      Conservar key
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      className="sm:w-auto"
                      onClick={() => {
                        setOpenrouterKeyDraft("");
                        setRemoveOpenrouterKey(true);
                      }}
                    >
                      <Trash2 aria-hidden className="h-4 w-4" />
                      Quitar key
                    </Button>
                  )
                ) : null}
              </div>
            )}
          </Field>
        </Section>

        {/* ============== CANAL / WHATSAPP ============== */}
        <Section
          as="h3"
          title="Canal y WhatsApp"
          description="Cómo se entregan las respuestas por WhatsApp."
          contentClassName="space-y-4"
        >
          <Toggle
            id="whatsapp_plain_text"
            label="Formato plano para WhatsApp"
            tip="Sin markdown ni encabezados: WhatsApp no los renderiza igual que el chat web. Convierte negritas a *negritas* y quita viñetas."
            hint="Recomendado si el canal principal es WhatsApp."
            checked={draft.whatsapp_plain_text}
            onChange={(v) => set("whatsapp_plain_text", v)}
            defaultLabel={FACTORY.whatsapp_plain_text ? "activado" : "desactivado"}
          />
          <Toggle
            id="auto_reply"
            label="Respuesta automática activa"
            tip="Si se apaga, el agente registra el mensaje entrante pero no contesta: útil para pausarlo sin perder historial."
            hint="Apagado: los mensajes se guardan y una persona los atiende."
            checked={draft.auto_reply}
            onChange={(v) => set("auto_reply", v)}
            defaultLabel={FACTORY.auto_reply ? "activado" : "desactivado"}
          />
        </Section>

        {/* ============== AVANZADO ============== */}
        <Section
          as="h3"
          title="Avanzado"
          description="Campos que se conservan por compatibilidad. No hace falta tocarlos."
          contentClassName="space-y-4"
        >
          <Field
            id="classifier_model"
            label={
              <span className="inline-flex flex-wrap items-center gap-2">
                Modelo clasificador de intención
                <Badge variant="neutral" size="sm">
                  Sin uso en esta versión
                </Badge>
              </span>
            }
            tipLabel="Modelo clasificador de intención"
            tip="En la versión anterior etiquetaba la intención antes de responder. Esta versión no tiene ese paso: el valor se guarda pero no se lee."
            hint="Se guarda por compatibilidad de esquema; no afecta las respuestas."
            defaultLabel={d.classifier_model || undefined}
            overridden={draft.classifier_model !== ""}
            onReset={() => set("classifier_model", "")}
          >
            {(aria) => (
              <Select
                {...aria}
                value={draft.classifier_model}
                onChange={(e) => set("classifier_model", e.target.value)}
              >
                <option value="">
                  {d.classifier_model
                    ? `Predeterminado (${d.classifier_model})`
                    : "Predeterminado del entorno"}
                </option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </Section>
      </div>

      {draft.updated_at ? (
        <p className="text-xs text-muted-foreground">
          Última actualización: <DateTime value={draft.updated_at * 1000} />
        </p>
      ) : null}

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="¿Restablecer la configuración del agente?"
        description="Se borran todos los ajustes del panel (incluida tu OpenRouter key, si la hay) y el agente vuelve a usar negocio.md y las variables de entorno."
        confirmLabel="Restablecer"
        variant="destructive"
        pending={reset.isPending}
        onConfirm={() => reset.mutate()}
      />
    </form>
  );
}

/** Ayuda estándar de los campos de identidad: qué pasa si se deja vacío. */
function emptyHint(defaultValue: string, fallback?: string): string {
  if (defaultValue) return `Vacío = usa «${defaultValue}» de negocio.md.`;
  return fallback ?? "Vacío = usa lo que declare negocio.md.";
}

/**
 * Ícono de ayuda junto a una etiqueta. Es un botón real para que reciba foco
 * de teclado: Radix abre el tooltip al enfocar, no solo al pasar el cursor.
 * Va como hermano del `<label>`, no dentro, para que un clic en el ícono no
 * enfoque el control ni active el checkbox.
 */
function InfoTip({ label, text }: { label: string; text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`Qué hace «${label}»`}
          className={cn(
            "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground",
            "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1",
          )}
        >
          <CircleHelp aria-hidden className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[18rem] text-pretty">{text}</TooltipContent>
    </Tooltip>
  );
}

/** Renglón "Predeterminado: X" con el atajo para volver a ese valor. */
function DefaultMeta({
  defaultLabel,
  overridden,
  onReset,
  resetLabel,
}: {
  defaultLabel?: string;
  overridden?: boolean;
  onReset?: () => void;
  resetLabel: string;
}) {
  if (!defaultLabel) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-[11px] text-muted-foreground">
        Predeterminado:{" "}
        <span className="break-all font-mono text-foreground/80">{defaultLabel}</span>
      </span>
      {overridden && onReset ? (
        <button
          type="button"
          onClick={onReset}
          aria-label={resetLabel}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1"
        >
          <Undo2 aria-hidden className="h-3 w-3" />
          Usar predeterminado
        </button>
      ) : null}
    </div>
  );
}

interface FieldAria {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
}

/**
 * Par etiqueta/control con `htmlFor` real, ayuda enlazada por `aria-describedby`
 * y `aria-invalid` cuando hay error. El control se recibe como función para que
 * los ids salgan de un solo lugar y no se puedan desincronizar.
 *
 * `tip` pinta el ícono de ayuda; `defaultLabel`/`overridden`/`onReset` el
 * renglón "Predeterminado: X · Usar predeterminado".
 */
function Field({
  id,
  label,
  tipLabel,
  tip,
  hint,
  error,
  defaultLabel,
  overridden,
  onReset,
  children,
}: {
  id: string;
  label: React.ReactNode;
  /** Nombre en texto plano para los `aria-label`; obligatorio si `label` no es string. */
  tipLabel?: string;
  tip?: string;
  hint?: React.ReactNode;
  error?: string;
  defaultLabel?: string;
  overridden?: boolean;
  onReset?: () => void;
  children: (aria: FieldAria) => React.ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  const plainLabel = tipLabel ?? (typeof label === "string" ? label : id.replace(/_/g, " "));
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        {tip ? <InfoTip label={plainLabel} text={tip} /> : null}
      </div>
      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })}
      {error ? (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <DefaultMeta
        defaultLabel={defaultLabel}
        overridden={overridden}
        onReset={onReset}
        resetLabel={`Usar el valor predeterminado en ${plainLabel}`}
      />
    </div>
  );
}

function Toggle({
  id,
  label,
  tip,
  hint,
  checked,
  onChange,
  defaultLabel,
  overridden,
  onReset,
}: {
  id: string;
  label: string;
  tip?: string;
  hint?: React.ReactNode;
  checked: boolean;
  onChange: (value: boolean) => void;
  defaultLabel?: string;
  overridden?: boolean;
  onReset?: () => void;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="flex items-start gap-3 rounded-lg border p-3">
      <Checkbox
        id={id}
        className="mt-0.5"
        checked={checked}
        aria-describedby={hintId}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-1.5">
          <Label htmlFor={id} className="cursor-pointer">
            {label}
          </Label>
          {tip ? <InfoTip label={label} text={tip} /> : null}
        </div>
        {hint ? (
          <p id={hintId} className="text-xs text-muted-foreground">
            {hint}
          </p>
        ) : null}
        <DefaultMeta
          defaultLabel={defaultLabel}
          overridden={overridden}
          onReset={onReset}
          resetLabel={`Usar el valor predeterminado en ${label}`}
        />
      </div>
    </div>
  );
}
