"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, KeyRound, MoreHorizontal, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { DateTime } from "@/components/app/date-time";
import { EntityId } from "@/components/app/entity-id";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { apiErrorMessage } from "./api-error";

/** `GET /iam/api-keys` (apps/commerce-api/src/auth/api-key.service.ts → list). */
interface ApiKey {
  id: string;
  prefix: string;
  name: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
}

const DEFAULT_BASE_PATH = "/iam/api-keys";

/** La caché se parte por ruta: las keys de /admin y las de cada empresa en
 * /super-admin son listas distintas aunque el componente sea el mismo. */
const apiKeysQueryKey = (basePath: string) => ["api-keys", basePath] as const;

export interface ApiKeysSectionProps {
  /**
   * Prefijo del recurso. Por defecto el tenant-scoped `/iam/api-keys`; el
   * super-admin pasa `/super-admin/tenants/:id/api-keys` para operar sobre
   * otra empresa. Toda llamada y la query key derivan de aquí.
   */
  basePath?: string;
  title?: string;
  description?: string;
}

/** Scopes disponibles, agrupados por dominio para que el sheet sea legible. */
const SCOPE_GROUPS: Array<{ title: string; scopes: string[] }> = [
  { title: "Catálogo", scopes: ["catalog.read", "catalog.write"] },
  { title: "Clientes", scopes: ["customers.read", "customers.write"] },
  { title: "Cotizaciones", scopes: ["quotes.read", "quotes.write"] },
  { title: "Pedidos", scopes: ["orders.read", "orders.write", "orders.cancel_own", "orders.cancel_any"] },
  { title: "Pagos", scopes: ["payments.read", "payments.refund", "payments.export"] },
  { title: "Chat", scopes: ["chat.read", "chat.write"] },
  { title: "Notificaciones", scopes: ["notifications.read", "notifications.write"] },
  { title: "Integraciones", scopes: ["integrations.read", "integrations.write"] },
  { title: "Auditoría", scopes: ["audit.read"] },
  { title: "Administración", scopes: ["tenant.admin", "users.invite", "users.manage", "apikeys.manage"] },
];

