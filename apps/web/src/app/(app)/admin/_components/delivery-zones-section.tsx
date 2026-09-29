"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertCircle,
  Crosshair,
  Eraser,
  MapPin,
  Pencil,
  PenLine,
  Plus,
  Search,
  Trash2,
  Truck,
  Undo2,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, type Tone } from "@/components/ui/status-badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Section } from "@/components/app/section";
import { InfoTip, Tip } from "@/components/app/info-tip";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { Money, formatMoney } from "@/components/app/money";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { apiErrorMessage } from "./api-error";
import {
  MAX_POLYGON_VERTICES,
  countVertices,
  editableRing,
  isHexColor,
  isZoneGeometry,
  resolveTokenColor,
  ringToGeometry,
  zoneColor,
  zonePalette,
  type LngLat,
  type ZoneGeometry,
} from "./delivery-zones/geo";
import type { ZoneMapMode, ZoneMapZone } from "./delivery-zones/zone-map";

/**
 * Administración de zonas de envío a domicilio (T-SHIP-01..03, polígonos
 * T-SHIP-07).
 *
 * Una zona cubre un área por polígono dibujado en el mapa, por CPs o por
 * estado + patrón de ciudad (combinables). El backend resuelve en este
 * orden: polígono que contenga la lat/lng del cliente → CP → estado+ciudad
 * → zona catch-all → envío fijo del tenant. Aquí el admin dibuja, prueba
 * direcciones y ve el criterio (`matchedBy`) que ganó.
 *
 * Leaflet se carga con `next/dynamic` + `ssr: false`: toca `window` al
 * importarse y rompería el render en servidor.
 */

const ZoneMap = dynamic(() => import("./delivery-zones/zone-map"), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full rounded-lg sm:h-80" />,
});

const BASE = "/tenants/me/delivery-zones";
const QUERY_KEY = ["delivery-zones"] as const;

