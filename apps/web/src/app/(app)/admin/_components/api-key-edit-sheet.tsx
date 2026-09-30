"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { apiErrorMessage } from "./api-error";
import { ScopePicker } from "./api-key-scope-picker";
import { fromDateInputValue, toDateInputValue, type ApiKey } from "./api-key-helpers";

/**
 * `PATCH {basePath}/:id` — renombrar, cambiar permisos y vencimiento. Solo se
 * manda lo que cambió: el backend audita el diff (`apikey.updated`).
 */
export function ApiKeyEditSheet({
  basePath,
  scopesMode,
  apiKey,
  open,
  onOpenChange,
  onSaved,
}: {
  basePath: string;
  scopesMode: "choose" | "all";
  apiKey: ApiKey | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" title="Editar API key" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        {apiKey ? (
          <EditForm
            key={apiKey.id}
            basePath={basePath}
            scopesMode={scopesMode}
            apiKey={apiKey}
            onSaved={() => {
              onSaved();
              onOpenChange(false);
            }}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function EditForm({
  basePath,
  scopesMode,
  apiKey,
  onSaved,
}: {
  basePath: string;
  scopesMode: "choose" | "all";
  apiKey: ApiKey;
  onSaved: () => void;
}) {
  const [name, setName] = useState(apiKey.name);
  const [scopes, setScopes] = useState<string[]>(apiKey.scopes);
  const [neverExpires, setNeverExpires] = useState(apiKey.expiresAt === null);
  const [expiresOn, setExpiresOn] = useState(toDateInputValue(apiKey.expiresAt));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
  }, [name, scopes, neverExpires, expiresOn]);

  const save = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await api.patch<{ data: ApiKey }>(`${basePath}/${apiKey.id}`, body);
      return res.data.data;
    },
    onSuccess: () => {
      toast.success("API key actualizada");
      onSaved();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "No se pudo guardar")),
  });

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Ponle un nombre a la key");
      return;
    }
    if (scopesMode === "choose" && scopes.length === 0) {
      setError("Marca al menos un permiso");
      return;
    }
    const body: Record<string, unknown> = {};
    if (trimmed !== apiKey.name) body.name = trimmed;
    if (scopesMode === "choose") {
      const same = scopes.length === apiKey.scopes.length && scopes.every((s) => apiKey.scopes.includes(s));
      if (!same) body.scopes = scopes;
    }
    const nextExpiresAt = neverExpires ? null : fromDateInputValue(expiresOn);
    if (!neverExpires && !nextExpiresAt) {
      setError("Elige una fecha de vencimiento o marca “Sin vencimiento”");
      return;
    }
    if (!neverExpires && nextExpiresAt && new Date(nextExpiresAt).getTime() <= Date.now()) {
      setError("La fecha de vencimiento debe estar en el futuro");
      return;
    }
    const currentDay = toDateInputValue(apiKey.expiresAt);
    const nextDay = nextExpiresAt ? toDateInputValue(nextExpiresAt) : "";
    if (currentDay !== nextDay) body.expiresAt = nextExpiresAt;

    if (Object.keys(body).length === 0) {
      toast.message("Sin cambios");
      onSaved();
      return;
    }
    save.mutate(body);
  }

  return (
    <>
      <SheetHeader className="border-b px-6 py-4">
        <SheetTitle>Editar API key</SheetTitle>
        <SheetDescription>
          <span className="font-mono text-xs">{apiKey.prefix}</span> · El secreto no cambia; para eso usa
          Rotar.
        </SheetDescription>
      </SheetHeader>

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-4"
      >
        <div className="space-y-1.5">
          <Label htmlFor="edit-key-name">Nombre</Label>
          <Input
            id="edit-key-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            maxLength={100}
          />
        </div>

        {scopesMode === "choose" ? (
          <ScopePicker idPrefix={`edit-${apiKey.id.slice(0, 8)}`} selected={scopes} onChange={setScopes} />
        ) : (
          <p className="rounded-md border bg-warning-subtle p-3 text-xs text-warning-foreground">
            Key global: siempre con todos los permisos. Aquí solo se cambia el nombre y el vencimiento.
          </p>
        )}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Vencimiento</legend>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={neverExpires} onChange={(e) => setNeverExpires(e.currentTarget.checked)} />
            Sin vencimiento
          </label>
          {!neverExpires ? (
            <div className="space-y-1.5">
              <Label htmlFor="edit-key-expires">Expira el</Label>
              <Input
                id="edit-key-expires"
                type="date"
                value={expiresOn}
                onChange={(e) => setExpiresOn(e.target.value)}
                min={toDateInputValue(new Date().toISOString())}
              />
              <p className="text-xs text-muted-foreground">La key deja de valer al terminar ese día.</p>
            </div>
          ) : null}
        </fieldset>

        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </form>

      <div className="flex items-center justify-end gap-2 border-t bg-background px-6 py-3">
        <Button type="button" size="sm" loading={save.isPending} onClick={submit}>
          Guardar cambios
        </Button>
      </div>
    </>
  );
}
