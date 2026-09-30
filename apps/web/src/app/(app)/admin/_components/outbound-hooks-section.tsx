"use client";

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Copy, History, MoreHorizontal, Plus, RefreshCw, Send, Webhook } from "lucide-react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Section } from "@/components/app/section";
import { InfoTip, Tip } from "@/components/app/info-tip";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { DateTime } from "@/components/app/date-time";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { usePermissions } from "@/components/app/use-permissions";
import { apiErrorMessage } from "./api-error";
import {
  AUTH_NEEDS_CREDENTIAL,
  AUTH_TYPE_LABELS,
  DELIVERY_STATUS_LABELS,
  DELIVERY_STATUS_TONES,
  HOOK_KIND_LABELS,
  describeDeliveryResult,
  headersToLines,
  parseHeaderLines,
  parseJsonObject,
  shortUrl,
  type DeliveryStatus,
  type HookAuthType,
  type HookDelivery,
  type HookEventDefinition,
  type HookKind,
  type OutboundHook,
} from "./outbound-hooks.helpers";

/**
 * Hooks salientes: webhooks REST o herramientas MCP que la plataforma dispara
 * cuando termina una acción de negocio (pedido creado, pago acreditado...).
 *
 * Backend: `apps/commerce-api/src/hooks/` (`/hooks`). El secreto de firma se
 * muestra UNA sola vez, al crear o rotar, en un banner persistente igual que
 * el de las API keys.
 */

const HOOKS_KEY = ["outbound-hooks"] as const;
const EVENTS_KEY = ["outbound-hook-events"] as const;
const deliveriesKey = (hookId: string, status: string) => ["outbound-hook-deliveries", hookId, status] as const;

