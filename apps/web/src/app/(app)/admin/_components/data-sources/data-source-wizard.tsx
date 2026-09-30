"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, Check, ChevronLeft, ChevronRight, DatabaseZap, Eye, PlugZap } from "lucide-react";
import { api } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InfoTip } from "@/components/app/info-tip";
import { apiErrorMessage } from "../api-error";
import {
  AUTH_LABELS,
  FIELD_DEFS,
  KIND_LABELS,
  configPayload,
  connectionPayload,
  draftFromDataSource,
  draftToPayload,
  emptyDraft,
  type DataSource,
  type DataSourceAuthType,
  type DataSourceKind,
  type Draft,
  type McpTool,
  type TestResult,
} from "./draft";

type Step = 1 | 2 | 3;

const STEP_TITLES: Record<Step, { title: string; description: string }> = {
  1: { title: "Conexión", description: "Dónde está la fuente y cómo autenticarse. Prueba la conexión antes de seguir." },
  2: { title: "Mapeo de campos", description: "Dile al catálogo dónde viene cada dato y revisa la vista previa." },
  3: { title: "Programación", description: "Cada cuánto sincronizar y qué hacer con lo que deja de venir." },
};

/**
 * Asistente de alta/edición de una fuente de datos en tres pasos. Nada se
 * guarda hasta el último paso; las pruebas (`POST /data-sources/test` y
 * `/tools`) no escriben en la base. Al editar, la credencial guardada se
 * conserva si el campo se deja vacío.
 */