interface DeliveryZone {
  id: string;
  tenantId: string;
  name: string;
  postalCodes: string[];
  cityPattern: string | null;
  state: string | null;
  polygon: unknown;
  color: string | null;
  /** Decimal serializado como string (p. ej. "50.00"). */
  price: string;
  minOrder: string | null;
  active: boolean;
  sortOrder: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

type MatchedBy = "polygon" | "postalCode" | "city" | "catchAll" | "fallback";

interface LookupResult {
  price: string;
  priceNumber: number;
  zoneId: string | null;
  zoneName: string | null;
  fallback: boolean;
  matchedBy: MatchedBy;
}

const MATCHED_BY_LABEL: Record<MatchedBy, { label: string; tone: Tone }> = {
  polygon: { label: "Polígono", tone: "success" },
  postalCode: { label: "Código postal", tone: "success" },
  city: { label: "Ciudad y estado", tone: "success" },
  catchAll: { label: "Catch-all", tone: "info" },
  fallback: { label: "Envío fijo", tone: "warning" },
};

const HINTS = {
  order:
    "Cuando dos zonas podrían aplicar a la misma dirección gana la de número menor. Aplica entre polígonos que se traslapan y entre zonas con el mismo CP.",
  minOrder:
    "Referencia para tu equipo y para el bot: hoy no bloquea el cálculo del envío. Si tienes una regla como \"envío gratis arriba de $500\", escríbela también en las Reglas adicionales del agente.",
  catchAll:
    "Una zona sin polígono, sin CPs, sin ciudad y sin estado aplica a toda dirección que no encaje en otra zona. Solo puede haber una por empresa y se evalúa al final, antes del envío fijo.",
  polygon:
    "Dibuja el área sobre el mapa: clic para cada esquina, arrastra una esquina para moverla, clic derecho sobre una para quitarla. Se usa cuando el cliente comparte su ubicación por WhatsApp o cuando pruebas un pin aquí. Tiene prioridad sobre el CP.",
  cps: "4 o 5 dígitos cada uno, separados por coma o espacio. Aplica si el CP del cliente es exactamente uno de estos.",
  city: "El estado debe coincidir y la ciudad del cliente debe contener el patrón (\"Guadalajara\" cubre \"Guadalajara Centro\"). Un estado sin patrón de ciudad no aplica nunca.",
  color: "Solo para distinguir la zona en el mapa. No cambia cómo se cobra.",
} as const;

function HintLabel({ htmlFor, children, hint }: { htmlFor: string; children: React.ReactNode; hint: string }) {
  return (
    <div className="flex items-center gap-1">
      <Label htmlFor={htmlFor}>{children}</Label>
      <InfoTip text={hint} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formulario
// ---------------------------------------------------------------------------

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
  color: string;
  /** Vértices editables `[lng, lat]`; `null` cuando la geometría guardada es avanzada. */
  vertices: LngLat[] | null;
  /** MultiPolygon o con agujeros (creado por API): se conserva tal cual o se borra. */
  advanced: ZoneGeometry | null;
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
  color: "",
  vertices: [],
  advanced: null,
};

function parsePostalCodes(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function zoneGeometry(zone: Pick<DeliveryZone, "polygon">): ZoneGeometry | null {
  return isZoneGeometry(zone.polygon) ? zone.polygon : null;
}

function toDraft(zone: DeliveryZone, fallbackColor: string): ZoneFormDraft {
  const geometry = zoneGeometry(zone);
  const ring = editableRing(geometry);
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
    color: isHexColor(zone.color) ? zone.color : fallbackColor,
    vertices: geometry && !ring ? null : (ring ?? []),
    advanced: geometry && !ring ? geometry : null,
  };
}

function draftGeometry(d: ZoneFormDraft): ZoneGeometry | null {
  if (d.advanced) return d.advanced;
  return d.vertices ? ringToGeometry(d.vertices) : null;
}

function describeZone(zone: DeliveryZone): string {
  const parts: string[] = [];
  const geometry = zoneGeometry(zone);
  if (geometry) parts.push(`Polígono (${countVertices(geometry)} vértices)`);
  if (zone.postalCodes.length > 0) {
    const shown = zone.postalCodes.slice(0, 4).join(", ");
    parts.push(
      zone.postalCodes.length > 4 ? `CPs ${shown} y ${zone.postalCodes.length - 4} más` : `CPs ${shown}`,
    );
  }
  if (zone.cityPattern || zone.state) {
    parts.push(`${zone.cityPattern ?? ""}${zone.state ? ` (${zone.state})` : ""}`.trim());
  }
  return parts.length > 0 ? parts.join(" · ") : "Todas las direcciones (catch-all)";
}

function isZoneCatchAll(zone: DeliveryZone): boolean {
  return zone.postalCodes.length === 0 && !zone.cityPattern && !zone.state && !zoneGeometry(zone);
}

/** Paleta de tokens resuelta en cliente (vacía hasta montar). */
function usePalette(): string[] {
  const [palette, setPalette] = React.useState<string[]>([]);
  React.useEffect(() => {
    setPalette(zonePalette());
    // El tema (claro/oscuro) cambia los valores de los tokens.
    const observer = new MutationObserver(() => setPalette(zonePalette()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return palette;
}

// ---------------------------------------------------------------------------
// Sección
// ---------------------------------------------------------------------------

export function DeliveryZonesSection() {
  const qc = useQueryClient();
  const palette = usePalette();
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<ZoneFormDraft>(EMPTY_DRAFT);
  const [pendingDelete, setPendingDelete] = React.useState<DeliveryZone | null>(null);

  const list = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const res = await api.get<{ data: DeliveryZone[] }>(`${BASE}?activeOnly=false`);
      return res.data.data;
    },
  });
  const zones = React.useMemo(() => list.data ?? [], [list.data]);

  const colorFor = React.useCallback(
    (zone: DeliveryZone) => zoneColor(zone.color, zones.findIndex((z) => z.id === zone.id), palette),
    [zones, palette],
  );

  const mapZones = React.useMemo<ZoneMapZone[]>(
    () =>
      zones.map((z) => ({
        id: z.id,
        name: z.name,
        color: colorFor(z),
        geometry: zoneGeometry(z),
        priceLabel: formatMoney(z.price),
        active: z.active,
      })),
    [zones, colorFor],
  );
  const zonesWithPolygon = mapZones.filter((z) => z.geometry).length;

  function openCreate() {
    setEditingId(null);
    setDraft({ ...EMPTY_DRAFT, color: zoneColor(null, zones.length, palette) });
    setSheetOpen(true);
  }
  function openEdit(zone: DeliveryZone) {
    setEditingId(zone.id);
    setDraft(toDraft(zone, colorFor(zone)));
    setSheetOpen(true);
  }
  function closeForm() {
    setSheetOpen(false);
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
      qc.invalidateQueries({ queryKey: QUERY_KEY });
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
      qc.invalidateQueries({ queryKey: QUERY_KEY });
      setPendingDelete(null);
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err, "No se pudo eliminar la zona"));
    },
  });

  const editingZone = editingId ? zones.find((z) => z.id === editingId) ?? null : null;

  function onSubmit() {
    const body: Record<string, unknown> = {
      name: draft.name.trim(),
      price: Number(draft.price) || 0,
      active: draft.active,
      sortOrder: draft.sortOrder,
    };
    const cp = parsePostalCodes(draft.postalCodes);
    if (cp.length > 0) body.postalCodes = cp;
    else if (editingZone && editingZone.postalCodes.length > 0) body.postalCodes = [];
    if (draft.cityPattern.trim()) body.cityPattern = draft.cityPattern.trim();
    if (draft.state.trim()) body.state = draft.state.trim();
    if (draft.minOrder.trim()) body.minOrder = Number(draft.minOrder) || 0;
    if (draft.notes.trim()) body.notes = draft.notes.trim();
    if (isHexColor(draft.color)) body.color = draft.color;
    const geometry = draftGeometry(draft);
    if (geometry) body.polygon = geometry;
    else if (editingZone && zoneGeometry(editingZone)) body.polygon = null;
    save.mutate({ id: editingId, body });
  }

  const columns: Array<DataTableColumn<DeliveryZone>> = [
    {
      key: "zone",
      header: "Zona",
      cell: (zone) => (
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            aria-hidden
            className="mt-1 h-3 w-3 shrink-0 rounded-full ring-1 ring-hairline-strong"
            style={{ backgroundColor: colorFor(zone) }}
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium">{zone.name}</span>
              {isZoneCatchAll(zone) ? <Badge variant="outline" size="sm">catch-all</Badge> : null}
              {zoneGeometry(zone) ? <Badge variant="info" size="sm">mapa</Badge> : null}
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{describeZone(zone)}</p>
            {zone.minOrder ? (
              <p className="text-xs text-muted-foreground">
                Pedido mínimo <Money value={zone.minOrder} />
              </p>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      key: "price",
      header: "Envío",
      numeric: true,
      width: "7rem",
      cell: (zone) => <Money value={zone.price} emphasis />,
    },
    {
      key: "order",
      header: (
        <span className="inline-flex items-center gap-1">
          Orden
          <InfoTip label="Orden" text={HINTS.order} />
        </span>
      ),
      numeric: true,
      width: "5rem",
      className: "hidden sm:table-cell",
      cell: (zone) => <span className="tabular-nums text-muted-foreground">{zone.sortOrder}</span>,
    },
    {
      key: "status",
      header: "Estado",
      width: "7rem",
      cell: (zone) => (
        <StatusBadge
          status={zone.active ? "ACTIVE" : "INACTIVE"}
          tone={zone.active ? "success" : "neutral"}
          label={zone.active ? "Activa" : "Inactiva"}
        />
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Acciones</span>,
      width: "6rem",
      cell: (zone) => (
        <div className="flex items-center justify-end gap-1">
          <Tip label="Editar zona">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Editar ${zone.name}`}
              onClick={(e) => {
                e.stopPropagation();
                openEdit(zone);
              }}
            >
              <Pencil aria-hidden className="h-4 w-4" />
            </Button>
          </Tip>
          <Tip label="Eliminar zona">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Eliminar ${zone.name}`}
              onClick={(e) => {
                e.stopPropagation();
                setPendingDelete(zone);
              }}
            >
              <Trash2 aria-hidden className="h-4 w-4" />
            </Button>
          </Tip>
        </div>
      ),
    },
  ];

  return (
    <>
      <Section
        as="h3"
        title="Envío a domicilio"
        description="Zonas con precio propio. El bot las usa cuando el cliente confirma dirección o comparte su ubicación."
        headerIcon={<Truck aria-hidden className="h-4 w-4" />}
        actions={
          <Button type="button" size="sm" onClick={openCreate}>
            <Plus aria-hidden className="h-4 w-4" />
            Nueva zona
          </Button>
        }
        contentClassName="space-y-4"
      >
        <Alert>
          <MapPin aria-hidden className="h-4 w-4" />
          <AlertTitle>Cómo se elige la zona</AlertTitle>
          <AlertDescription>
            Primero un polígono que contenga la ubicación del cliente, luego el CP exacto, luego estado +
            ciudad, luego la zona catch-all. Si nada coincide se cobra el envío fijo de la empresa y se le
            avisa al cliente. Entre zonas que empatan gana el menor orden de evaluación.
          </AlertDescription>
        </Alert>

        <ZoneTester
          zones={mapZones}
          zonesWithPolygon={zonesWithPolygon}
          fitKey={`${zones.length}:${zonesWithPolygon}`}
          isLoading={list.isLoading}
        />

        <DataTable
          columns={columns}
          rows={list.data}
          isLoading={list.isLoading}
          isError={list.isError}
          error={list.error}
          onRetry={() => list.refetch()}
          onRowClick={openEdit}
          getRowActionLabel={(z) => `Editar ${z.name}`}
          caption="Zonas de envío a domicilio"
          empty={{
            icon: <Truck aria-hidden className="h-5 w-5" />,
            title: "Aún no tienes zonas",
            description:
              "Mientras tanto, el envío a domicilio usa el envío fijo de la empresa (Admin → Empresa).",
            action: (
              <Button type="button" variant="outline" size="sm" onClick={openCreate}>
                <Plus aria-hidden className="h-4 w-4" />
                Crear la primera zona
              </Button>
            ),
          }}
        />

        <p className="text-xs text-muted-foreground">
          <span className="font-medium">Sugerencia:</span> dibuja en el mapa las zonas donde repartes tú
          (el bot las resuelve con la ubicación que comparte el cliente), agrega CPs para las direcciones
          que llegan por texto y deja una zona catch-all al final como precio por defecto.
        </p>
      </Section>

      <Sheet
        open={sheetOpen}
        onOpenChange={(open) => {
          if (!open) closeForm();
        }}
      >
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
          <SheetHeader className="border-b border-hairline px-6 py-4">
            <SheetTitle>{editingId ? "Editar zona" : "Nueva zona"}</SheetTitle>
            <SheetDescription>
              Define el área (polígono, CPs o ciudad) y el precio del envío.
            </SheetDescription>
          </SheetHeader>
          <ZoneForm
            key={editingId ?? "new"}
            draft={draft}
            setDraft={setDraft}
            palette={palette}
            otherZones={mapZones.filter((z) => z.id !== editingId)}
            editingExistingIsCatchAll={editingZone ? isZoneCatchAll(editingZone) : false}
            pending={save.isPending}
            isEditing={editingId !== null}
            onCancel={closeForm}
            onSubmit={onSubmit}
          />
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={pendingDelete ? `¿Eliminar la zona "${pendingDelete.name}"?` : ""}
        description="Las direcciones que cubría pasarán a la zona catch-all o al envío fijo de la empresa. Si solo quieres pausarla, desactívala: eso sí es reversible."
        confirmLabel="Eliminar"
        pending={remove.isPending}
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete.id);
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Formulario dentro del Sheet
// ---------------------------------------------------------------------------

interface ZoneFormProps {
  draft: ZoneFormDraft;
  setDraft: React.Dispatch<React.SetStateAction<ZoneFormDraft>>;
  palette: string[];
  otherZones: ZoneMapZone[];
  editingExistingIsCatchAll: boolean;
  pending: boolean;
  isEditing: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}

function ZoneForm({
  draft,
  setDraft,
  palette,
  otherZones,
  editingExistingIsCatchAll,
  pending,
  isEditing,
  onCancel,
  onSubmit,
}: ZoneFormProps) {
  const [drawing, setDrawing] = React.useState(false);
  const [flyTo, setFlyTo] = React.useState<{ lat: number; lng: number; zoom?: number } | null>(null);

  const vertexCount = draft.advanced ? countVertices(draft.advanced) : draft.vertices?.length ?? 0;
  const hasPolygon = draft.advanced !== null || (draft.vertices?.length ?? 0) >= 3;
  const isCatchAll =
    !draft.postalCodes.trim() && !draft.cityPattern.trim() && !draft.state.trim() && !hasPolygon;
  const tooManyVertices = vertexCount > MAX_POLYGON_VERTICES;
  const incompletePolygon = !draft.advanced && (draft.vertices?.length ?? 0) > 0 && (draft.vertices?.length ?? 0) < 3;

  const draftPreview = React.useMemo<ZoneMapZone[]>(() => {
    if (!draft.advanced) return otherZones;
    return [
      ...otherZones,
      {
        id: "__draft_advanced",
        name: draft.name || "Esta zona",
        color: draft.color,
        geometry: draft.advanced,
        priceLabel: formatMoney(draft.price),
        active: true,
      },
    ];
  }, [otherZones, draft.advanced, draft.name, draft.color, draft.price]);

  const mode: ZoneMapMode = drawing ? "draw" : "view";

  function setVertices(vertices: LngLat[]) {
    setDraft((d) => ({ ...d, vertices, advanced: null }));
  }

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        if (!pending) onSubmit();
      }}
    >
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="zone-name">Nombre</Label>
            <Input
              id="zone-name"
              required
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Centro, Zona metropolitana, Foráneo…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="zone-price">Precio del envío (MXN)</Label>
            <Input
              id="zone-price"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.5"
              value={draft.price}
              onChange={(e) => setDraft({ ...draft, price: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <HintLabel htmlFor="zone-min" hint={HINTS.minOrder}>
              Pedido mínimo (opcional)
            </HintLabel>
            <Input
              id="zone-min"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.5"
              value={draft.minOrder}
              onChange={(e) => setDraft({ ...draft, minOrder: e.target.value })}
              placeholder="Sin mínimo"
            />
          </div>
        </div>

        {/* Polígono */}
        <fieldset className="space-y-3">
          <legend className="flex items-center gap-1 text-sm font-medium">
            Área en el mapa
            <InfoTip label="Polígono" text={HINTS.polygon} />
          </legend>
          <div className="flex flex-wrap items-center gap-2">
            {draft.advanced ? (
              <Badge variant="info">Polígono avanzado · {vertexCount} vértices</Badge>
            ) : (
              <Badge variant={hasPolygon ? "info" : "muted"}>
                {hasPolygon ? `${vertexCount} vértices` : "Sin polígono"}
              </Badge>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              {!draft.advanced ? (
                <Button
                  type="button"
                  size="sm"
                  variant={drawing ? "default" : "outline"}
                  aria-pressed={drawing}
                  onClick={() => setDrawing((v) => !v)}
                >
                  <PenLine aria-hidden className="h-4 w-4" />
                  {drawing ? "Terminar" : hasPolygon ? "Editar" : "Dibujar"}
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={draft.advanced !== null || (draft.vertices?.length ?? 0) === 0}
                onClick={() => setVertices((draft.vertices ?? []).slice(0, -1))}
              >
                <Undo2 aria-hidden className="h-4 w-4" />
                Deshacer
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={!draft.advanced && (draft.vertices?.length ?? 0) === 0}
                onClick={() => {
                  setVertices([]);
                  setDrawing(false);
                }}
              >
                <Eraser aria-hidden className="h-4 w-4" />
                Borrar
              </Button>
            </div>
          </div>
          <PlaceSearch onFound={(p) => setFlyTo({ ...p, zoom: 14 })} idPrefix="zone-form" />
          <ZoneMap
            label="Mapa para dibujar la zona"
            zones={draftPreview}
            mode={mode}
            draft={draft.advanced ? null : draft.vertices}
            draftColor={draft.color}
            onDraftChange={setVertices}
            flyTo={flyTo}
            fitKey="form"
          />
          <p className="text-xs text-muted-foreground">
            {drawing
              ? "Haz clic en el mapa para agregar esquinas; arrastra una esquina para moverla; clic derecho para quitarla."
              : draft.advanced
                ? "Este polígono tiene varias partes o agujeros (creado por API). Aquí puedes conservarlo o borrarlo; para editarlo vértice a vértice, bórralo y dibuja uno nuevo."
                : "Pulsa \"Dibujar\" y marca al menos tres esquinas. Las demás zonas se muestran atenuadas para que no se traslapen sin querer."}
          </p>
          {incompletePolygon ? (
            <p className="text-xs text-warning-foreground">
              Un polígono necesita al menos 3 esquinas; con menos, la zona se guarda sin polígono.
            </p>
          ) : null}
          {tooManyVertices ? (
            <p className="text-xs text-destructive">
              Máximo {MAX_POLYGON_VERTICES} vértices por zona.
            </p>
          ) : null}
          <div className="space-y-1.5">
            <HintLabel htmlFor="zone-color" hint={HINTS.color}>
              Color en el mapa
            </HintLabel>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="zone-color"
                type="color"
                value={isHexColor(draft.color) ? draft.color : palette[0] ?? resolveTokenColor("foreground") ?? ""}
                onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                className="h-10 w-14 cursor-pointer rounded-md border border-input bg-background p-1"
              />
              <div role="group" aria-label="Colores sugeridos" className="flex flex-wrap items-center gap-1.5">
                {palette.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    aria-label={`Usar color ${hex}`}
                    aria-pressed={draft.color === hex}
                    onClick={() => setDraft({ ...draft, color: hex })}
                    className={cn(
                      "h-7 w-7 rounded-full ring-1 ring-hairline-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      draft.color === hex && "ring-2 ring-foreground",
                    )}
                    style={{ backgroundColor: hex }}
                  />
                ))}
              </div>
            </div>
          </div>
        </fieldset>

        {/* Criterios por texto */}
        <fieldset className="space-y-4">
          <legend className="text-sm font-medium">Área por dirección</legend>
          <div className="space-y-1.5">
            <HintLabel htmlFor="zone-cps" hint={HINTS.cps}>
              Códigos postales
            </HintLabel>
            <Input
              id="zone-cps"
              value={draft.postalCodes}
              onChange={(e) => setDraft({ ...draft, postalCodes: e.target.value })}
              placeholder="06000, 06010, 06020"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <HintLabel htmlFor="zone-city" hint={HINTS.city}>
                Patrón de ciudad
              </HintLabel>
              <Input
                id="zone-city"
                value={draft.cityPattern}
                onChange={(e) => setDraft({ ...draft, cityPattern: e.target.value })}
                placeholder="Guadalajara, Zapopan…"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="zone-state">Estado</Label>
              <Input
                id="zone-state"
                value={draft.state}
                onChange={(e) => setDraft({ ...draft, state: e.target.value })}
                placeholder="JAL, CDMX, NL…"
              />
            </div>
          </div>
        </fieldset>

        {/* Comportamiento */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <HintLabel htmlFor="zone-order" hint={HINTS.order}>
              Orden de evaluación
            </HintLabel>
            <Input
              id="zone-order"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={draft.sortOrder}
              onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) || 0 })}
            />
            <p className="text-xs text-muted-foreground">Menor = se evalúa antes.</p>
          </div>
          <div className="flex items-center gap-2 pt-7">
            <Checkbox
              id="zone-active"
              checked={draft.active}
              onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
            />
            <Label htmlFor="zone-active" className="cursor-pointer">
              Activa (el bot la usa)
            </Label>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="zone-notes">Notas internas (opcional)</Label>
            <Textarea
              id="zone-notes"
              rows={2}
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              placeholder="Notas para el equipo…"
            />
          </div>
        </div>

        {isCatchAll && !editingExistingIsCatchAll ? (
          <Alert>
            <AlertCircle aria-hidden className="h-4 w-4" />
            <AlertTitle className="flex items-center gap-1">
              Zona catch-all
              <InfoTip label="Zona catch-all" text={HINTS.catchAll} />
            </AlertTitle>
            <AlertDescription>
              Sin polígono, CP, ciudad ni estado: aplica a cualquier dirección que no coincida con otra
              zona. Solo puede haber una; si ya existe, el sistema rechazará esta.
            </AlertDescription>
          </Alert>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-hairline px-6 py-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" loading={pending} disabled={!draft.name.trim() || tooManyVertices}>
          {isEditing ? "Guardar cambios" : "Crear zona"}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Búsqueda de lugar (Nominatim) — solo al pulsar el botón, nunca al teclear.
// ---------------------------------------------------------------------------

function PlaceSearch({
  onFound,
  idPrefix,
}: {
  onFound: (p: { lat: number; lng: number }) => void;
  idPrefix: string;
}) {
  const [q, setQ] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function search() {
    const query = q.trim();
    if (!query) return;
    setBusy(true);
    try {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("limit", "1");
      url.searchParams.set("accept-language", "es");
      url.searchParams.set("q", query);
      const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Array<{ lat: string; lon: string; display_name?: string }>;
      const first = data[0];
      if (!first) {
        toast.error("No se encontró ese lugar");
        return;
      }
      onFound({ lat: Number(first.lat), lng: Number(first.lon) });
    } catch {
      toast.error("No se pudo buscar el lugar. Mueve el mapa a mano.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-end gap-2">
      <div className="min-w-0 flex-1 space-y-1.5">
        <Label htmlFor={`${idPrefix}-place`}>Ir a un lugar (opcional)</Label>
        <Input
          id={`${idPrefix}-place`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void search();
            }
          }}
          placeholder="Colonia, ciudad o dirección"
        />
      </div>
      <Button type="button" variant="outline" onClick={() => void search()} loading={busy} disabled={!q.trim()}>
        {busy ? null : <Search aria-hidden className="h-4 w-4" />}
        Buscar
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Probador de direcciones + mapa general
// ---------------------------------------------------------------------------

function ZoneTester({
  zones,
  zonesWithPolygon,
  fitKey,
  isLoading,
}: {
  zones: ZoneMapZone[];
  zonesWithPolygon: number;
  fitKey: string;
  isLoading: boolean;
}) {
  const [postalCode, setPostalCode] = React.useState("");
  const [city, setCity] = React.useState("");
  const [state, setState] = React.useState("");
  const [pin, setPin] = React.useState<{ lat: number; lng: number } | null>(null);
  const [flyTo, setFlyTo] = React.useState<{ lat: number; lng: number; zoom?: number } | null>(null);
  const [result, setResult] = React.useState<LookupResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const lookup = useMutation({
    mutationFn: async (input: {
      postalCode?: string;
      city?: string;
      state?: string;
      lat?: number;
      lng?: number;
    }) => {
      const params = new URLSearchParams();
      if (input.postalCode) params.set("postalCode", input.postalCode);
      if (input.city) params.set("city", input.city);
      if (input.state) params.set("state", input.state);
      if (typeof input.lat === "number" && typeof input.lng === "number") {
        params.set("lat", String(input.lat));
        params.set("lng", String(input.lng));
      }
      const res = await api.get<{ data: LookupResult }>(`/shipping/lookup?${params.toString()}`);
      return res.data.data;
    },
    onSuccess: (data) => {
      setResult(data);
      setError(null);
    },
    onError: (err) => {
      setResult(null);
      setError(apiErrorMessage(err, "No se pudo resolver la zona"));
    },
  });

  const canTest = Boolean(postalCode.trim() || (city.trim() && state.trim()) || pin);

  function run(next?: { pin?: { lat: number; lng: number } | null }) {
    const p = next?.pin === undefined ? pin : next.pin;
    lookup.mutate({
      postalCode: postalCode.trim() || undefined,
      city: city.trim() || undefined,
      state: state.trim() || undefined,
      lat: p?.lat,
      lng: p?.lng,
    });
  }

  function onPin(p: { lat: number; lng: number }) {
    setPin(p);
    run({ pin: p });
  }

  const matched = result ? MATCHED_BY_LABEL[result.matchedBy] ?? MATCHED_BY_LABEL.fallback : null;
  const highlightId = result?.zoneId ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-2">
        {isLoading ? (
          <Skeleton className="h-64 w-full rounded-lg sm:h-80" />
        ) : (
          <ZoneMap
            label="Mapa de zonas de envío. Haz clic para probar un punto."
            zones={zones}
            mode="pin"
            pin={pin}
            onPin={onPin}
            highlightId={highlightId}
            flyTo={flyTo}
            fitKey={fitKey}
            className="h-72 sm:h-96"
          />
        )}
        <p className="text-xs text-muted-foreground">
          {zonesWithPolygon > 0
            ? `${zonesWithPolygon} ${zonesWithPolygon === 1 ? "zona dibujada" : "zonas dibujadas"} en el mapa. `
            : "Ninguna zona tiene polígono todavía. "}
          Haz clic en el mapa para soltar un pin y ver qué zona aplica ahí. Las zonas inactivas se ven
          punteadas.
        </p>
      </div>

      <div className="space-y-3 rounded-lg border border-hairline bg-card p-4">
        <div className="flex items-center gap-2">
          <Crosshair aria-hidden className="h-4 w-4 text-muted-foreground" />
          <h4 className="text-sm font-medium">Probar dirección</h4>
        </div>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (canTest) run();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="tester-cp">Código postal</Label>
            <Input
              id="tester-cp"
              inputMode="numeric"
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              placeholder="06000"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="tester-city">Ciudad</Label>
              <Input id="tester-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="CDMX" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tester-state">Estado</Label>
              <Input id="tester-state" value={state} onChange={(e) => setState(e.target.value)} placeholder="CDMX" />
            </div>
          </div>
          <PlaceSearch
            idPrefix="tester"
            onFound={(p) => {
              setFlyTo({ ...p, zoom: 15 });
              onPin(p);
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            {pin ? (
              <>
                <span className="font-mono">
                  {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPin(null);
                    setResult(null);
                  }}
                >
                  <X aria-hidden className="h-3.5 w-3.5" />
                  Quitar pin
                </Button>
              </>
            ) : (
              <span>Sin pin: haz clic en el mapa para probar por ubicación.</span>
            )}
          </div>
          <Button type="submit" className="w-full" loading={lookup.isPending} disabled={!canTest}>
            Probar
          </Button>
        </form>

        {error ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {result && matched ? (
          <div className="space-y-1.5 rounded-md border border-hairline bg-background p-3" aria-live="polite">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{result.zoneName ?? "Sin zona"}</span>
              <Money value={result.price} emphasis />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={result.matchedBy} tone={matched.tone} label={matched.label} />
              {result.fallback ? (
                <span className="text-xs text-muted-foreground">Se cobra el envío fijo de la empresa.</span>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