async function copyToClipboard(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copiado`);
  } catch {
    toast.message(label, { description: text });
  }
}

function useHookEvents() {
  return useQuery({
    queryKey: EVENTS_KEY,
    queryFn: async () => {
      const res = await api.get<{ data: HookEventDefinition[] }>("/hooks/events");
      return res.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function OutboundHooksSection() {
  const perms = usePermissions();
  const canWrite = perms.can("integrations.write");
  const queryClient = useQueryClient();
  const [secret, setSecret] = useState<{ hookName: string; value: string } | null>(null);
  const [editing, setEditing] = useState<OutboundHook | null>(null);
  const [creating, setCreating] = useState(false);
  const [deliveriesOf, setDeliveriesOf] = useState<OutboundHook | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OutboundHook | null>(null);
  const [rotateTarget, setRotateTarget] = useState<OutboundHook | null>(null);

  const hooks = useQuery({
    queryKey: HOOKS_KEY,
    queryFn: async () => {
      const res = await api.get<{ data: OutboundHook[] }>("/hooks");
      return res.data.data;
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: HOOKS_KEY });

  const test = useMutation({
    mutationFn: async (hook: OutboundHook) => {
      const res = await api.post<{ data: HookDelivery }>(`/hooks/${hook.id}/test`);
      return { hook, delivery: res.data.data };
    },
    onSuccess: ({ hook, delivery }) => {
      void queryClient.invalidateQueries({ queryKey: ["outbound-hook-deliveries", hook.id] });
      if (delivery.status === "SUCCESS") {
        toast.success(`«${hook.name}» respondió ${describeDeliveryResult(delivery)}`, {
          description: `El ping llegó en ${delivery.durationMs ?? 0} ms.`,
        });
      } else {
        toast.error(`«${hook.name}» no aceptó el ping`, {
          description: `${describeDeliveryResult(delivery)}. Revisa la URL, la autenticación y la respuesta en el historial.`,
        });
      }
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo probar el hook")),
  });

  const toggle = useMutation({
    mutationFn: async (hook: OutboundHook) => {
      await api.patch(`/hooks/${hook.id}`, { status: hook.status === "ACTIVE" ? "DISABLED" : "ACTIVE" });
      return hook;
    },
    onSuccess: async (hook) => {
      toast.success(hook.status === "ACTIVE" ? "Hook pausado" : "Hook activado");
      await invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo cambiar el estado")),
  });

  const remove = useMutation({
    mutationFn: async (hook: OutboundHook) => {
      await api.delete(`/hooks/${hook.id}`);
    },
    onSuccess: async () => {
      toast.success("Hook eliminado");
      setDeleteTarget(null);
      await invalidate();
    },
    onError: (error) => {
      setDeleteTarget(null);
      toast.error(apiErrorMessage(error, "No se pudo eliminar"));
    },
  });

  const rotate = useMutation({
    mutationFn: async (hook: OutboundHook) => {
      const res = await api.post<{ data: { signingSecret: string } }>(`/hooks/${hook.id}/rotate-secret`);
      return { hook, secret: res.data.data.signingSecret };
    },
    onSuccess: ({ hook, secret: value }) => {
      setRotateTarget(null);
      setSecret({ hookName: hook.name, value });
      toast.success("Secreto de firma rotado");
    },
    onError: (error) => {
      setRotateTarget(null);
      toast.error(apiErrorMessage(error, "No se pudo rotar el secreto"));
    },
  });

  const columns: Array<DataTableColumn<OutboundHook>> = [
    {
      key: "name",
      header: "Nombre",
      cell: (h) => (
        <div className="min-w-0">
          <p className="font-medium">{h.name}</p>
          {h.description ? <p className="truncate text-xs text-muted-foreground">{h.description}</p> : null}
        </div>
      ),
    },
    {
      key: "kind",
      header: "Tipo",
      width: "9rem",
      cell: (h) => (
        <Badge variant={h.kind === "MCP" ? "info" : "neutral"} size="sm" className="font-medium">
          {HOOK_KIND_LABELS[h.kind]}
        </Badge>
      ),
    },
    {
      key: "target",
      header: "Destino",
      cell: (h) => (
        <span className="block max-w-[22rem] truncate font-mono text-xs text-muted-foreground" title={h.targetUrl}>
          {shortUrl(h.targetUrl)}
          {h.kind === "MCP" && h.toolName ? ` → ${h.toolName}` : ""}
        </span>
      ),
    },
    {
      key: "events",
      header: "Eventos",
      cell: (h) => (
        <span className="flex flex-wrap gap-1">
          {h.events.slice(0, 3).map((e) => (
            <Badge key={e} variant="neutral" size="sm" className="font-mono font-medium">
              {e}
            </Badge>
          ))}
          {h.events.length > 3 ? (
            <Badge variant="outline" size="sm">
              +{h.events.length - 3}
            </Badge>
          ) : null}
        </span>
      ),
    },
    {
      key: "status",
      header: "Estado",
      width: "8rem",
      cell: (h) => (
        <StatusBadge
          status={h.status}
          tone={h.status === "ACTIVE" ? "success" : "neutral"}
          label={h.status === "ACTIVE" ? "Activo" : "Pausado"}
        />
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Acciones</span>,
      width: "4rem",
      className: "text-right",
      cell: (h) => (
        <DropdownMenu>
          <Tip label="Acciones">
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Acciones de ${h.name}`}>
                <MoreHorizontal aria-hidden className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
          </Tip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setDeliveriesOf(h)}>Ver entregas</DropdownMenuItem>
            {canWrite ? (
              <>
                <DropdownMenuItem onSelect={() => test.mutate(h)}>Probar (enviar ping)</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setEditing(h)}>Editar</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => toggle.mutate(h)}>
                  {h.status === "ACTIVE" ? "Pausar" : "Activar"}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setRotateTarget(h)}>Rotar secreto de firma</DropdownMenuItem>
                <DropdownMenuItem className="text-destructive" onSelect={() => setDeleteTarget(h)}>
                  Eliminar
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <>
      <Section
        title="Hooks salientes"
        headerIcon={<Webhook className="h-4 w-4" />}
        description="Avisa a tus sistemas (ERP, CRM, automatizaciones o un servidor MCP) cuando pasa algo en Easy Sell: pedidos, cotizaciones, pagos, clientes y conversaciones."
        actions={
          canWrite ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus aria-hidden className="h-3.5 w-3.5" />
              Nuevo hook
            </Button>
          ) : null
        }
        padded={false}
      >
        <DataTable
          columns={columns}
          rows={hooks.data}
          isLoading={hooks.isLoading}
          isError={hooks.isError}
          error={hooks.error}
          onRetry={() => void hooks.refetch()}
          caption="Hooks salientes del tenant"
          empty={{
            icon: <Webhook className="h-6 w-6" />,
            title: "Sin hooks salientes",
            description:
              "Crea uno para recibir un POST firmado (o una llamada a una herramienta MCP) cada vez que se cree un pedido, se acredite un pago o un cliente pida hablar con una persona.",
            action: canWrite ? (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus aria-hidden className="h-3.5 w-3.5" />
                Nuevo hook
              </Button>
            ) : undefined,
          }}
        />
      </Section>

      {secret ? (
        <div
          className="sticky bottom-4 z-10 mx-auto mt-4 max-w-2xl rounded-lg border border-warning/40 bg-warning-subtle p-4 text-warning-foreground shadow-airbnb-lg"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start gap-3">
            <Webhook aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                Secreto de firma de «{secret.hookName}»: cópialo ahora, no se muestra de nuevo
              </p>
              <p className="mt-1 text-xs">
                Con él tu servidor verifica el header <code className="font-mono">X-EasySell-Signature</code> de
                cada entrega.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="break-all rounded-md bg-background px-2 py-1 font-mono text-xs">{secret.value}</code>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Copiar secreto de firma"
                  onClick={() => void copyToClipboard(secret.value, "Secreto")}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copiar
                </Button>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSecret(null)}>
              Ya lo guardé
            </Button>
          </div>
        </div>
      ) : null}

      <HookFormSheet
        open={creating || editing !== null}
        hook={editing}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false);
            setEditing(null);
          }
        }}
        onSaved={(saved, signingSecret) => {
          setCreating(false);
          setEditing(null);
          if (signingSecret) setSecret({ hookName: saved.name, value: signingSecret });
          void invalidate();
        }}
      />

      <DeliveriesSheet
        hook={deliveriesOf}
        canWrite={canWrite}
        onOpenChange={(open) => !open && setDeliveriesOf(null)}
        onTest={(hook) => test.mutate(hook)}
        testing={test.isPending}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`¿Eliminar «${deleteTarget?.name ?? ""}»?`}
        description="Se borra el hook y todo su historial de entregas. Las entregas pendientes ya no se enviarán. No se puede deshacer."
        confirmLabel="Eliminar"
        pending={remove.isPending}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
      />

      <ConfirmDialog
        open={rotateTarget !== null}
        onOpenChange={(open) => !open && setRotateTarget(null)}
        title={`¿Rotar el secreto de «${rotateTarget?.name ?? ""}»?`}
        description="Las entregas siguientes se firmarán con el secreto nuevo. Actualízalo en tu servidor antes de que llegue el próximo evento, o las firmas dejarán de validar."
        confirmLabel="Rotar secreto"
        variant="default"
        pending={rotate.isPending}
        onConfirm={() => rotateTarget && rotate.mutate(rotateTarget)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Formulario (crear / editar)
// ---------------------------------------------------------------------------

const KINDS: HookKind[] = ["REST", "MCP"];
const AUTH_TYPES: HookAuthType[] = ["NONE", "BEARER", "API_KEY_HEADER", "BASIC", "HMAC"];

const schema = z
  .object({
    name: z.string().trim().min(1, "Ponle un nombre al hook").max(100, "Máximo 100 caracteres"),
    description: z.string().trim().max(500, "Máximo 500 caracteres"),
    kind: z.enum(["REST", "MCP"]),
    targetUrl: z
      .string()
      .trim()
      .min(1, "Escribe la URL de destino")
      .max(2000)
      .refine((v) => /^https?:\/\/\S+$/i.test(v), "Debe empezar con https:// (o http://)"),
    authType: z.enum(["NONE", "BEARER", "API_KEY_HEADER", "BASIC", "HMAC"]),
    credential: z.string().max(4096),
    authHeaderName: z
      .string()
      .trim()
      .max(64)
      .refine((v) => v === "" || /^[A-Za-z0-9-]+$/.test(v), "Solo letras, números y guiones"),
    events: z.array(z.string()).min(1, "Elige al menos un evento"),
    headersText: z.string().max(4000),
    toolName: z
      .string()
      .trim()
      .max(128)
      .refine((v) => v === "" || /^[A-Za-z0-9_.-]+$/.test(v), "Solo letras, números, punto, guion y guion bajo"),
    argsTemplateText: z.string().max(16000, "Máximo 16 KB"),
    maxAttempts: z.string().refine((v) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 10, "Entre 1 y 10"),
    backoffSeconds: z
      .string()
      .refine((v) => /^\d+$/.test(v) && Number(v) >= 5 && Number(v) <= 3600, "Entre 5 y 3600 segundos"),
  })
  .superRefine((values, ctx) => {
    const headers = parseHeaderLines(values.headersText);
    if (headers.error) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["headersText"], message: headers.error });
    if (values.kind === "MCP") {
      if (!values.toolName) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["toolName"], message: "Indica la herramienta a invocar" });
      }
      const tpl = parseJsonObject(values.argsTemplateText);
      if (tpl.error) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["argsTemplateText"], message: tpl.error });
    }
    if (values.authType === "BASIC" && values.credential && !values.credential.includes(":")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["credential"], message: "Escríbela como usuario:contraseña" });
    }
  });

