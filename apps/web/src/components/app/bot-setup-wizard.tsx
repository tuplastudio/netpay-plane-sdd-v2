"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SkeletonText } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/**
 * Asistente modal que genera la configuración inicial del bot a partir de una
 * descripción en español. Dos pasos:
 *
 *  1. Describir — el dueño escribe en lenguaje libre lo que sabe de su
 *     negocio (giro, horario, políticas, lo que debe y no debe decir el bot).
 *  2. Revisar — el backend (`POST /agent/setup/draft`) devuelve un borrador
 *     con `negocio.md` + un parche de `AgentSettings`. El dueño lo lee, lo
 *     edita si quiere, y aplica.
 *
 * El draft NO se persiste hasta que el dueño pulsa "Aplicar". Hasta entonces
 * solo vive en memoria del modal. Esto evita generar `.md` basura cada vez que
 * alguien abre el wizard y se arrepiente.
 */

const AGENT_BASE = "/agent";

interface WizardAgentSettings {
  agent_name?: string;
  business_name?: string;
  tone?: string;
  greeting?: string;
  emoji?: boolean | null;
  sales_style?: string;
  extra_rules?: string;
  forbidden_topics?: string;
  handoff_keywords?: string[];
}

interface WizardDraft {
  summary: string;
  negocio_md: string;
  agent_settings: WizardAgentSettings;
}

const EXAMPLE_PROMPTS: Array<{ label: string; text: string }> = [
  {
    label: "Papelería",
    text:
      "Tengo una papelería llamada 'La pluma de oro' en Guadalajara. " +
      "Abrimos de lunes a sábado de 8am a 7pm. Vendemos papelería, copias, " +
      "impresiones y regalos. Hacemos envíos a todo México. Aceptamos efectivo, " +
      "transferencia y tarjeta. NO hacemos facturas. Quiero que el bot suene amable, " +
      "tutee y use emojis con moderación. Si alguien se queja, me pasan con la dueña.",
  },
  {
    label: "Pinturería",
    text:
      "Vendo pinturas y recubrimientos en CDMX y zona metropolitana. " +
      "Atendemos de lunes a viernes de 9 a 18, sábados de 9 a 14. " +
      "Tenemos 200 colores en stock y hacemos entregas a domicilio en CDMX " +
      "y municipios cercanos. Aceptamos transferencia y tarjeta. " +
      "El bot debe ser consultivo: que pregunte qué superficie va a pintar antes " +
      "de recomendar producto. Si preguntan por precios de la competencia, " +
      "decimos que no los manejamos.",
  },
  {
    label: "Servicio técnico",
    text:
      "Reparamos celulares y laptops en Mérida. Atendemos de lunes a viernes " +
      "10-19 y sábados 10-14. Diagnóstico gratis si el cliente trae el equipo. " +
      "El costo se cotiza después del diagnóstico. El bot debe sonar profesional, " +
      "sin emojis. Temas prohibidos: precios antes del diagnóstico, garantía de " +
      "datos del cliente. Si piden hablar con un técnico, escalar.",
  },
];

interface BotSetupWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
}

