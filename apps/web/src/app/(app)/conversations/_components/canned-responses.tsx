"use client";
import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SkeletonText } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { usePermissions } from "@/components/app/use-permissions";
import {
  WHATSAPP_TEXT_MAX,
  useCannedResponses,
  useCreateCannedResponse,
  useDeleteCannedResponse,
  useUpdateCannedResponse,
  type CannedResponse,
  type CannedResponseInput,
} from "./use-conversations";
import { Tip } from "@/components/app/info-tip";

/** Coincidencia por atajo (prefijo) o título (contiene), sin acentos ni mayúsculas. */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function filterCanned(items: CannedResponse[], query: string): CannedResponse[] {
  const q = normalize(query.replace(/^\//, "").trim());
  if (!q) return items;
  return items.filter(
    (c) => normalize(c.shortcut).startsWith(q) || normalize(c.title).includes(q),
  );
}

/**
 * Lista flotante de respuestas rápidas que abre el redactor al teclear `/` al
 * inicio del mensaje. Quien la usa navega con ↑/↓, inserta con Enter o Tab y
 * cierra con Esc; el texto tras la `/` filtra por atajo o título.
 *
 * El componente es controlado: recibe la `query` (lo que va después de `/`)
 * y avisa con `onPick` / `onClose`; el redactor sigue siendo dueño del foco
 * (el teclado se maneja desde su `onKeyDown`, aquí solo se pinta y se expone
 * `activeIndex` vía `onActiveChange`).
 */
export function CannedResponsePicker({
  query,
  activeIndex,
  onActiveChange,
  onPick,
  onManage,
  id,
}: {
  query: string;
  activeIndex: number;
  onActiveChange: (index: number) => void;
  onPick: (item: CannedResponse) => void;
  onManage?: () => void;
  id: string;
}) {
  const canned = useCannedResponses();
  const items = useMemo(() => filterCanned(canned.data ?? [], query).slice(0, 8), [canned.data, query]);

  // Mantener el índice dentro de la lista al cambiar el filtro.
  useEffect(() => {
    if (activeIndex >= items.length) onActiveChange(Math.max(0, items.length - 1));
  }, [items.length, activeIndex, onActiveChange]);

  return (
    <div
      id={id}
      role="listbox"
      aria-label="Respuestas rápidas"
      className="absolute bottom-full left-0 right-0 z-30 mb-2 max-h-72 overflow-y-auto rounded-card border border-border bg-card p-1 shadow-airbnb-lg"
    >
      <div className="flex items-center justify-between gap-2 px-2 py-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Zap aria-hidden className="h-3 w-3" />
          Respuestas rápidas · ↑↓ elegir · Enter insertar · Esc cerrar
        </span>
        {onManage ? (
          <button
            type="button"
            className="rounded font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onManage}
          >
            Administrar
          </button>
        ) : null}
      </div>
      {canned.isLoading ? (
        <div className="px-2 py-1">
          <SkeletonText lines={2} />
        </div>
      ) : canned.isError ? (
        <p className="px-2 py-1 text-xs text-destructive">No se pudieron cargar las respuestas rápidas.</p>
      ) : items.length === 0 ? (
        <p className="px-2 py-2 text-xs text-muted-foreground">
          {canned.data && canned.data.length === 0
            ? "Aún no hay respuestas rápidas. Créalas en \"Administrar\"."
            : "Ninguna coincide."}
        </p>
      ) : (
        <ul>
          {items.map((item, i) => (
            <li key={item.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === activeIndex}
                id={`${id}-opt-${i}`}
                // `onMouseDown` con preventDefault: que el textarea no pierda el foco al hacer clic.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => onActiveChange(i)}
                onClick={() => onPick(item)}
                className={cn(
                  "flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left focus-visible:outline-none",
                  i === activeIndex ? "bg-accent" : "hover:bg-muted",
                )}
              >
                <span className="flex w-full items-baseline gap-2">
                  <span className="font-mono text-code-sm text-primary">/{item.shortcut}</span>
                  <span className="truncate text-sm font-medium text-foreground">{item.title}</span>
                </span>
                <span className="line-clamp-2 text-xs text-muted-foreground">{item.body}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const EMPTY_FORM: CannedResponseInput = { shortcut: "", title: "", body: "" };

function CannedForm({
  initial,
  pending,
  onSubmit,
  onCancel,
}: {
  initial: CannedResponseInput;
  pending: boolean;
  onSubmit: (input: CannedResponseInput) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(initial);
  const shortcutOk = /^[a-z0-9][a-z0-9_-]{0,29}$/.test(form.shortcut);
  const valid = shortcutOk && form.title.trim().length > 0 && form.body.trim().length > 0 && form.body.length <= WHATSAPP_TEXT_MAX;
  return (
    <form
      className="space-y-3 rounded-card border border-border bg-background p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onSubmit({ shortcut: form.shortcut.trim(), title: form.title.trim(), body: form.body.trim() });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="canned-shortcut">Atajo</Label>
          <div className="relative">
            <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-muted-foreground">
              /
            </span>
            <Input
              id="canned-shortcut"
              value={form.shortcut}
              onChange={(e) => setForm({ ...form, shortcut: e.target.value.toLowerCase().replace(/^\//, "") })}
              placeholder="gracias"
              maxLength={30}
              className="pl-6 font-mono"
              aria-invalid={form.shortcut.length > 0 && !shortcutOk ? true : undefined}
              autoComplete="off"
            />
          </div>
          <p className="text-xs text-muted-foreground">Minúsculas, números, guion o guion bajo. Sin espacios.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="canned-title">Título</Label>
          <Input
            id="canned-title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Agradecimiento"
            maxLength={80}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="canned-body">Texto que se envía</Label>
        <Textarea
          id="canned-body"
          rows={4}
          value={form.body}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
          placeholder="¡Gracias por escribirnos! En un momento te atendemos."
          maxLength={WHATSAPP_TEXT_MAX}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" disabled={!valid} loading={pending}>
          Guardar
        </Button>
      </div>
    </form>
  );
}

/**
 * Administración de respuestas rápidas del equipo (hoja lateral). Vive junto
 * al redactor porque es donde se descubren: "/" → "Administrar".
 */
export function CannedResponsesSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const canned = useCannedResponses(open);
  const create = useCreateCannedResponse();
  const update = useUpdateCannedResponse();
  const remove = useDeleteCannedResponse();
  const canWrite = usePermissions().can("chat.write");
  const [mode, setMode] = useState<{ kind: "idle" } | { kind: "new" } | { kind: "edit"; item: CannedResponse }>({ kind: "idle" });
  const [confirmDelete, setConfirmDelete] = useState<CannedResponse | null>(null);

  useEffect(() => {
    if (!open) setMode({ kind: "idle" });
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Respuestas rápidas</SheetTitle>
          <SheetDescription>
            Textos listos para insertar en el redactor escribiendo <span className="font-mono">/atajo</span>.
            Las comparte todo el equipo.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          {canWrite && mode.kind === "idle" ? (
            <Button size="sm" onClick={() => setMode({ kind: "new" })}>
              <Plus aria-hidden className="h-3.5 w-3.5" />
              Nueva respuesta rápida
            </Button>
          ) : null}
          {mode.kind === "new" ? (
            <CannedForm
              initial={EMPTY_FORM}
              pending={create.isPending}
              onCancel={() => setMode({ kind: "idle" })}
              onSubmit={(input) => create.mutate(input, { onSuccess: () => setMode({ kind: "idle" }) })}
            />
          ) : null}
          {mode.kind === "edit" ? (
            <CannedForm
              initial={{ shortcut: mode.item.shortcut, title: mode.item.title, body: mode.item.body }}
              pending={update.isPending}
              onCancel={() => setMode({ kind: "idle" })}
              onSubmit={(input) =>
                update.mutate({ id: mode.item.id, ...input }, { onSuccess: () => setMode({ kind: "idle" }) })
              }
            />
          ) : null}

          {canned.isLoading ? (
            <SkeletonText lines={4} announce label="Cargando respuestas rápidas…" />
          ) : canned.isError ? (
            <p className="text-sm text-destructive">
              No se pudieron cargar.{" "}
              <button type="button" className="underline" onClick={() => void canned.refetch()}>
                Reintentar
              </button>
            </p>
          ) : !canned.data || canned.data.length === 0 ? (
            mode.kind === "idle" ? (
              <EmptyState
                icon={<Zap className="h-6 w-6" />}
                title="Sin respuestas rápidas"
                description="Crea la primera: por ejemplo /horario con el horario de atención."
              />
            ) : null
          ) : (
            <ul className="space-y-2">
              {canned.data.map((item) => (
                <li key={item.id} className="rounded-card border border-border bg-card px-3 py-2">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-baseline gap-2">
                        <span className="font-mono text-code-sm text-primary">/{item.shortcut}</span>
                        <span className="truncate text-sm font-medium">{item.title}</span>
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-muted-foreground">{item.body}</p>
                    </div>
                    {canWrite ? (
                      <div className="flex shrink-0 items-center gap-1">
                        <Tip label={`Editar /${item.shortcut}`}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label={`Editar /${item.shortcut}`}
                            onClick={() => setMode({ kind: "edit", item })}
                          >
                            <Pencil aria-hidden className="h-3.5 w-3.5" />
                          </Button>
                        </Tip>
                        <Tip label={`Eliminar /${item.shortcut}`}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            aria-label={`Eliminar /${item.shortcut}`}
                            onClick={() => setConfirmDelete(item)}
                          >
                            <Trash2 aria-hidden className="h-3.5 w-3.5" />
                          </Button>
                        </Tip>
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <ConfirmDialog
          open={!!confirmDelete}
          onOpenChange={(o) => !o && setConfirmDelete(null)}
          title={`¿Eliminar /${confirmDelete?.shortcut ?? ""}?`}
          description="Nadie del equipo podrá volver a insertarla. Los mensajes ya enviados no cambian."
          confirmLabel="Eliminar"
          pending={remove.isPending}
          onConfirm={() => {
            if (!confirmDelete) return;
            remove.mutate(confirmDelete.id, { onSuccess: () => setConfirmDelete(null) });
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