export function DataSourceWizard({
  open,
  source,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  source: DataSource | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void> | void;
}) {
  const [step, setStep] = React.useState<Step>(1);
  const [draft, setDraft] = React.useState<Draft>(() => (source ? draftFromDataSource(source) : emptyDraft()));
  const [stepError, setStepError] = React.useState<string | null>(null);
  const [tools, setTools] = React.useState<McpTool[] | null>(null);
  const [test, setTest] = React.useState<TestResult | null>(null);

  const patch = (changes: Partial<Draft>) => setDraft((d) => ({ ...d, ...changes }));
  const patchField = (key: keyof Draft["fieldMap"], value: string) =>
    setDraft((d) => ({ ...d, fieldMap: { ...d.fieldMap, [key]: value } }));

  /** Cuerpo de prueba: conexión + mapeo actual (el nombre no importa aquí). */
  const testPayload = () => {
    const connection = connectionPayload(draft);
    if (!connection.ok) return connection;
    const config = configPayload(draft);
    if (!config.ok) return config;
    return { ok: true as const, value: { ...connection.value, name: draft.name || "prueba", kind: draft.kind, config: config.value } };
  };

  const probe = useMutation({
    mutationFn: async () => {
      const connection = connectionPayload(draft);
      if (!connection.ok) throw new Error(connection.error);
      if (draft.kind === "MCP") {
        const res = await api.post<{ data: { tools: McpTool[] } }>("/data-sources/tools", connection.value);
        return { tools: res.data.data.tools, test: null as TestResult | null };
      }
      const payload = testPayload();
      if (!payload.ok) throw new Error(payload.error);
      const res = await api.post<{ data: TestResult }>("/data-sources/test", payload.value);
      return { tools: null as McpTool[] | null, test: res.data.data };
    },
    onSuccess: (result) => {
      setStepError(null);
      if (result.tools) {
        setTools(result.tools);
        if (!draft.toolName && result.tools[0]) patch({ toolName: result.tools[0].name });
        toast.success(`Conectado: ${result.tools.length} tool(s) disponibles`);
      }
      if (result.test) {
        setTest(result.test);
        toast.success(`Conectado: ${result.test.fetched} ítem(s) recibidos`);
      }
    },
    onError: (error) => setStepError(error instanceof Error && !("response" in error) ? error.message : apiErrorMessage(error, "No se pudo conectar")),
  });

  const preview = useMutation({
    mutationFn: async () => {
      const payload = testPayload();
      if (!payload.ok) throw new Error(payload.error);
      const res = await api.post<{ data: TestResult }>("/data-sources/test", payload.value);
      return res.data.data;
    },
    onSuccess: (result) => {
      setStepError(null);
      setTest(result);
      if (result.tools) setTools(result.tools);
    },
    onError: (error) => setStepError(error instanceof Error && !("response" in error) ? error.message : apiErrorMessage(error, "La vista previa falló")),
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = draftToPayload(draft);
      if (!payload.ok) throw new Error(payload.error);
      if (draft.id) {
        const { kind: _kind, ...rest } = payload.value;
        await api.patch(`/data-sources/${draft.id}`, rest);
      } else {
        await api.post("/data-sources", payload.value);
      }
    },
    onSuccess: async () => {
      toast.success(draft.id ? "Fuente actualizada" : "Fuente creada");
      await onSaved();
    },
    onError: (error) => setStepError(error instanceof Error && !("response" in error) ? error.message : apiErrorMessage(error, "No se pudo guardar")),
  });

  const goNext = () => {
    if (step === 1) {
      if (!draft.name.trim()) return setStepError("Ponle un nombre a la fuente");
      const connection = connectionPayload(draft);
      if (!connection.ok) return setStepError(connection.error);
      setStepError(null);
      setStep(2);
      return;
    }
    if (step === 2) {
      const config = configPayload(draft);
      if (!config.ok) return setStepError(config.error);
      setStepError(null);
      setStep(3);
    }
  };

  const busy = probe.isPending || preview.isPending || save.isPending;
  const meta = STEP_TITLES[step];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl" title={source ? "Editar fuente" : "Nueva fuente"}>
        <SheetHeader className="border-b px-6 py-4">
          <div className="flex items-center gap-2">
            <DatabaseZap aria-hidden className="h-4 w-4 text-primary" />
            <SheetTitle className="text-base">{source ? `Editar: ${source.name}` : "Nueva fuente de datos"}</SheetTitle>
            <Badge variant="muted" size="sm" className="ml-auto">
              Paso {step} de 3 · {meta.title}
            </Badge>
          </div>
          <SheetDescription>{meta.description}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {stepError ? (
            <Alert variant="destructive">
              <AlertCircle aria-hidden />
              <AlertTitle>Revisa este paso</AlertTitle>
              <AlertDescription>{stepError}</AlertDescription>
            </Alert>
          ) : null}

          {step === 1 ? (
            <ConnectionStep draft={draft} patch={patch} editing={source !== null} tools={tools} test={test} onProbe={() => probe.mutate()} probing={probe.isPending} />
          ) : null}
          {step === 2 ? (
            <MappingStep draft={draft} patch={patch} patchField={patchField} tools={tools} test={test} onPreview={() => preview.mutate()} previewing={preview.isPending} />
          ) : null}
          {step === 3 ? <ScheduleStep draft={draft} patch={patch} /> : null}
        </div>

        <div className="flex items-center justify-between gap-2 border-t px-6 py-4">
          <Button variant="ghost" onClick={() => (step === 1 ? onOpenChange(false) : setStep((s) => (s - 1) as Step))} disabled={busy}>
            {step === 1 ? "Cancelar" : (
              <>
                <ChevronLeft aria-hidden className="h-4 w-4" />
                Atrás
              </>
            )}
          </Button>
          {step < 3 ? (
            <Button onClick={goNext} disabled={busy}>
              Siguiente
              <ChevronRight aria-hidden className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={busy}>
              <Check aria-hidden className="h-4 w-4" />
              {draft.id ? "Guardar cambios" : "Crear fuente"}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Piezas de formulario
// ---------------------------------------------------------------------------

function Field({ id, label, hint, tip, children }: { id: string; label: string; hint?: string; tip?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="inline-flex items-center gap-1">
        {label}
        {tip ? <InfoTip label={label} text={tip} /> : null}
      </Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function ConnectionStep({
  draft,
  patch,
  editing,
  tools,
  test,
  onProbe,
  probing,
}: {
  draft: Draft;
  patch: (changes: Partial<Draft>) => void;
  editing: boolean;
  tools: McpTool[] | null;
  test: TestResult | null;
  onProbe: () => void;
  probing: boolean;
}) {
  return (
    <div className="space-y-4">
      <Field id="ds-name" label="Nombre">
        <Input id="ds-name" value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="ERP de la bodega" maxLength={100} />
      </Field>

      <Field id="ds-kind" label="Tipo de fuente" hint={editing ? "El tipo no se puede cambiar al editar." : undefined}>
        <Select id="ds-kind" value={draft.kind} disabled={editing} onChange={(e) => patch({ kind: e.target.value as DataSourceKind })}>
          {(Object.keys(KIND_LABELS) as DataSourceKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        id="ds-url"
        label={draft.kind === "REST" ? "URL base de la API" : "URL del servidor MCP"}
        hint={draft.kind === "REST" ? "Se le agrega la ruta del listado en el siguiente paso." : "Endpoint Streamable HTTP (JSON-RPC por POST)."}
      >
        <Input id="ds-url" type="url" inputMode="url" value={draft.url} onChange={(e) => patch({ url: e.target.value })} placeholder={draft.kind === "REST" ? "https://api.mi-erp.com/v1" : "https://mcp.mi-proveedor.com/mcp"} />
      </Field>

      <Field id="ds-auth" label="Autenticación">
        <Select id="ds-auth" value={draft.authType} onChange={(e) => patch({ authType: e.target.value as DataSourceAuthType })}>
          {(Object.keys(AUTH_LABELS) as DataSourceAuthType[]).map((k) => (
            <option key={k} value={k}>
              {AUTH_LABELS[k]}
            </option>
          ))}
        </Select>
      </Field>

      {draft.authType !== "NONE" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {draft.authType === "API_KEY_HEADER" ? (
            <Field id="ds-header-name" label="Nombre del header">
              <Input id="ds-header-name" value={draft.authHeaderName} onChange={(e) => patch({ authHeaderName: e.target.value })} placeholder="X-API-Key" />
            </Field>
          ) : null}
          <Field
            id="ds-credential"
            label={draft.authType === "BASIC" ? "usuario:contraseña" : draft.authType === "BEARER" ? "Token" : "API key"}
            hint={editing ? "Déjalo vacío para conservar la credencial guardada." : "Se guarda cifrada y no vuelve a mostrarse."}
          >
            <Input id="ds-credential" type="password" autoComplete="off" value={draft.credential} onChange={(e) => patch({ credential: e.target.value })} placeholder={draft.authType === "BASIC" ? "usuario:contraseña" : "••••••••"} />
          </Field>
        </div>
      ) : null}

      <Field id="ds-headers" label="Headers adicionales" hint="Uno por línea, formato Nombre: valor. Sin secretos aquí: para eso está la credencial.">
        <Textarea id="ds-headers" rows={2} value={draft.headersText} onChange={(e) => patch({ headersText: e.target.value })} placeholder={"Accept-Language: es-MX\nX-Store: principal"} className="font-mono text-xs" />
      </Field>

      <div className="flex flex-wrap items-center gap-3 rounded-md border border-hairline bg-card p-3">
        <Button variant="outline" onClick={onProbe} loading={probing}>
          <PlugZap aria-hidden className="h-4 w-4" />
          Probar conexión
        </Button>
        <p className="text-xs text-muted-foreground">
          {draft.kind === "MCP" ? "Lista las tools del servidor para elegir una en el siguiente paso." : "Pide la primera página con la ruta del paso 2 (por defecto /products) y muestra qué devuelve."}
        </p>
      </div>

      {tools && draft.kind === "MCP" ? (
        <Alert variant="success">
          <Check aria-hidden />
          <AlertTitle>Conectado · {tools.length} tool(s)</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 space-y-0.5">
              {tools.slice(0, 12).map((t) => (
                <li key={t.name} className="text-xs">
                  <span className="font-mono">{t.name}</span>
                  {t.description ? <span className="text-muted-foreground"> — {t.description.slice(0, 90)}</span> : null}
                </li>
              ))}
              {tools.length > 12 ? <li className="text-xs text-muted-foreground">… y {tools.length - 12} más</li> : null}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {test && draft.kind === "REST" ? <RawSample test={test} /> : null}
    </div>
  );
}

function MappingStep({
  draft,
  patch,
  patchField,
  tools,
  test,
  onPreview,
  previewing,
}: {
  draft: Draft;
  patch: (changes: Partial<Draft>) => void;
  patchField: (key: keyof Draft["fieldMap"], value: string) => void;
  tools: McpTool[] | null;
  test: TestResult | null;
  onPreview: () => void;
  previewing: boolean;
}) {
  return (
    <div className="space-y-5">
      {draft.kind === "REST" ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <Field id="ds-list-path" label="Ruta del listado" hint="Relativa a la URL base, o una URL completa.">
              <Input id="ds-list-path" value={draft.listPath} onChange={(e) => patch({ listPath: e.target.value })} placeholder="/products" className="font-mono text-sm" />
            </Field>
            <Field id="ds-method" label="Método">
              <Select id="ds-method" value={draft.method} onChange={(e) => patch({ method: e.target.value as "GET" | "POST" })}>
                <option value="GET">GET</option>
                <option value="POST">POST</option>
              </Select>
            </Field>
          </div>
          <Field id="ds-query" label="Parámetros fijos de consulta" hint="Uno por línea, formato nombre: valor.">
            <Textarea id="ds-query" rows={2} value={draft.queryText} onChange={(e) => patch({ queryText: e.target.value })} placeholder={"status: active\nfields: sku,name,price"} className="font-mono text-xs" />
          </Field>
          {draft.method === "POST" ? (
            <Field id="ds-body" label="Cuerpo JSON">
              <Textarea id="ds-body" rows={3} value={draft.bodyText} onChange={(e) => patch({ bodyText: e.target.value })} placeholder='{ "filter": { "active": true } }' className="font-mono text-xs" />
            </Field>
          ) : null}
          <Field id="ds-pagination" label="Paginación">
            <Select id="ds-pagination" value={draft.paginationType} onChange={(e) => patch({ paginationType: e.target.value as Draft["paginationType"] })}>
              <option value="none">Sin paginación (una sola respuesta)</option>
              <option value="page">Por número de página</option>
              <option value="cursor">Por cursor</option>
            </Select>
          </Field>
          {draft.paginationType === "page" ? (
            <div className="grid gap-4 sm:grid-cols-4">
              <Field id="ds-page-param" label="Parámetro de página">
                <Input id="ds-page-param" value={draft.pageParam} onChange={(e) => patch({ pageParam: e.target.value })} placeholder="page" className="font-mono text-sm" />
              </Field>
              <Field id="ds-size-param" label="Parámetro de tamaño">
                <Input id="ds-size-param" value={draft.sizeParam} onChange={(e) => patch({ sizeParam: e.target.value })} placeholder="limit" className="font-mono text-sm" />
              </Field>
              <Field id="ds-page-size" label="Tamaño de página">
                <Input id="ds-page-size" inputMode="numeric" value={draft.pageSize} onChange={(e) => patch({ pageSize: e.target.value })} placeholder="100" />
              </Field>
              <Field id="ds-start-page" label="Primera página">
                <Input id="ds-start-page" inputMode="numeric" value={draft.startPage} onChange={(e) => patch({ startPage: e.target.value })} placeholder="1" />
              </Field>
            </div>
          ) : null}
          {draft.paginationType === "cursor" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="ds-cursor-param" label="Parámetro del cursor">
                <Input id="ds-cursor-param" value={draft.cursorParam} onChange={(e) => patch({ cursorParam: e.target.value })} placeholder="cursor" className="font-mono text-sm" />
              </Field>
              <Field id="ds-next-cursor" label="Ruta del siguiente cursor" hint="En la respuesta; vacío o null = última página.">
                <Input id="ds-next-cursor" value={draft.nextCursorPath} onChange={(e) => patch({ nextCursorPath: e.target.value })} placeholder="meta.nextCursor" className="font-mono text-sm" />
              </Field>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          <Field id="ds-tool" label="Tool que lista los productos" hint={tools ? undefined : "Prueba la conexión en el paso anterior para ver las tools disponibles."}>
            {tools && tools.length > 0 ? (
              <Select id="ds-tool" value={draft.toolName} onChange={(e) => patch({ toolName: e.target.value })}>
                <option value="">Elige una tool…</option>
                {tools.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </Select>
            ) : (
              <Input id="ds-tool" value={draft.toolName} onChange={(e) => patch({ toolName: e.target.value })} placeholder="list_products" className="font-mono text-sm" />
            )}
          </Field>
          <Field id="ds-tool-args" label="Argumentos de la tool (JSON)" hint="Opcional. Se mandan tal cual en cada sincronización.">
            <Textarea id="ds-tool-args" rows={3} value={draft.toolArgsText} onChange={(e) => patch({ toolArgsText: e.target.value })} placeholder='{ "limit": 1000 }' className="font-mono text-xs" />
          </Field>
        </div>
      )}

      <Field
        id="ds-items-path"
        label="Ruta de la lista de ítems"
        tip="Ruta dentro de la respuesta donde está el arreglo de productos: data.items, products, o vacío si la respuesta ya es el arreglo."
        hint="Vacío = la respuesta entera es la lista."
      >
        <Input id="ds-items-path" value={draft.itemsJsonPath} onChange={(e) => patch({ itemsJsonPath: e.target.value })} placeholder="data.items" className="font-mono text-sm" />
      </Field>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Campos del producto</legend>
        <p className="text-xs text-muted-foreground">
          Escribe la ruta de cada dato dentro de un ítem (<span className="font-mono">precio.monto</span>,{" "}
          <span className="font-mono">imagenes[0].url</span>). Un valor fijo se escribe con <span className="font-mono">=</span>, por ejemplo{" "}
          <span className="font-mono">=MXN</span>.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {FIELD_DEFS.map((def) => (
            <Field key={def.key} id={`ds-field-${def.key}`} label={def.required ? `${def.label} *` : def.label} tip={def.hint}>
              <Input id={`ds-field-${def.key}`} value={draft.fieldMap[def.key]} onChange={(e) => patchField(def.key, e.target.value)} placeholder={def.placeholder} className="font-mono text-sm" />
            </Field>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3 rounded-md border border-hairline bg-card p-3">
        <Button variant="outline" onClick={onPreview} loading={previewing}>
          <Eye aria-hidden className="h-4 w-4" />
          Vista previa (3 ítems)
        </Button>
        <p className="text-xs text-muted-foreground">Conecta, aplica el mapeo a los primeros ítems y no guarda nada.</p>
      </div>

      {test ? <PreviewTable test={test} /> : null}
      {test ? <RawSample test={test} /> : null}
    </div>
  );
}

function PreviewTable({ test }: { test: TestResult }) {
  if (test.preview.length === 0) {
    return (
      <Alert variant="warning">
        <AlertCircle aria-hidden />
        <AlertTitle>La fuente respondió pero no se encontraron ítems</AlertTitle>
        <AlertDescription>Revisa la ruta de la lista de ítems contra la respuesta cruda de abajo.</AlertDescription>
      </Alert>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-hairline">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>SKU</TableHead>
            <TableHead>Nombre</TableHead>
            <TableHead className="text-right">Precio</TableHead>
            <TableHead className="text-right">Existencias</TableHead>
            <TableHead>Categoría</TableHead>
            <TableHead>Activo</TableHead>
            <TableHead>Imágenes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {test.preview.map((row, i) =>
            row.ok && row.item ? (
              <TableRow key={i}>
                <TableCell className="font-mono text-xs">{row.item.sku}</TableCell>
                <TableCell>{row.item.name}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.item.price} {row.item.currency}
                </TableCell>
                <TableCell className="text-right tabular-nums">{row.item.stock ?? "—"}</TableCell>
                <TableCell>{row.item.category ?? "—"}</TableCell>
                <TableCell>{row.item.active ? "Sí" : "No"}</TableCell>
                <TableCell className="tabular-nums">{row.item.imageUrls.length}</TableCell>
              </TableRow>
            ) : (
              <TableRow key={i}>
                <TableCell colSpan={7} className="text-destructive">
                  Ítem {i + 1}: {row.error}
                </TableCell>
              </TableRow>
            ),
          )}
        </TableBody>
      </Table>
      <p className="border-t border-hairline px-3 py-2 text-xs text-muted-foreground">
        {test.fetched} ítem(s) en la primera página. Las imágenes se cuentan pero no se importan.
      </p>
    </div>
  );
}

function RawSample({ test }: { test: TestResult }) {
  return (
    <details className="rounded-md border border-hairline bg-card">
      <summary className="cursor-pointer px-3 py-2 text-sm">Respuesta cruda (primeros {test.rawSample.length} ítems)</summary>
      <pre className="max-h-72 overflow-auto border-t border-hairline px-3 py-2 font-mono text-xs">{JSON.stringify(test.rawSample, null, 2)}</pre>
    </details>
  );
}

function ScheduleStep({ draft, patch }: { draft: Draft; patch: (changes: Partial<Draft>) => void }) {
  return (
    <div className="space-y-5">
      <Field id="ds-schedule-mode" label="Frecuencia">
        <Select id="ds-schedule-mode" value={draft.scheduleMode} onChange={(e) => patch({ scheduleMode: e.target.value as Draft["scheduleMode"] })}>
          <option value="manual">Solo manual (botón «Sincronizar ahora»)</option>
          <option value="interval">Cada N minutos</option>
          <option value="cron">Horario fijo (cron)</option>
        </Select>
      </Field>

      {draft.scheduleMode === "interval" ? (
        <Field id="ds-every" label="Cada cuántos minutos" hint="Mínimo 5. Ejemplos: 15, 60, 1440 (un día).">
          <Input id="ds-every" inputMode="numeric" value={draft.everyMinutes} onChange={(e) => patch({ everyMinutes: e.target.value })} placeholder="60" />
        </Field>
      ) : null}

      {draft.scheduleMode === "cron" ? (
        <Field id="ds-cron" label="Expresión cron (UTC)" hint="5 campos: minuto hora día mes díaSemana. Ejemplos: «0 3 * * *» (3:00 diario), «*/30 * * * *» (cada 30 min), «0 6 * * 1-5» (6:00 lunes a viernes).">
          <Input id="ds-cron" value={draft.cron} onChange={(e) => patch({ cron: e.target.value })} placeholder="0 3 * * *" className="font-mono text-sm" />
        </Field>
      ) : null}

      <div className="space-y-3 rounded-md border border-hairline bg-card p-3">
        <div className="flex items-start gap-2">
          <Checkbox id="ds-deactivate" checked={draft.deactivateMissing} onChange={(e) => patch({ deactivateMissing: e.target.checked })} className="mt-0.5" />
          <div>
            <Label htmlFor="ds-deactivate">Archivar productos que dejen de venir</Label>
            <p className="text-xs text-muted-foreground">
              Si un producto importado por esta fuente ya no aparece en la respuesta, se archiva (nunca se borra). Con una respuesta vacía no se archiva nada.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <Checkbox id="ds-paused" checked={draft.status === "PAUSED"} onChange={(e) => patch({ status: e.target.checked ? "PAUSED" : "ACTIVE" })} className="mt-0.5" />
          <div>
            <Label htmlFor="ds-paused">Pausar la programación</Label>
            <p className="text-xs text-muted-foreground">La fuente queda guardada y solo se sincroniza con el botón «Sincronizar ahora».</p>
          </div>
        </div>
      </div>

      <Alert variant="info">
        <AlertCircle aria-hidden />
        <AlertTitle>Qué pasa al sincronizar</AlertTitle>
        <AlertDescription>
          Se crean o actualizan productos por SKU con precio, existencias y categoría. Los productos nuevos entran activos; los que la fuente marca inactivos se archivan. Nada se borra.
        </AlertDescription>
      </Alert>
    </div>
  );
}
