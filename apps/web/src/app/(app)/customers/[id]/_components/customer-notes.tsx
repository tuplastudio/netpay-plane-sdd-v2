"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { StickyNote, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { SkeletonText } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DateTime } from "@/components/app/date-time";
import { Section } from "@/components/app/section";
import { TablePager } from "@/components/app/table-pager";
import { usePagedQuery } from "@/components/app/use-paged-query";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { apiErrorMessage } from "@/app/(app)/admin/_components/api-error";
import type { CustomerNote } from "./customer-types";
import { Tip } from "@/components/app/info-tip";

/**
 * Notas internas con autor y fecha (`/customers/:id/notes`). Distintas del
 * campo "Notas" fijo de la ficha: aquí queda la bitácora ("llamó el martes,
 * quiere factura", "no entregar después de las 6"). Nunca las ve el cliente.
 */
export function CustomerNotes({
  customerId,
  canWrite,
  fixedNotes,
}: {
  customerId: string;
  canWrite: boolean;
  /** `Customer.notes`: el texto libre de la ficha, se muestra arriba. */
  fixedNotes: string | null;
}) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [deleting, setDeleting] = useState<CustomerNote | null>(null);

  const list = usePagedQuery<CustomerNote>({
    key: ["customer-notes", customerId],
    path: `/customers/${customerId}/notes`,
    defaultPageSize: 10,
    urlPrefix: "notes",
  });

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["customer-notes", customerId] }),
      qc.invalidateQueries({ queryKey: ["customer-timeline", customerId] }),
      qc.invalidateQueries({ queryKey: ["customer-summary", customerId] }),
    ]);
  };

  const add = useMutation({
    mutationFn: async (text: string) => {
      const res = await api.post<{ data: CustomerNote }>(`/customers/${customerId}/notes`, {
        body: text,
      });
      return res.data.data;
    },
    onSuccess: async () => {
      setBody("");
      toast.success("Nota guardada");
      await invalidate();
    },
    onError: (e) => toast.error(apiErrorMessage(e, "No se pudo guardar la nota")),
  });

  const remove = useMutation({
    mutationFn: async (noteId: string) => {
      await api.delete(`/customers/${customerId}/notes/${noteId}`);
    },
    onSuccess: async () => {
      setDeleting(null);
      toast.success("Nota eliminada");
      await invalidate();
    },
    onError: (e) => toast.error(apiErrorMessage(e, "No se pudo eliminar la nota")),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = body.trim();
    if (!text) {
      toast.error("Escribe algo antes de guardar");
      return;
    }
    add.mutate(text);
  };

  return (
    <div className="space-y-6">
      {fixedNotes ? (
        <Section title="Notas de la ficha" description="Texto fijo del cliente; se edita con «Editar».">
          <p className="whitespace-pre-line text-sm">{fixedNotes}</p>
        </Section>
      ) : null}

      {canWrite ? (
        <Section title="Nueva nota" description="Bitácora interna con autor y fecha. El cliente nunca la ve.">
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="customer-note-body">Nota</Label>
              <Textarea
                id="customer-note-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                maxLength={4000}
                placeholder="Llamó para pedir factura; prefiere entrega por la tarde…"
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" size="sm" loading={add.isPending} disabled={!body.trim()}>
                <StickyNote aria-hidden className="h-3.5 w-3.5" />
                Guardar nota
              </Button>
            </div>
          </form>
        </Section>
      ) : null}

      <Section title="Bitácora" padded={false}>
        {list.isError ? (
          <div className="p-4">
            <Alert variant="destructive">
              <AlertTitle>No se pudieron cargar las notas</AlertTitle>
              <AlertDescription>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => void list.refetch()}>
                  Reintentar
                </Button>
              </AlertDescription>
            </Alert>
          </div>
        ) : list.isLoading ? (
          <div className="p-4">
            <SkeletonText lines={4} announce label="Cargando las notas…" />
          </div>
        ) : !list.rows || list.rows.length === 0 ? (
          <EmptyState
            icon={<StickyNote className="h-6 w-6" />}
            title="Sin notas todavía"
            description={
              canWrite
                ? "Deja aquí lo que el resto del equipo debe saber de este cliente."
                : "Nadie ha dejado notas sobre este cliente."
            }
          />
        ) : (
          <>
            <ol className="divide-y divide-hairline-soft">
              {list.rows.map((n) => (
                <li key={n.id} className="flex items-start justify-between gap-3 px-4 py-3 sm:px-6">
                  <div className="min-w-0 space-y-1">
                    <p className="whitespace-pre-line text-sm">{n.body}</p>
                    <p className="text-xs text-muted-foreground">
                      {n.author?.fullName ?? "Sistema"} · <DateTime value={n.createdAt} />
                    </p>
                  </div>
                  {canWrite ? (
                    <Tip label="Eliminar nota">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Eliminar nota"
                        onClick={() => setDeleting(n)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </Tip>
                  ) : null}
                </li>
              ))}
            </ol>
            {list.paged ? (
              <div className="border-t border-hairline-soft">
                <TablePager {...list.pagerProps} />
              </div>
            ) : null}
          </>
        )}
      </Section>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        title="¿Eliminar esta nota?"
        description="Se borra de la bitácora del cliente. No se puede deshacer."
        confirmLabel="Eliminar nota"
        variant="destructive"
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}