const schema = z.object({
  name: z.string().trim().min(1, "Ponle un nombre a la key").max(100, "Máximo 100 caracteres"),
  scopes: z
    .array(z.string())
    .min(1, "Marca al menos un permiso"),
  expiresInDays: z
    .string()
    .trim()
    .refine(
      (v) => v === "" || (/^\d+$/.test(v) && Number(v) > 0),
      "Días enteros mayores a cero, o vacío",
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
}: ApiKeysSectionProps = {}) {
  const queryClient = useQueryClient();
  const queryKey = apiKeysQueryKey(basePath);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`${basePath}/${id}`);
    },
    onSuccess: async () => {
      toast.success("API key revocada");
      setRevokeTarget(null);
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => {
      setRevokeTarget(null);
      toast.error(apiErrorMessage(error, "No se pudo revocar"));
    },
  });

  const keys = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await api.get<{ data: ApiKey[] }>(basePath);
      return res.data.data;
    },
  });

  const columns: Array<DataTableColumn<ApiKey>> = [
    {
      key: "name",
      header: "Nombre",
      cell: (k) => <span className="font-medium">{k.name}</span>,
    },
    {
      key: "prefix",
      header: "Prefijo",
      width: "12rem",
      cell: (k) => (
        <EntityId
          value={k.prefix}
          length={k.prefix.length}
          copyLabel={`Copiar prefijo de ${k.name}`}
          toastLabel="Prefijo"
        />
      ),
    },
    {
      key: "scopes",
      header: "Permisos",
      cell: (k) =>
        k.scopes.length > 0 ? (
          <span className="flex flex-wrap gap-1">
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
      key: "createdAt",
      header: "Creada",
      width: "9rem",
      cell: (k) => <DateTime value={k.createdAt} withTime={false} className="text-muted-foreground" />,
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
      header: "Último uso",
      width: "11rem",
      cell: (k) =>
        k.lastUsedAt ? (
          <DateTime value={k.lastUsedAt} className="text-muted-foreground" />
        ) : (
          <span className="text-muted-foreground">Nunca</span>
        ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Acciones</span>,
      width: "4rem",
      className: "text-right",
      cell: (k) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Acciones de ${k.name}`}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="text-destructive" onSelect={() => setRevokeTarget(k)}>
              Revocar key
            </DropdownMenuItem>
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
          <CreateApiKeyButton
            basePath={basePath}
            onCreated={(secret) => setNewSecret(secret)}
            // Si ya había un secreto recién creado, el siguiente sheet se abre
            // reseteado (no muestra el secreto anterior).
            resetKey={newSecret}
          />
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
          caption="API keys del tenant"
          empty={{
            icon: <KeyRound className="h-6 w-6" />,
            title: "Sin API keys",
            description:
              "Crea una key para que un sistema externo consulte el catálogo o registre pedidos sin usar tu sesión.",
          }}
        />
      </Section>

      {/*
        Banner persistente que muestra el secreto recién creado. No vive dentro
        del sheet: si el usuario lo cierra, todavía tiene que poder copiar el
        secreto. Se quita solo cuando crea otra key o cuando pulsa "Ya la guardé".
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
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="break-all rounded-md bg-background px-2 py-1 font-mono text-xs">
                  {newSecret}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Copiar API key"
                  onClick={() => void copyToClipboard(newSecret, "API key")}
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
        description="Cualquier integración usando esta key deja de funcionar de inmediato. No se puede deshacer."
        confirmLabel="Revocar"
        pending={revoke.isPending}
        onConfirm={() => {
          if (!revokeTarget) return;
          revoke.mutate(revokeTarget.id);
        }}
      />
    </>
  );
}

/**
 * Botón que abre el sheet de creación. El sheet vive por encima del flujo

/**
 * Botón que abre el sheet de creación. El sheet vive por encima del flujo
 * normal de la página y se cierra solo después de crear: el secreto aparece
 * en un banner persistente abajo para que aún se pueda copiar tras cerrar.
 */
function CreateApiKeyButton({
  basePath,
  onCreated,
  resetKey,
}: {
  basePath: string;
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
  onCreated,
}: {
  basePath: string;
  onCreated: (secret: string) => void;
}) {
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", scopes: [], expiresInDays: "" },
  });

  const selectedScopes = watch("scopes");

  const create = useMutation({
    mutationFn: async (values: FormValues) => {
      const res = await api.post<{ data: { secret: string } }>(basePath, {
        name: values.name,
        scopes: values.scopes,
        expiresInDays: values.expiresInDays ? Number(values.expiresInDays) : undefined,
      });
      return res.data.data;
    },
    onSuccess: async (data) => {
      toast.success("API key creada");
      reset();
      await queryClient.invalidateQueries({ queryKey: apiKeysQueryKey(basePath) });
      onCreated(data.secret);
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo crear la API key")),
  });

  return (
    <>
      <SheetHeader className="border-b px-6 py-4">
        <SheetTitle>Nueva API key</SheetTitle>
        <SheetDescription>
          El secreto se muestra una sola vez. Cópialo antes de cerrar.
        </SheetDescription>
      </SheetHeader>

      <form
        noValidate
        onSubmit={handleSubmit((values) => create.mutate(values))}
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

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Permisos</legend>
          <p className="text-xs text-muted-foreground">
            Marca los que necesite la integración. Empieza con los mínimos: leer cuando solo consulta,
            escribir solo cuando registra o modifica datos.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {SCOPE_GROUPS.map((group) => (
              <div key={group.title} className="rounded-md border bg-card p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.title}
                </p>
                <div className="space-y-1.5">
                  {group.scopes.map((scope) => {
                    const id = `scope-${scope.replace(/\./g, "-")}`;
                    const checked = selectedScopes.includes(scope);
                    return (
                      <label
                        key={scope}
                        htmlFor={id}
                        className="flex cursor-pointer items-center gap-2 text-sm"
                      >
                        <Checkbox
                          id={id}
                          checked={checked}
                          onChange={(e) => {
                            const next = e.currentTarget.checked
                              ? [...selectedScopes, scope]
                              : selectedScopes.filter((s) => s !== scope);
                            setValue("scopes", next, { shouldDirty: true, shouldValidate: true });
                          }}
                        />
                        <span className="font-mono text-xs">{scope}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          {errors.scopes && (
            <p className="text-xs text-destructive">{errors.scopes.message}</p>
          )}
        </fieldset>

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
              Opcional. Vacío = sin vencimiento.
            </p>
          )}
        </div>
      </form>

      <div className="flex items-center justify-end gap-2 border-t bg-background px-6 py-3">
        <Button
          type="submit"
          size="sm"
          loading={create.isPending}
          onClick={handleSubmit((values) => create.mutate(values))}
        >
          {create.isPending ? "Creando…" : "Crear API key"}
        </Button>
      </div>
    </>
  );
}