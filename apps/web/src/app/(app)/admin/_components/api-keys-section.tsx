"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Activity, Copy, KeyRound, MoreHorizontal, Pencil, Plus, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Section } from "@/components/app/section";
import { InfoTip, Tip } from "@/components/app/info-tip";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { DateTime, formatDateTimeLong } from "@/components/app/date-time";
import { EntityId } from "@/components/app/entity-id";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { apiErrorMessage } from "./api-error";
import {
  API_KEY_STATUS_LABELS,
  API_KEY_STATUS_TONES,
  formatRelativeTime,
  isApiKeyMutable,
  type ApiKey,
} from "./api-key-helpers";
import { ScopePicker } from "./api-key-scope-picker";
import { ApiKeyUsageSheet } from "./api-key-usage-sheet";
import { ApiKeyEditSheet } from "./api-key-edit-sheet";
import { ApiKeyRotateDialog } from "./api-key-rotate-dialog";

const DEFAULT_BASE_PATH = "/iam/api-keys";

/** La caché se parte por ruta: las keys de /admin y las de cada empresa en
 * /super-admin son listas distintas aunque el componente sea el mismo. */
export const apiKeysQueryKey = (basePath: string, includeRevoked = false) =>
  ["api-keys", basePath, includeRevoked] as const;

export interface ApiKeysSectionProps {
  /**
   * Prefijo del recurso. Por defecto el tenant-scoped `/iam/api-keys`; el
   * super-admin pasa `/super-admin/tenants/:id/api-keys` para operar sobre
   * otra empresa, o `/super-admin/api-keys` para keys globales. Toda llamada
   * y la query key derivan de aquí.
   */
  basePath?: string;
  title?: string;
  description?: string;
  /**
   * "choose" (default): el formulario deja marcar scopes y los manda en el
   * body, como `/iam/api-keys` y `/super-admin/tenants/:id/api-keys`.
   * "all": oculta el selector — es una key GLOBAL (T-IAM-09b), siempre con
   * TODOS los scopes decididos por el backend
   * (`ApiKeyService.createGlobal`); mandar `scopes` en el body de
   * `POST /super-admin/api-keys` lo rechaza el ValidationPipe
   * (`forbidNonWhitelisted`), así que el form ni lo intenta.
   */
  scopesMode?: "choose" | "all";
}

/**
 * `scopes` es opcional en el esquema: con scopesMode "all" el form no lo
 * pinta y nunca lo manda. Con "choose" sí es obligatorio, pero eso se exige
 * a mano en el submit (ver `CreateApiKeyForm`) — un `.min(1)` condicional
 * al modo no se puede expresar limpio en un solo `z.object` estático.
 */
const schema = z.object({
  name: z.string().trim().min(1, "Ponle un nombre a la key").max(100, "Máximo 100 caracteres"),
  scopes: z.array(z.string()).optional(),
  expiresInDays: z
    .string()
    .trim()
    .refine(
      (v) => v === "" || (/^\d+$/.test(v) && Number(v) > 0 && Number(v) <= 730),
      "Días enteros entre 1 y 730, o vacío",
    ),
});

type FormValues = z.infer<typeof schema>;