export function BotSetupWizard({ open, onOpenChange, tenantId }: BotSetupWizardProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = React.useState<1 | 2>(1);
  const [description, setDescription] = React.useState("");
  const [draft, setDraft] = React.useState<WizardDraft | null>(null);
  const [editedMd, setEditedMd] = React.useState("");

  // Cada vez que se abre el wizard, vuelve al paso 1 y descarta el borrador
  // anterior: el dueño describió algo nuevo, no estamos refinando el viejo.
  React.useEffect(() => {
    if (open) {
      setStep(1);
      setDraft(null);
      setEditedMd("");
    }
  }, [open]);

  const generate = useMutation({
    mutationFn: async (text: string): Promise<WizardDraft> => {
      const res = await fetch(`${AGENT_BASE}/setup/draft?tenantId=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: text }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.detail ?? "No pude generar el borrador");
      }
      const data = (await res.json()) as WizardDraft;
      return data;
    },
    onSuccess: (data) => {
      setDraft(data);
      setEditedMd(data.negocio_md);
      setStep(2);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const apply = useMutation({
    mutationFn: async (payload: { negocio_md: string; agent_settings: WizardAgentSettings; summary: string }) => {
      const res = await fetch(`${AGENT_BASE}/setup/apply?tenantId=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.detail ?? "No pude aplicar el borrador");
      }
      return res.json();
    },
    onSuccess: (data: { docId: string; knowledgeChars: number }) => {
      toast.success("Bot configurado. El siguiente chat ya usará la nueva identidad.");
      // El borrador cambió el .md y los AgentSettings: refresca lo que el resto
      // de la página muestra para que el dueño vea lo que acaba de guardar.
      void queryClient.invalidateQueries({ queryKey: ["agent-knowledge"] });
      void queryClient.invalidateQueries({ queryKey: ["agent-settings", tenantId] });
      void queryClient.invalidateQueries({ queryKey: ["agent-diagnostics"] });
      void queryClient.invalidateQueries({ queryKey: ["agent-tools"] });
      setDraft(null);
      setEditedMd("");
      onOpenChange(false);
      // `data` se queda en el closure para que TypeScript no se queje; el
      // usuario lo ve en el toast de éxito.
      void data;
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function handleGenerate() {
    if (description.trim().length < 20) {
      toast.error("Cuéntame un poco más: mínimo 20 caracteres.");
      return;
    }
    generate.mutate(description.trim());
  }

  function handleApply() {
    if (!draft) return;
    apply.mutate({
      negocio_md: editedMd,
      agent_settings: draft.agent_settings,
      summary: draft.summary,
    });
  }

  function backToEdit() {
    setStep(1);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
        title="Crear bot con IA"
      >
        <SheetHeader className="border-b px-6 py-4">
          <div className="flex items-center gap-2">
            <Sparkles aria-hidden className="h-4 w-4 text-primary" />
            <SheetTitle className="text-base">Crear bot con IA</SheetTitle>
            <Badge variant="muted" size="sm" className="ml-auto">
              {step === 1 ? "Paso 1 de 2" : "Paso 2 de 2"}
            </Badge>
          </div>
          <SheetDescription>
            {step === 1
              ? "Describe tu negocio en español y el bot se configura solo."
              : "Revisa lo que entendió. Puedes editar el .md antes de aplicar."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === 1 ? (
            <DescribeStep
              description={description}
              setDescription={setDescription}
              onPickExample={(text) => setDescription(text)}
              isPending={generate.isPending}
              error={generate.error}
            />
          ) : draft ? (
            <ReviewStep
              draft={draft}
              editedMd={editedMd}
              setEditedMd={setEditedMd}
              isApplying={apply.isPending}
              applyError={apply.error}
            />
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t bg-background px-6 py-3">
          {step === 1 ? (
            <>
              <p className="text-xs text-muted-foreground">
                No se guarda nada hasta que pulses &quot;Generar&quot;.
              </p>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => onOpenChange(false)}>
                  Cancelar
                </Button>
                <Button onClick={handleGenerate} loading={generate.isPending}>
                  <Wand2 aria-hidden className="h-4 w-4" />
                  {generate.isPending ? "Generando…" : "Generar borrador"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={backToEdit} disabled={apply.isPending}>
                <ChevronLeft aria-hidden className="h-4 w-4" />
                Editar descripción
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  onClick={() => generate.mutate(description.trim())}
                  loading={generate.isPending}
                  disabled={apply.isPending}
                >
                  <ChevronRight aria-hidden className="h-4 w-4" />
                  Regenerar
                </Button>
                <Button onClick={handleApply} loading={apply.isPending}>
                  <Check aria-hidden className="h-4 w-4" />
                  {apply.isPending ? "Aplicando…" : "Aplicar"}
                </Button>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DescribeStep({
  description,
  setDescription,
  onPickExample,
  isPending,
  error,
}: {
  description: string;
  setDescription: (value: string) => void;
  onPickExample: (text: string) => void;
  isPending: boolean;
  error: Error | null;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="bot-description">Cuéntame de tu negocio</Label>
        <Textarea
          id="bot-description"
          rows={10}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Vendemos pinturas y recubrimientos en CDMX y zona metropolitana. Atendemos de lunes a viernes de 9 a 18…"
          disabled={isPending}
          maxLength={4000}
          aria-describedby="bot-description-hint"
        />
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <p id="bot-description-hint">
            Mientras más concreto, mejor: giro, horario, productos, políticas de
            envío, lo que el bot debe y no debe decir.
          </p>
          <span className="tabular-nums">{description.length}/4000</span>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          O empieza con un ejemplo
        </p>
        <div className="flex flex-wrap gap-2">
          {EXAMPLE_PROMPTS.map((example) => (
            <button
              key={example.label}
              type="button"
              onClick={() => onPickExample(example.text)}
              disabled={isPending}
              className="rounded-full border bg-card px-3 py-1 text-xs text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              {example.label}
            </button>
          ))}
        </div>
      </div>

      {isPending ? (
        <SkeletonText lines={4} label="Generando borrador con IA…" />
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertTitle>No pude generar el borrador</AlertTitle>
          <AlertDescription>
            {error.message}. Si el problema persiste, revisa que el agente tenga
            configurada una OpenRouter API key.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function ReviewStep({
  draft,
  editedMd,
  setEditedMd,
  isApplying,
  applyError,
}: {
  draft: WizardDraft;
  editedMd: string;
  setEditedMd: (value: string) => void;
  isApplying: boolean;
  applyError: Error | null;
}) {
  const settings = draft.agent_settings;
  return (
    <div className="space-y-5">
      {draft.summary ? (
        <Alert>
          <Sparkles aria-hidden />
          <AlertTitle>Entendí esto de tu negocio</AlertTitle>
          <AlertDescription>{draft.summary}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Identidad y tono</h3>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
          <Row label="Negocio" value={settings.business_name} />
          <Row label="Agente" value={settings.agent_name} />
          <Row label="Tono" value={settings.tone} />
          <Row label="Estilo de venta" value={settings.sales_style} />
          <Row label="Saludo" value={settings.greeting} />
          <Row label="Emojis" value={formatBool(settings.emoji)} />
        </dl>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Reglas extra</h3>
        <BlockText value={settings.extra_rules} emptyText="Sin reglas extra." />
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Temas que el bot no toca</h3>
        <BlockText value={settings.forbidden_topics} emptyText="Ninguno." />
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Palabras que escalan a humano</h3>
        {settings.handoff_keywords && settings.handoff_keywords.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {settings.handoff_keywords.map((keyword) => (
              <Badge key={keyword} variant="muted">
                {keyword}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Ninguna.</p>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Conocimiento (negocio.md)</h3>
          <span className="text-xs tabular-nums text-muted-foreground">
            {editedMd.length.toLocaleString("es-MX")} caracteres
          </span>
        </div>
        <Textarea
          rows={14}
          value={editedMd}
          onChange={(event) => setEditedMd(event.target.value)}
          disabled={isApplying}
          spellCheck={false}
          aria-label="Contenido del archivo de conocimiento (negocio.md)"
          className="font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">
          Puedes editar el Markdown antes de aplicar. Lo que cambies aquí se
          guarda tal cual en el conocimiento del bot.
        </p>
      </div>

      {applyError ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertTitle>No pude aplicar el borrador</AlertTitle>
          <AlertDescription>{applyError.message}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm">{value || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

function BlockText({ value, emptyText }: { value: string | undefined; emptyText: string }) {
  if (!value || !value.trim()) {
    return <p className="text-xs text-muted-foreground">{emptyText}</p>;
  }
  return (
    <p className="whitespace-pre-line break-words rounded-md border bg-muted/40 px-3 py-2 text-xs">
      {value}
    </p>
  );
}

function formatBool(value: boolean | null | undefined): string {
  if (value === true) return "Sí";
  if (value === false) return "No";
  return "Sin definir";
}
