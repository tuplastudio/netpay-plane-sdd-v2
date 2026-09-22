"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SkeletonText } from "@/components/ui/skeleton";
import { Section } from "@/components/app/section";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { apiErrorMessage } from "./api-error";

/**
 * Administración de zonas de envío a domicilio (T-SHIP-01..03).
 *
 * El bot usa las zonas aquí definidas para resolver el CP / ciudad / estado
 * del cliente con `validar_zona_de_envio`. Si la zona configurada coincide
 * con la dirección del cliente, se cobra ese envío; si no, se cae al
 * `shippingFlat` genérico del tenant (con `fallback: true`).
 *
 * El admin puede crear hasta UNA zona "catch-all" (sin CPs ni
 * cityPattern ni state): sirve como precio por defecto para direcciones
 * que no caen en ninguna zona específica. El backend rechaza una segunda
 * zona catch-all con 400.
 */

const BASE = "/tenants/me/delivery-zones";

interface DeliveryZone {
  id: string;
  tenantId: string;
  name: string;
  postalCodes: string[];
  cityPattern: string | null;
  state: string | null;
  /** Decimal serializado como string (p. ej. "50.00"). */
  price: string;
  minOrder: string | null;
  active: boolean;
  sortOrder: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ZoneFormDraft {
  name: string;
  postalCodes: string;
  cityPattern: string;
  state: string;
  price: string;
  minOrder: string;
  active: boolean;
  sortOrder: number;
  notes: string;
}

const EMPTY_DRAFT: ZoneFormDraft = {
  name: "",
  postalCodes: "",
  cityPattern: "",
  state: "",
  price: "0",
  minOrder: "",
  active: true,
  sortOrder: 0,
  notes: "",
};

function parsePostalCodes(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function toDraft(zone: DeliveryZone): ZoneFormDraft {
  return {
    name: zone.name,
    postalCodes: zone.postalCodes.join(", "),
    cityPattern: zone.cityPattern ?? "",
    state: zone.state ?? "",
    price: zone.price,
    minOrder: zone.minOrder ?? "",
    active: zone.active,
    sortOrder: zone.sortOrder,
    notes: zone.notes ?? "",
  };
}

function describeZone(zone: DeliveryZone): string {
  if (zone.postalCodes.length > 0) return `CPs: ${zone.postalCodes.join(", ")}`;
  if (zone.cityPattern || zone.state) {
    return `${zone.cityPattern ?? ""}${zone.state ? ` (${zone.state})` : ""}`.trim();
  }
  return "Todas las direcciones (catch-all)";
}

export function DeliveryZonesSection() {
  const qc = useQueryClient();
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [draft, setDraft] = React.useState<ZoneFormDraft>(EMPTY_DRAFT);
  const [pendingDelete, setPendingDelete] = React.useState<DeliveryZone | null>(
    null,
  );

  const list = useQuery({
    queryKey: ["delivery-zones"],
    queryFn: async () => {
      const res = await api.get<{ data: DeliveryZone[] }>(
        `${BASE}?activeOnly=false`,
      );
      return res.data.data;
    },
  });

  function openCreate() {
    setCreating(true);
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  }
  function openEdit(zone: DeliveryZone) {
    setCreating(false);
    setEditingId(zone.id);
    setDraft(toDraft(zone));
  }
  function closeForm() {
    setCreating(false);
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  }

  const save = useMutation({
    mutationFn: async (input: { id: string | null; body: Record<string, unknown> }) => {
      if (input.id) {
        const res = await api.patch<{ data: DeliveryZone }>(`${BASE}/${input.id}`, input.body);
        return res.data.data;
      }
      const res = await api.post<{ data: DeliveryZone }>(BASE, input.body);
      return res.data.data;
    },
    onSuccess: (_data, variables) => {
      toast.success(variables.id ? "Zona actualizada" : "Zona creada");
      qc.invalidateQueries({ queryKey: ["delivery-zones"] });
      closeForm();
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err, "No se pudo guardar la zona"));
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`${BASE}/${id}`);
      return id;
    },
    onSuccess: () => {
      toast.success("Zona eliminada");
      qc.invalidateQueries({ queryKey: ["delivery-zones"] });
      setPendingDelete(null);
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err, "No se pudo eliminar la zona"));
    },
  });

  function onSubmit() {
    const body: Record<string, unknown> = {
      name: draft.name.trim(),
      price: Number(draft.price) || 0,
      active: draft.active,
      sortOrder: draft.sortOrder,
    };
    const cp = parsePostalCodes(draft.postalCodes);
    if (cp.length > 0) body.postalCodes = cp;
    if (draft.cityPattern.trim()) body.cityPattern = draft.cityPattern.trim();
    if (draft.state.trim()) body.state = draft.state.trim();
    if (draft.minOrder.trim()) body.minOrder = Number(draft.minOrder) || 0;
    if (draft.notes.trim()) body.notes = draft.notes.trim();
    save.mutate({ id: editingId, body });
  }

  const editingZone = editingId
    ? list.data?.find((z) => z.id === editingId) ?? null
    : null;
  const isCatchAll =
    !draft.postalCodes.trim() && !draft.cityPattern.trim() && !draft.state.trim();
  const editingExistingIsCatchAll =
    editingZone &&
    editingZone.postalCodes.length === 0 &&
    !editingZone.cityPattern &&
    !editingZone.state;

  return (
    <Section
      as="h3"
      title="Envío a domicilio"
      description="Zonas con precio propio. El bot las usa cuando el cliente confirma dirección a domicilio."
      headerIcon={<Truck aria-hidden className="h-4 w-4" />}
      contentClassName="space-y-4"
    >
      <Alert>
        <MapPin aria-hidden className="h-4 w-4" />
        <AlertTitle>Cómo se cobra el envío</AlertTitle>
        <AlertDescription>
          El bot pregunta al cliente su CP / ciudad / estado y resuelve la
          primera zona que coincida (por CP exacto, luego por estado +
          ciudad, luego una zona &quot;todas&quot;). Si ninguna coincide, se
          cobra el envío estándar del tenant y se lo avisa al cliente.
        </AlertDescription>
      </Alert>

      {list.isLoading ? (
        <SkeletonText lines={3} />
      ) : list.isError ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden className="h-4 w-4" />
          <AlertTitle>No se pudieron cargar las zonas</AlertTitle>
          <AlertDescription>
            {apiErrorMessage(list.error, "Reintenta en un momento")}
          </AlertDescription>
        </Alert>
      ) : (
        <div className="space-y-3">
          {list.data && list.data.length > 0 ? (
            <ul className="space-y-2">
              {list.data.map((zone) => (
                <li
                  key={zone.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-card border bg-card p-4 shadow-airbnb"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{zone.name}</span>
                      <Badge variant={zone.active ? "secondary" : "outline"}>
                        {zone.active ? "Activa" : "Inactiva"}
                      </Badge>
                      {(zone.postalCodes.length === 0 && !zone.cityPattern && !zone.state) ? (
                        <Badge variant="outline">catch-all</Badge>
                      ) : null}
                      <span className="text-sm font-semibold">
                        ${Number(zone.price).toFixed(2)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {describeZone(zone)}
                      {zone.minOrder ? (
                        <>
                          {" · "}pedido mínimo $
                          {Number(zone.minOrder).toFixed(2)}
                        </>
                      ) : null}
                    </p>
                    {zone.notes ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {zone.notes}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Editar ${zone.name}`}
                      onClick={() => openEdit(zone)}
                    >
                      <Pencil aria-hidden className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Eliminar ${zone.name}`}
                      onClick={() => setPendingDelete(zone)}
                    >
                      <Trash2 aria-hidden className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-card border border-dashed bg-card/40 p-6 text-center text-sm text-muted-foreground">
              Aún no tienes zonas. Mientras tanto, el envío a domicilio usa el
              flat del tenant (configurable desde &quot;Empresa&quot;).
            </p>
          )}

          {!creating && !editingId ? (
            <Button type="button" variant="outline" onClick={openCreate}>
              <Plus aria-hidden className="h-4 w-4" />
              Nueva zona
            </Button>
          ) : null}

          {creating || editingId ? (
            <div className="rounded-card border bg-muted/40 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-sm font-medium">
                  {editingId ? "Editar zona" : "Nueva zona"}
                </h4>
                <Button type="button" variant="ghost" size="icon" onClick={closeForm}>
                  <X aria-hidden className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="zone-name">Nombre</Label>
                  <Input
                    id="zone-name"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder="Centro, Zona metropolitana, Foráneo…"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="zone-price">Precio del envío (MXN)</Label>
                  <Input
                    id="zone-price"
                    type="number"
                    min={0}
                    step="0.5"
                    value={draft.price}
                    onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="zone-cps">Códigos postales (separados por coma o espacio)</Label>
                  <Input
                    id="zone-cps"
                    value={draft.postalCodes}
                    onChange={(e) => setDraft({ ...draft, postalCodes: e.target.value })}
                    placeholder="06000, 06010, 06020"
                  />
                  <p className="text-xs text-muted-foreground">
                    4-5 dígitos cada uno. Vacío = no filtra por CP.
                  </p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="zone-city">Patrón de ciudad (opcional)</Label>
                  <Input
                    id="zone-city"
                    value={draft.cityPattern}
                    onChange={(e) =>
                      setDraft({ ...draft, cityPattern: e.target.value })
                    }
                    placeholder="Guadalajara, Zapopan…"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="zone-state">Estado / departamento (opcional)</Label>
                  <Input
                    id="zone-state"
                    value={draft.state}
                    onChange={(e) => setDraft({ ...draft, state: e.target.value })}
                    placeholder="JAL, CDMX, NL…"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="zone-min">Pedido mínimo para esta zona (opcional)</Label>
                  <Input
                    id="zone-min"
                    type="number"
                    min={0}
                    step="0.5"
                    value={draft.minOrder}
                    onChange={(e) => setDraft({ ...draft, minOrder: e.target.value })}
                    placeholder="Sin mínimo"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="zone-order">Orden de evaluación</Label>
                  <Input
                    id="zone-order"
                    type="number"
                    min={0}
                    step={1}
                    value={draft.sortOrder}
                    onChange={(e) =>
                      setDraft({ ...draft, sortOrder: Number(e.target.value) || 0 })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Menor = se evalúa antes.
                  </p>
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="zone-notes">Notas (opcional)</Label>
                  <Input
                    id="zone-notes"
                    value={draft.notes}
                    onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                    placeholder="Notas internas para el equipo…"
                  />
                </div>
                <div className="flex items-center gap-2 sm:col-span-2">
                  <input
                    id="zone-active"
                    type="checkbox"
                    checked={draft.active}
                    onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                    className="h-4 w-4 rounded border-border"
                  />
                  <Label htmlFor="zone-active" className="cursor-pointer">
                    Activa (el bot la usa)
                  </Label>
                </div>
              </div>

              {isCatchAll && !editingExistingIsCatchAll ? (
                <Alert className="mt-3">
                  <AlertCircle aria-hidden className="h-4 w-4" />
                  <AlertTitle>Zona catch-all</AlertTitle>
                  <AlertDescription>
                    No tiene CP ni ciudad ni estado: aplica a cualquier
                    dirección que no coincida con otra zona. Solo puede haber
                    UNA por tenant; el backend rechazará una segunda.
                  </AlertDescription>
                </Alert>
              ) : null}

              <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                <Button type="button" variant="outline" onClick={closeForm}>
                  Cancelar
                </Button>
                <Button
                  type="button"
                  onClick={onSubmit}
                  disabled={!draft.name.trim() || save.isPending}
                >
                  {save.isPending ? (
                    <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 aria-hidden className="h-4 w-4" />
                  )}
                  {editingId ? "Guardar cambios" : "Crear zona"}
                </Button>
              </div>
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground">
            <span className={cn("font-medium")}>
              Sugerencia:
            </span>{" "}
            crea primero una zona específica por CP para la zona más común
            (ej. &quot;Centro CDMX&quot; con CPs 06000-06099) y deja una
            zona catch-all al final como precio por defecto para todo lo
            demás.
          </p>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={
          pendingDelete
            ? `¿Eliminar la zona "${pendingDelete.name}"?`
            : ""
        }
        description="El envío caerá al flat estándar del tenant para las direcciones que antes cubría esta zona."
        confirmLabel="Eliminar"
        pending={remove.isPending}
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete.id);
        }}
      />
    </Section>
  );
}