async function copyToClipboard(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copiada`);
  } catch {
    toast.message(label, { description: text });
  }
}

export function ApiKeysSection({
  basePath = DEFAULT_BASE_PATH,
  title = "API keys",
  description = "Credenciales de servidor para integrar sistemas externos.",
  scopesMode = "choose",
}: ApiKeysSectionProps = {}) {
  const queryClient = useQueryClient();
  const [includeRevoked, setIncludeRevoked] = useState(false);
  const queryKey = apiKeysQueryKey(basePath, includeRevoked);
  const [newSecret, setNewSecret] = useState<{ secret: string; note?: string } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);
  const [usageTarget, setUsageTarget] = useState<ApiKey | null>(null);
  const [editTarget, setEditTarget] = useState<ApiKey | null>(null);
  const [rotateTarget, setRotateTarget] = useState<ApiKey | null>(null);

  const invalidateKeys = () => queryClient.invalidateQueries({ queryKey: ["api-keys", basePath] });

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`${basePath}/${id}`);
    },
    onSuccess: async () => {
      toast.success("API key revocada");
      setRevokeTarget(null);
      await invalidateKeys();
    },
    onError: (error) => {
      setRevokeTarget(null);
      toast.error(apiErrorMessage(error, "No se pudo revocar"));
    },
  });

  const keys = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await api.get<{ data: ApiKey[] }>(basePath, {
        params: includeRevoked ? { includeRevoked: "true" } : undefined,
      });
      return res.data.data;
    },
  });

  const columns: Array<DataTableColumn<ApiKey>> = [
    {
      key: "name",
      header: "Nombre",
      cell: (k) => (
        <span className="flex flex-col">
          <span className="font-medium">{k.name}</span>
          <EntityId
            value={k.prefix}
            length={k.prefix.length}
            copyLabel={`Copiar prefijo de ${k.name}`}
            toastLabel="Prefijo"
            className="text-xs text-muted-foreground"
          />
        </span>
      ),
    },
    {
      key: "scopes",
      header: (
        <span className="inline-flex items-center gap-1">
          Permisos
          <InfoTip label="Permisos" text="Lo único que esta key puede hacer. Edítala para ampliarlos o acotarlos." />
        </span>
      ),
      cell: (k) =>
        scopesMode === "all" ? (
          <Badge variant="warning" size="sm" className="font-medium">
            Todos (global)
          </Badge>
        ) : k.scopes.length > 0 ? (
          <span className="flex max-w-xs flex-wrap gap-1">
            {k.scopes.map((s) => (
              <Badge key={s} variant="neutral" size="sm" className="font-mono font-medium">
                {s}
              </Badge>
            ))}
          </span>
        ) : (
          <>
            <span aria-hidden className="text-muted-foreground">
              —
            </span>
            <span className="sr-only">Sin permisos</span>
          </>
        ),
    },
    {
      key: "createdBy",
      header: "Creada por",
      width: "11rem",
      cell: (k) =>
        k.createdBy ? (
          <span className="flex flex-col" title={k.createdBy.email}>
            <span>{k.createdBy.fullName || k.createdBy.email}</span>
            <DateTime value={k.createdAt} withTime={false} className="text-xs text-muted-foreground" />
          </span>
        ) : (
          <span className="flex flex-col">
            <span className="text-muted-foreground">Sistema</span>
            <DateTime value={k.createdAt} withTime={false} className="text-xs text-muted-foreground" />
          </span>
        ),
    },
    {
      key: "expiresAt",
      header: "Expira",
      width: "9rem",
      cell: (k) =>
        k.expiresAt ? (
          <DateTime value={k.expiresAt} withTime={false} className="text-muted-foreground" />
        ) : (
          <span className="text-muted-foreground">Sin vencimiento</span>
        ),
    },
    {
      key: "lastUsedAt",
      header: (
        <span className="inline-flex items-center gap-1">
          Último uso
          <InfoTip label="Último uso" text="Última petición autenticada con esta key (se actualiza como máximo una vez por minuto). Si dice Nunca, ninguna integración la ha usado todavía." />
        </span>
      ),
      width: "9rem",
      cell: (k) => <LastUsed value={k.lastUsedAt} />,
    },
    {
      key: "status",
      header: "Estado",
      width: "7rem",
      cell: (k) => (
        <StatusBadge
          status={k.status}
          size="sm"
          tone={API_KEY_STATUS_TONES[k.status]}
          label={API_KEY_STATUS_LABELS[k.status]}
          title={
            k.status === "ROTATED"
              ? `Rotada. Sigue valiendo hasta ${formatDateTimeLong(k.expiresAt)}.`
              : undefined
          }
        />
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Acciones</span>,
      width: "4rem",
      className: "text-right",
      cell: (k) => (
        <DropdownMenu>
          <Tip label="Acciones">
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Acciones de ${k.name}`}>
                <MoreHorizontal aria-hidden className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
          </Tip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setUsageTarget(k)}>
              <Activity aria-hidden className="h-4 w-4" />
              Ver uso
            </DropdownMenuItem>
            {isApiKeyMutable(k) ? (
              <>
                <DropdownMenuItem onSelect={() => setEditTarget(k)}>
                  <Pencil aria-hidden className="h-4 w-4" />
                  Editar
                </DropdownMenuItem>
                {k.status === "ACTIVE" ? (
                  <DropdownMenuItem onSelect={() => setRotateTarget(k)}>
                    <RefreshCw aria-hidden className="h-4 w-4" />
                    Rotar secreto
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem className="text-destructive" onSelect={() => setRevokeTarget(k)}>
                  Revocar key
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
        title={title}
        headerIcon={<KeyRound className="h-4 w-4" />}
        description={description}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={includeRevoked}
                onChange={(e) => setIncludeRevoked(e.currentTarget.checked)}
                aria-label="Mostrar keys revocadas"
              />
              Mostrar revocadas
            </label>
            <CreateApiKeyButton
              basePath={basePath}
              scopesMode={scopesMode}
              onCreated={(secret) => setNewSecret({ secret })}
              // Si ya había un secreto recién creado, el siguiente sheet se abre
              // reseteado (no muestra el secreto anterior).
              resetKey={newSecret?.secret ?? null}
            />
          </div>
        }
        padded={false}
      >
        <DataTable
          columns={columns}
          rows={keys.data}
          isLoading={keys.isLoading}
          isError={keys.isError}
          error={keys.error}
          onRetry={() => void keys.refetch()}
          getRowClassName={(k) => (isApiKeyMutable(k) ? undefined : "text-muted-foreground")}
          caption="API keys del tenant"
          empty={{
            icon: <KeyRound className="h-6 w-6" />,
            title: includeRevoked ? "Sin API keys" : "Sin API keys activas",
            description:
              "Crea una key para que un sistema externo consulte el catálogo o registre pedidos sin usar tu sesión.",
          }}
        />
      </Section>

      {/*
        Banner persistente que muestra el secreto recién creado o rotado. No vive
        dentro del sheet: si el usuario lo cierra, todavía tiene que poder copiar
        el secreto. Se quita solo cuando crea otra key o cuando pulsa "Ya la guardé".
      */}
      {newSecret ? (
        <div
          className="sticky bottom-4 z-10 mx-auto mt-4 max-w-2xl rounded-lg border border-warning/40 bg-warning-subtle p-4 text-warning-foreground shadow-airbnb-lg"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start gap-3">
            <KeyRound aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Copia esta key ahora: no se muestra de nuevo</p>
              {newSecret.note ? <p className="mt-1 text-xs">{newSecret.note}</p> : null}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="break-all rounded-md bg-background px-2 py-1 font-mono text-xs">
                  {newSecret.secret}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Copiar API key"
                  onClick={() => void copyToClipboard(newSecret.secret, "API key")}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copiar
                </Button>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setNewSecret(null)}>
              Ya la guardé
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title={`¿Revocar "${revokeTarget?.name ?? ""}"?`}
        description="Cualquier integración usando esta key deja de funcionar de inmediato. No se puede deshacer. Si quieres cambiar el secreto sin cortar el servicio, usa Rotar."
        confirmLabel="Revocar"
        pending={revoke.isPending}
        onConfirm={() => {
          if (!revokeTarget) return;
          revoke.mutate(revokeTarget.id);
        }}
      />

      <ApiKeyUsageSheet
        basePath={basePath}
        apiKey={usageTarget}
        open={usageTarget !== null}
        onOpenChange={(open) => !open && setUsageTarget(null)}
      />

      <ApiKeyEditSheet
        basePath={basePath}
        scopesMode={scopesMode}
        apiKey={editTarget}
        open={editTarget !== null}
        onOpenChange={(open) => !open && setEditTarget(null)}
        onSaved={() => void invalidateKeys()}
      />

      <ApiKeyRotateDialog
        basePath={basePath}
        apiKey={rotateTarget}
        open={rotateTarget !== null}
        onOpenChange={(open) => !open && setRotateTarget(null)}
        onRotated={(rotated) => {
          setNewSecret({
            secret: rotated.secret,
            note:
              rotated.previousKey.graceHours > 0
                ? `La key anterior (${rotated.previousKey.prefix}) sigue valiendo hasta ${formatDateTimeLong(rotated.previousKey.validUntil)}.`
                : `La key anterior (${rotated.previousKey.prefix}) quedó revocada.`,
          });
          void invalidateKeys();
        }}
      />
    </>
  );
}

/** "hace 3 minutos" con el timestamp exacto en el title; "Nunca" si no hay. */
function LastUsed({ value }: { value: string | null }) {
  const relative = formatRelativeTime(value);
  if (!relative) return <span className="text-muted-foreground">Nunca</span>;
  return (
    <time dateTime={value ?? undefined} title={formatDateTimeLong(value)} className="whitespace-nowrap text-muted-foreground">
      {relative}
    </time>
  );
}

/**
 * Botón que abre el sheet de creación. El sheet vive por encima del flujo
 * normal de la página y se cierra solo después de crear: el secreto aparece
 * en un banner persistente abajo para que aún se pueda copiar tras cerrar.
 */
function CreateApiKeyButton({
  basePath,
  scopesMode,
  onCreated,
  resetKey,
}: {
  basePath: string;
  scopesMode: "choose" | "all";
  onCreated: (secret: string) => void;
  resetKey: string | null;
}) {
  const [open, setOpen] = useState(false);
  // Cuando cambia el secreto global, el sheet siguiente arranca limpio.
  // El `key` de React debajo garantiza que el `useForm` se reinicializa.
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm">
          <Plus aria-hidden className="h-3.5 w-3.5" />
          Nueva API key
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        title="Nueva API key"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
      >
        <CreateApiKeyForm
          key={resetKey ?? "fresh"}
          basePath={basePath}
          scopesMode={scopesMode}
          onCreated={(secret) => {
            onCreated(secret);
            setOpen(false);
          }}
        />
      </SheetContent>
    </Sheet>
  );
}

function CreateApiKeyForm({
  basePath,
  scopesMode,
  onCreated,
}: {
  basePath: string;
  scopesMode: "choose" | "all";
  onCreated: (secret: string) => void;
}) {
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", scopes: [], expiresInDays: "" },
  });

  const selectedScopes = watch("scopes") ?? [];

  const create = useMutation({
    mutationFn: async (values: FormValues) => {
      const res = await api.post<{ data: { secret: string } }>(basePath, {
        name: values.name,
        // "all": el DTO de key global no declara `scopes` — mandarlo lo
        // rechaza el ValidationPipe (forbidNonWhitelisted). El backend
        // siempre otorga todos los scopes para esta ruta.
        ...(scopesMode === "choose" ? { scopes: values.scopes } : {}),
        expiresInDays: values.expiresInDays ? Number(values.expiresInDays) : undefined,
      });
      return res.data.data;
    },
    onSuccess: async (data) => {
      toast.success("API key creada");
      reset();
      await queryClient.invalidateQueries({ queryKey: ["api-keys", basePath] });
      onCreated(data.secret);
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo crear la API key")),
  });

  function onSubmit(values: FormValues) {
    // `scopes` es opcional en el esquema (ver comentario junto a `schema`):
    // en modo "choose" el mínimo de uno se exige aquí, no en zod.
    if (scopesMode === "choose" && (values.scopes ?? []).length === 0) {
      setError("scopes", { message: "Marca al menos un permiso" });
      return;
    }
    create.mutate(values);
  }

  return (
    <>
      <SheetHeader className="border-b px-6 py-4">
        <SheetTitle>Nueva API key</SheetTitle>
        <SheetDescription>
          {scopesMode === "all"
            ? "Master key de la plataforma: siempre con todos los permisos. El secreto se muestra una sola vez."
            : "El secreto se muestra una sola vez. Cópialo antes de cerrar."}
        </SheetDescription>
      </SheetHeader>

      <form
        noValidate
        onSubmit={handleSubmit(onSubmit)}
        className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-4"
      >
        <div className="space-y-1.5">
          <Label htmlFor="key-name">Nombre</Label>
          <Input
            id="key-name"
            placeholder="Integración X"
            autoComplete="off"
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? "key-name-error" : "key-name-hint"}
            {...register("name")}
          />
          {errors.name ? (
            <p id="key-name-error" className="text-xs text-destructive">
              {errors.name.message}
            </p>
          ) : (
            <p id="key-name-hint" className="text-xs text-muted-foreground">
              Un nombre que te ayude a identificar para qué sistema es.
            </p>
          )}
        </div>

        {scopesMode === "all" ? (
          <p className="rounded-md border bg-warning-subtle p-3 text-xs text-warning-foreground">
            Esta key siempre lleva todos los permisos del sistema — no se puede acotar. Úsala solo para
            integraciones de plataforma que de verdad necesiten operar sobre cualquier empresa.
          </p>
        ) : (
          <ScopePicker
            idPrefix="scope"
            selected={selectedScopes}
            onChange={(next) => setValue("scopes", next, { shouldDirty: true, shouldValidate: true })}
            error={errors.scopes?.message}
          />
        )}

        <div className="space-y-1.5">
          <Label htmlFor="key-expires">Expira en (días)</Label>
          <Input
            id="key-expires"
            inputMode="numeric"
            placeholder="90"
            autoComplete="off"
            aria-invalid={!!errors.expiresInDays}
            aria-describedby={errors.expiresInDays ? "key-expires-error" : "key-expires-hint"}
            {...register("expiresInDays")}
          />
          {errors.expiresInDays ? (
            <p id="key-expires-error" className="text-xs text-destructive">
              {errors.expiresInDays.message}
            </p>
          ) : (
            <p id="key-expires-hint" className="text-xs text-muted-foreground">
              Opcional. Vacío = sin vencimiento. Máximo 730 días; podrás cambiarlo después.
            </p>
          )}
        </div>
      </form>

      <div className="flex items-center justify-end gap-2 border-t bg-background px-6 py-3">
        <Button
          type="submit"
          size="sm"
          loading={create.isPending}
          onClick={handleSubmit(onSubmit)}
        >
          {create.isPending ? "Creando…" : "Crear API key"}
        </Button>
      </div>
    </>
  );
}