type FormValues = z.infer<typeof schema>;

function defaultsFrom(hook: OutboundHook | null): FormValues {
  return {
    name: hook?.name ?? "",
    description: hook?.description ?? "",
    kind: hook?.kind ?? "REST",
    targetUrl: hook?.targetUrl ?? "",
    authType: hook?.authType ?? "NONE",
    credential: "",
    authHeaderName: hook?.authHeaderName ?? "",
    events: hook?.events ?? [],
    headersText: headersToLines(hook?.headers),
    toolName: hook?.toolName ?? "",
    argsTemplateText: hook?.argsTemplate ? JSON.stringify(hook.argsTemplate, null, 2) : "",
    maxAttempts: String(hook?.retryPolicy.maxAttempts ?? 5),
    backoffSeconds: String(hook?.retryPolicy.backoffSeconds ?? 30),
  };
}

function HookFormSheet({
  open,
  hook,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  hook: OutboundHook | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (hook: OutboundHook, signingSecret: string | null) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        title={hook ? "Editar hook" : "Nuevo hook"}
        className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl"
      >
        {open ? <HookForm key={hook?.id ?? "new"} hook={hook} onSaved={onSaved} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function HookForm({
  hook,
  onSaved,
}: {
  hook: OutboundHook | null;
  onSaved: (hook: OutboundHook, signingSecret: string | null) => void;
}) {
  const events = useHookEvents();
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaultsFrom(hook) });

  const kind = watch("kind");
  const authType = watch("authType");
  const selected = watch("events");
  const needsCredential = AUTH_NEEDS_CREDENTIAL.has(authType);

  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      const headers = parseHeaderLines(values.headersText).headers;
      const body: Record<string, unknown> = {
        name: values.name,
        description: values.description || undefined,
        kind: values.kind,
        targetUrl: values.targetUrl,
        authType: values.authType,
        events: values.events,
        headers,
        retryPolicy: { maxAttempts: Number(values.maxAttempts), backoffSeconds: Number(values.backoffSeconds) },
      };
      if (needsCredential && values.credential) body.credential = values.credential;
      if (values.authType === "API_KEY_HEADER" && values.authHeaderName) body.authHeaderName = values.authHeaderName;
      if (values.kind === "MCP") {
        body.toolName = values.toolName;
        const tpl = parseJsonObject(values.argsTemplateText).value;
        if (tpl) body.argsTemplate = tpl;
      }
      if (hook) {
        const res = await api.patch<{ data: OutboundHook }>(`/hooks/${hook.id}`, body);
        return { hook: res.data.data, signingSecret: null as string | null };
      }
      const res = await api.post<{ data: { hook: OutboundHook; signingSecret: string } }>("/hooks", body);
      return { hook: res.data.data.hook, signingSecret: res.data.data.signingSecret as string | null };
    },
    onSuccess: ({ hook: saved, signingSecret }) => {
      toast.success(hook ? "Hook actualizado" : "Hook creado");
      onSaved(saved, signingSecret);
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo guardar el hook")),
  });

  function onSubmit(values: FormValues) {
    // En alta la credencial es obligatoria si el tipo la usa; en edición se
    // conserva la guardada salvo que se escriba otra.
    if (needsCredential && !values.credential && !(hook?.hasCredential && hook.authType === values.authType)) {
      setError("credential", { message: "Esta autenticación necesita una credencial" });
      return;
    }
    save.mutate(values);
  }

  const grouped = useMemo(() => {
    const groups = new Map<string, HookEventDefinition[]>();
    for (const e of events.data ?? []) {
      if (!e.subscribable) continue;
      groups.set(e.group, [...(groups.get(e.group) ?? []), e]);
    }
    return [...groups.entries()];
  }, [events.data]);

  const field = (id: keyof FormValues) => ({
    id: `hook-${id}`,
    "aria-invalid": !!errors[id],
    "aria-describedby": errors[id] ? `hook-${id}-error` : `hook-${id}-hint`,
  });
  const helper = (id: keyof FormValues, hint: string) =>
    errors[id] ? (
      <p id={`hook-${id}-error`} className="text-xs text-destructive">
        {errors[id]?.message as string}
      </p>
    ) : (
      <p id={`hook-${id}-hint`} className="text-xs text-muted-foreground">
        {hint}
      </p>
    );

  return (
    <>
      <SheetHeader className="border-b px-6 py-4">
        <SheetTitle>{hook ? "Editar hook" : "Nuevo hook saliente"}</SheetTitle>
        <SheetDescription>
          {hook
            ? "Los cambios aplican a las entregas siguientes. El secreto de firma no cambia (rótalo desde el menú)."
            : "Recibirás un POST JSON firmado (o una llamada a tu herramienta MCP) por cada evento marcado. El secreto de firma se muestra una sola vez al guardar."}
        </SheetDescription>
      </SheetHeader>

      <form noValidate onSubmit={handleSubmit(onSubmit)} className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="hook-name">Nombre</Label>
            <Input placeholder="ERP de facturación" autoComplete="off" {...field("name")} {...register("name")} />
            {helper("name", "Cómo lo vas a reconocer en la lista y en la bitácora.")}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hook-kind">Tipo</Label>
            <Select {...field("kind")} {...register("kind")}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {HOOK_KIND_LABELS[k]}
                </option>
              ))}
            </Select>
            {helper(
              "kind",
              kind === "MCP"
                ? "Se invoca una herramienta por JSON-RPC (Streamable HTTP)."
                : "Se hace un POST JSON al endpoint con firma HMAC.",
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="hook-targetUrl">{kind === "MCP" ? "URL del servidor MCP" : "URL del endpoint"}</Label>
          <Input
            placeholder={kind === "MCP" ? "https://mcp.tu-empresa.com/mcp" : "https://api.tu-empresa.com/webhooks/easysell"}
            inputMode="url"
            autoComplete="off"
            {...field("targetUrl")}
            {...register("targetUrl")}
          />
          {helper("targetUrl", "Debe ser pública (dominio real, https). No se aceptan IPs privadas ni redes internas.")}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="hook-description">Descripción (opcional)</Label>
          <Input placeholder="Sincroniza pedidos pagados con el ERP" autoComplete="off" {...field("description")} {...register("description")} />
          {helper("description", "Una línea para el equipo.")}
        </div>

        <fieldset className="space-y-3 rounded-md border bg-card p-3">
          <legend className="px-1 text-sm font-medium">Autenticación</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="hook-authType">Método</Label>
              <Select {...field("authType")} {...register("authType")}>
                {AUTH_TYPES.map((a) => (
                  <option key={a} value={a}>
                    {AUTH_TYPE_LABELS[a]}
                  </option>
                ))}
              </Select>
              {helper("authType", "Toda entrega lleva además la firma HMAC en X-EasySell-Signature.")}
            </div>
            {authType === "API_KEY_HEADER" ? (
              <div className="space-y-1.5">
                <Label htmlFor="hook-authHeaderName">Nombre del header</Label>
                <Input placeholder="X-API-Key" autoComplete="off" {...field("authHeaderName")} {...register("authHeaderName")} />
                {helper("authHeaderName", "Vacío = X-API-Key.")}
              </div>
            ) : null}
          </div>
          {needsCredential ? (
            <div className="space-y-1.5">
              <Label htmlFor="hook-credential">
                {authType === "BEARER" ? "Token" : authType === "BASIC" ? "Usuario y contraseña" : "API key"}
              </Label>
              <Input
                type="password"
                autoComplete="new-password"
                placeholder={
                  hook?.hasCredential && hook.authType === authType
                    ? "Sin cambios (guardada y cifrada)"
                    : authType === "BASIC"
                      ? "usuario:contraseña"
                      : "Pega aquí la credencial"
                }
                {...field("credential")}
                {...register("credential")}
              />
              {helper("credential", "Se guarda cifrada y nunca se vuelve a mostrar.")}
            </div>
          ) : null}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Eventos</legend>
          <p className="text-xs text-muted-foreground">
            Marca lo que quieres recibir. Cada evento llega con un sobre <code className="font-mono">{"{ id, event, occurredAt, tenantId, data, version }"}</code>;
            abre «ejemplo» para ver el <code className="font-mono">data</code> de cada uno.
          </p>
          {events.isLoading ? <p className="text-xs text-muted-foreground">Cargando catálogo…</p> : null}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {grouped.map(([group, defs]) => (
              <div key={group} className="rounded-md border bg-card p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group}</p>
                <div className="space-y-2">
                  {defs.map((def) => (
                    <EventOption
                      key={def.name}
                      def={def}
                      checked={selected.includes(def.name)}
                      onChange={(checked) =>
                        setValue(
                          "events",
                          checked ? [...selected, def.name] : selected.filter((s) => s !== def.name),
                          { shouldDirty: true, shouldValidate: true },
                        )
                      }
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          {errors.events ? <p className="text-xs text-destructive">{errors.events.message}</p> : null}
        </fieldset>

        {kind === "MCP" ? (
          <fieldset className="space-y-3 rounded-md border bg-card p-3">
            <legend className="px-1 text-sm font-medium">Herramienta MCP</legend>
            <div className="space-y-1.5">
              <Label htmlFor="hook-toolName">Nombre de la herramienta</Label>
              <Input placeholder="registrar_pedido" autoComplete="off" {...field("toolName")} {...register("toolName")} />
              {helper("toolName", "Se invoca con tools/call tras initialize.")}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hook-argsTemplateText">Argumentos (plantilla JSON, opcional)</Label>
              <Textarea
                rows={6}
                className="font-mono text-xs"
                placeholder={'{\n  "orderId": "{{event.data.orderId}}",\n  "total": "{{event.data.total}}",\n  "nota": "Pedido {{event.data.orderId}} desde Easy Sell"\n}'}
                {...field("argsTemplateText")}
                {...register("argsTemplateText")}
              />
              {helper(
                "argsTemplateText",
                "Placeholders {{event.…}} sobre el sobre del evento; {{data.…}} es un atajo de {{event.data.…}}. Vacío = se manda { event } completo.",
              )}
            </div>
          </fieldset>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="hook-headersText">Headers extra (opcional)</Label>
          <Textarea
            rows={3}
            className="font-mono text-xs"
            placeholder={"X-Tenant: mi-empresa\nX-Source: easysell"}
            {...field("headersText")}
            {...register("headersText")}
          />
          {helper("headersText", "Uno por línea, «Nombre: valor». Host, Content-Type y los X-EasySell-* los pone la plataforma.")}
        </div>

        <fieldset className="space-y-3 rounded-md border bg-card p-3">
          <legend className="flex items-center gap-1 px-1 text-sm font-medium">
            Reintentos
            <InfoTip
              label="Reintentos"
              text="Si tu servidor no responde 2xx, se reintenta con espera exponencial: base, base×2, base×4… hasta agotar los intentos; entonces la entrega queda agotada y puedes reintentarla a mano."
            />
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="hook-maxAttempts">Intentos máximos</Label>
              <Input inputMode="numeric" {...field("maxAttempts")} {...register("maxAttempts")} />
              {helper("maxAttempts", "De 1 a 10.")}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hook-backoffSeconds">Espera base (segundos)</Label>
              <Input inputMode="numeric" {...field("backoffSeconds")} {...register("backoffSeconds")} />
              {helper("backoffSeconds", "De 5 a 3600. Con 30: 30 s, 60 s, 120 s…")}
            </div>
          </div>
        </fieldset>
      </form>

      <div className="flex items-center justify-end gap-2 border-t bg-background px-6 py-3">
        <Button type="submit" size="sm" loading={save.isPending} onClick={handleSubmit(onSubmit)}>
          {save.isPending ? "Guardando…" : hook ? "Guardar cambios" : "Crear hook"}
        </Button>
      </div>
    </>
  );
}

function EventOption({
  def,
  checked,
  onChange,
}: {
  def: HookEventDefinition;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const [showExample, setShowExample] = useState(false);
  const id = `hook-event-${def.name.replace(/\./g, "-")}`;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="flex cursor-pointer items-start gap-2 text-sm">
        <Checkbox id={id} checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} className="mt-0.5" />
        <span className="min-w-0">
          <span className="block font-mono text-xs font-medium">{def.name}</span>
          <span className="block text-xs text-muted-foreground">{def.description}</span>
        </span>
      </label>
      <button
        type="button"
        className="ml-6 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setShowExample((v) => !v)}
        aria-expanded={showExample}
      >
        {showExample ? <ChevronDown aria-hidden className="h-3 w-3" /> : <ChevronRight aria-hidden className="h-3 w-3" />}
        {showExample ? "Ocultar ejemplo" : "Ver ejemplo"}
      </button>
      {showExample ? (
        <pre className="ml-6 max-h-56 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] leading-snug">
          {JSON.stringify(def.example, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Historial de entregas
// ---------------------------------------------------------------------------

const DELIVERY_FILTERS: Array<{ value: DeliveryStatus | ""; label: string }> = [
  { value: "", label: "Todas" },
  { value: "PENDING", label: DELIVERY_STATUS_LABELS.PENDING },
  { value: "SUCCESS", label: DELIVERY_STATUS_LABELS.SUCCESS },
  { value: "FAILED", label: DELIVERY_STATUS_LABELS.FAILED },
  { value: "DEAD", label: DELIVERY_STATUS_LABELS.DEAD },
];

function DeliveriesSheet({
  hook,
  canWrite,
  onOpenChange,
  onTest,
  testing,
}: {
  hook: OutboundHook | null;
  canWrite: boolean;
  onOpenChange: (open: boolean) => void;
  onTest: (hook: OutboundHook) => void;
  testing: boolean;
}) {
  return (
    <Sheet open={hook !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" title="Entregas" className="flex w-full flex-col gap-0 p-0 sm:max-w-3xl">
        {hook ? <DeliveriesPanel key={hook.id} hook={hook} canWrite={canWrite} onTest={onTest} testing={testing} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function DeliveriesPanel({
  hook,
  canWrite,
  onTest,
  testing,
}: {
  hook: OutboundHook;
  canWrite: boolean;
  onTest: (hook: OutboundHook) => void;
  testing: boolean;
}) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<DeliveryStatus | "">("");
  const [pages, setPages] = useState<HookDelivery[][]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const key = deliveriesKey(hook.id, status);
  const first = useQuery({
    queryKey: key,
    queryFn: async () => {
      const res = await api.get<{ data: { items: HookDelivery[]; pageInfo: { nextCursor: string | null } } }>(
        `/hooks/${hook.id}/deliveries`,
        { params: { ...(status ? { status } : {}), limit: 25 } },
      );
      return res.data.data;
    },
  });

  const loadMore = useMutation({
    mutationFn: async (after: string) => {
      const res = await api.get<{ data: { items: HookDelivery[]; pageInfo: { nextCursor: string | null } } }>(
        `/hooks/${hook.id}/deliveries`,
        { params: { ...(status ? { status } : {}), cursor: after, limit: 25 } },
      );
      return res.data.data;
    },
    onSuccess: (page) => {
      setPages((prev) => [...prev, page.items]);
      setCursor(page.pageInfo.nextCursor);
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo cargar más")),
  });

  const retry = useMutation({
    mutationFn: async (delivery: HookDelivery) => {
      const res = await api.post<{ data: HookDelivery }>(`/hooks/deliveries/${delivery.id}/retry`);
      return res.data.data;
    },
    onSuccess: async (delivery) => {
      if (delivery.status === "SUCCESS") toast.success(`Entrega reintentada: ${describeDeliveryResult(delivery)}`);
      else toast.error(`El reintento falló: ${describeDeliveryResult(delivery)}`);
      setPages([]);
      setCursor(null);
      await queryClient.invalidateQueries({ queryKey: ["outbound-hook-deliveries", hook.id] });
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo reintentar")),
  });

  const rows = useMemo(() => [...(first.data?.items ?? []), ...pages.flat()], [first.data, pages]);
  const nextCursor = pages.length > 0 ? cursor : (first.data?.pageInfo.nextCursor ?? null);

  const columns: Array<DataTableColumn<HookDelivery>> = [
    {
      key: "event",
      header: "Evento",
      cell: (d) => (
        <span className="flex items-center gap-1.5">
          {expanded === d.id ? (
            <ChevronDown aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span className="font-mono text-xs">{d.eventName}</span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Estado",
      width: "10rem",
      cell: (d) => <StatusBadge status={d.status} tone={DELIVERY_STATUS_TONES[d.status]} label={DELIVERY_STATUS_LABELS[d.status]} />,
    },
    { key: "attempt", header: "Intentos", width: "5rem", numeric: true, cell: (d) => d.attempt },
    {
      key: "result",
      header: "Resultado",
      cell: (d) => (
        <span className="block max-w-[16rem] truncate text-xs text-muted-foreground" title={describeDeliveryResult(d)}>
          {describeDeliveryResult(d)}
        </span>
      ),
    },
    {
      key: "createdAt",
      header: "Creada",
      width: "10rem",
      cell: (d) => <DateTime value={d.createdAt} className="text-muted-foreground" />,
    },
    {
      key: "actions",
      header: <span className="sr-only">Acciones</span>,
      width: "6rem",
      className: "text-right",
      cell: (d) =>
        canWrite && d.status !== "SUCCESS" ? (
          <Button
            variant="outline"
            size="sm"
            aria-label={`Reintentar entrega de ${d.eventName}`}
            loading={retry.isPending && retry.variables?.id === d.id}
            onClick={(e) => {
              e.stopPropagation();
              retry.mutate(d);
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Reintentar
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <SheetHeader className="border-b px-6 py-4">
        <SheetTitle>Entregas de «{hook.name}»</SheetTitle>
        <SheetDescription>
          Historial de envíos a {shortUrl(hook.targetUrl, 60)}. Toca una fila para ver el payload y la respuesta.
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-wrap items-center gap-2 border-b px-6 py-3">
        <Label htmlFor="deliveries-status" className="sr-only">
          Filtrar por estado
        </Label>
        <div className="w-48">
          <Select
            id="deliveries-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as DeliveryStatus | "");
              setPages([]);
              setCursor(null);
              setExpanded(null);
            }}
          >
            {DELIVERY_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void first.refetch()} aria-label="Actualizar historial">
          <History className="h-3.5 w-3.5" />
          Actualizar
        </Button>
        {canWrite ? (
          <Button variant="outline" size="sm" className="ml-auto" loading={testing} onClick={() => onTest(hook)}>
            <Send className="h-3.5 w-3.5" />
            Probar (enviar ping)
          </Button>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto">
        <DataTable
          columns={columns}
          rows={rows}
          isLoading={first.isLoading}
          isError={first.isError}
          error={first.error}
          onRetry={() => void first.refetch()}
          caption={`Entregas de ${hook.name}`}
          onRowClick={(d) => setExpanded((cur) => (cur === d.id ? null : d.id))}
          empty={{
            icon: <History className="h-6 w-6" />,
            title: status ? "Sin entregas con ese estado" : "Todavía no hay entregas",
            description: status
              ? "Prueba con otro filtro."
              : "Cuando ocurra uno de los eventos suscritos (o pulses «Probar») verás aquí cada intento con su respuesta.",
          }}
        />
        {expanded ? <DeliveryDetail deliveryId={expanded} /> : null}
        {nextCursor ? (
          <div className="flex justify-center border-t px-6 py-3">
            <Button variant="outline" size="sm" loading={loadMore.isPending} onClick={() => loadMore.mutate(nextCursor)}>
              Cargar más
            </Button>
          </div>
        ) : null}
      </div>
    </>
  );
}

function DeliveryDetail({ deliveryId }: { deliveryId: string }) {
  const detail = useQuery({
    queryKey: ["outbound-hook-delivery", deliveryId],
    queryFn: async () => {
      const res = await api.get<{ data: HookDelivery }>(`/hooks/deliveries/${deliveryId}`);
      return res.data.data;
    },
  });
  const d = detail.data;
  return (
    <div className="space-y-3 border-t bg-muted/40 px-6 py-4 text-xs" aria-live="polite">
      {detail.isLoading ? <p className="text-muted-foreground">Cargando entrega…</p> : null}
      {detail.isError ? <p className="text-destructive">{apiErrorMessage(detail.error, "No se pudo cargar la entrega")}</p> : null}
      {d ? (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            <dt className="text-muted-foreground">Id de entrega</dt>
            <dd className="font-mono">{d.id}</dd>
            <dt className="text-muted-foreground">Id de evento</dt>
            <dd className="font-mono">{d.eventId}</dd>
            <dt className="text-muted-foreground">Respuesta HTTP</dt>
            <dd>{d.responseStatus ?? "—"}</dd>
            <dt className="text-muted-foreground">Duración</dt>
            <dd>{d.durationMs !== null ? `${d.durationMs} ms` : "—"}</dd>
            <dt className="text-muted-foreground">Siguiente intento</dt>
            <dd>{d.status === "FAILED" ? <DateTime value={d.nextAttemptAt} /> : "—"}</dd>
            <dt className="text-muted-foreground">Entregada</dt>
            <dd>{d.deliveredAt ? <DateTime value={d.deliveredAt} /> : "—"}</dd>
          </dl>
          {d.error ? <p className="text-destructive">Error: {d.error}</p> : null}
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <p className="mb-1 font-medium">Payload enviado</p>
              <pre className="max-h-64 overflow-auto rounded-md bg-background p-2 font-mono text-[11px] leading-snug">
                {JSON.stringify(d.payload ?? null, null, 2)}
              </pre>
            </div>
            <div>
              <p className="mb-1 font-medium">Respuesta (primeros 2 KB)</p>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-background p-2 font-mono text-[11px] leading-snug">
                {d.responseBody || "(sin cuerpo)"}
              </pre>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
