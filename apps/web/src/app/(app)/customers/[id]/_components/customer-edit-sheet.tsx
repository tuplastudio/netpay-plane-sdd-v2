"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { apiErrorMessage } from "@/app/(app)/admin/_components/api-error";

/**
 * Forma del `GET /customers/:id` que toca este Sheet (subconjunto necesario
 * para editar; si agregas campos al DTO de update, añádelos aquí también).
 */
interface EditableCustomer {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  taxId: string | null;
  notes: string | null;
  /** Versión actual del cliente (optimistic concurrency del backend). */
  version: number;
}

/**
 * Editar cliente: el `PATCH /customers/:id` exige `expectedVersion` para
 * detectar conflictos (otra persona guardó mientras tanto). El backend
 * contesta `409 CONFLICT` si la versión local no coincide; recargamos la
 * ficha para que el operador vea qué cambió y pueda reintentar.
 *
 * Los campos que el `UpdateCustomerDto` acepta: nombre, correo, teléfono,
 * RFC y notas internas. Las direcciones, identidades y consentimientos
 * tienen endpoints dedicados (los botones de "+" en la ficha crean cada uno).
 */
export function CustomerEditSheet({
  customer,
  open,
  onOpenChange,
}: {
  customer: EditableCustomer | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [taxId, setTaxId] = useState("");
  const [notes, setNotes] = useState("");

  // Sincroniza el formulario con el cliente cuando el sheet se abre o
  // cuando cambia el cliente activo. Sin esto, editar uno y luego abrir
  // otro vería los valores del primero. Los setters reciben la versión
  // _actual_ del cliente en cada cambio (deps granulares).
  useEffect(() => {
    if (!customer) return;
    setFullName(customer.fullName);
    setEmail(customer.email ?? "");
    setPhone(customer.phone ?? "");
    setTaxId(customer.taxId ?? "");
    setNotes(customer.notes ?? "");
    // customer es la fuente de verdad; dejamos el ESLint comment a propósito
    // (los setters son estables y queremos reaccional a TODO cambio de campos).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    customer?.id,
    customer?.fullName,
    customer?.email,
    customer?.phone,
    customer?.taxId,
    customer?.notes,
    open,
  ]);

  // El backend baja correos/strings vacíos a NULL; limpiamos antes de mandar
  // para no enviar "    " cuando el operador solo apretó Guardar sin tocar.
  function blankToNull(v: string): string | undefined {
    const t = v.trim();
    return t === "" ? undefined : t;
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!customer) throw new Error("No hay cliente");
      const payload: {
        expectedVersion: number;
        fullName?: string;
        email?: string;
        phone?: string;
        taxId?: string;
        notes?: string;
      } = { expectedVersion: customer.version };
      const fn = fullName.trim();
      if (!fn) throw new Error("El nombre es obligatorio");
      const em = blankToNull(email);
      const ph = blankToNull(phone);
      const tx = blankToNull(taxId);
      const nt = blankToNull(notes);
      payload.fullName = fn;
      if (em !== undefined) payload.email = em;
      if (ph !== undefined) payload.phone = ph;
      if (tx !== undefined) payload.taxId = tx;
      if (nt !== undefined) payload.notes = nt;
      const res = await api.patch<{ data: EditableCustomer }>(
        `/customers/${customer.id}`,
        payload,
      );
      return res.data.data;
    },
    onSuccess: async () => {
      toast.success("Cliente actualizado");
      onOpenChange(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["customers"] }),
        queryClient.invalidateQueries({ queryKey: ["customer", customer?.id] }),
      ]);
    },
    onError: (error: unknown) => {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        toast.error("Alguien más guardó este cliente. Recarga la ficha para reintentar.");
      } else if (error instanceof Error && error.message) {
        toast.error(error.message);
      } else {
        toast.error(apiErrorMessage(error, "No se pudo guardar"));
      }
    },
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!fullName.trim()) {
      toast.error("El nombre es obligatorio");
      return;
    }
    save.mutate();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        title="Editar cliente"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle>Editar cliente</SheetTitle>
          <SheetDescription>
            Cambios de identidad del cliente. Direcciones y consentimientos se editan abajo en la ficha.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-customer-fullName" className="text-xs">
                Nombre completo
              </Label>
              <Input
                id="edit-customer-fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Nombre y apellidos"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-customer-email" className="text-xs">
                Correo
              </Label>
              <Input
                id="edit-customer-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="cliente@ejemplo.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-customer-phone" className="text-xs">
                Teléfono
              </Label>
              <Input
                id="edit-customer-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+52 1 55 …"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-customer-taxId" className="text-xs">
                RFC
              </Label>
              <Input
                id="edit-customer-taxId"
                value={taxId}
                onChange={(e) => setTaxId(e.target.value)}
                placeholder="XAXX010101000"
                className="font-mono text-xs uppercase"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-customer-notes" className="text-xs">
                Notas internas
              </Label>
              <Textarea
                id="edit-customer-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Preferencias, acuerdos especiales, contexto para otros vendedores…"
                rows={3}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t bg-background px-6 py-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={save.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" size="sm" loading={save.isPending}>
              <Save aria-hidden className="h-3.5 w-3.5" />
              Guardar cambios
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
