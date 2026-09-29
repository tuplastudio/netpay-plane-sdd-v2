"use client";

import * as React from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { cn } from "@/lib/utils";
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  boundsOf,
  geometryToLatLngs,
  type LatLng,
  type LngLat,
  type ZoneGeometry,
} from "./geo";

/**
 * Mapa Leaflet de zonas de envío. Se carga SIEMPRE con `next/dynamic`
 * (`ssr: false`): Leaflet toca `window` al importarse.
 *
 * Tres modos:
 * - `view`: solo muestra las zonas (tooltip con nombre y precio).
 * - `pin`: un clic suelta un pin (`onPin`) para el probador de direcciones.
 * - `draw`: cada clic agrega un vértice al `draft`; los vértices son
 *   marcadores arrastrables (`onDraftChange`); clic derecho sobre uno lo quita.
 *
 * Los colores de las zonas vienen del dato (`color` guardado o paleta de
 * tokens resuelta en el padre): aquí no hay hex en código.
 */

// Leaflet arma la URL de los íconos por defecto a partir del CSS y con
// bundlers sale rota (icono invisible). Se fija con los PNG del paquete, que
// Next sirve como assets estáticos.
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon.src,
  iconRetinaUrl: markerIcon2x.src,
  shadowUrl: markerShadow.src,
});

export interface ZoneMapZone {
  id: string;
  name: string;
  /** Hex ya resuelto. */
  color: string;
  geometry: ZoneGeometry | null;
  /** Texto ya formateado del precio (para el tooltip). */
  priceLabel: string;
  active: boolean;
}

export type ZoneMapMode = "view" | "pin" | "draw";

export interface ZoneMapProps {
  zones: ZoneMapZone[];
  mode: ZoneMapMode;
  /** Zona resaltada (más opaca); las demás se atenúan. */
  highlightId?: string | null;
  /** Vértices `[lng, lat]` del polígono en edición. */
  draft?: LngLat[] | null;
  draftColor?: string;
  onDraftChange?: (vertices: LngLat[]) => void;
  pin?: { lat: number; lng: number } | null;
  onPin?: (p: { lat: number; lng: number }) => void;
  /** Vuela a este punto cuando cambia (búsqueda). */
  flyTo?: { lat: number; lng: number; zoom?: number } | null;
  /** Cambia para forzar un `fitBounds` a zonas + borrador (p. ej. al abrir). */
  fitKey?: string | number;
  className?: string;
  /** Nombre accesible del mapa. */
  label: string;
}

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

function vertexIcon(color: string): L.DivIcon {
  // Clases de Tailwind en el string: el JIT las recoge igual que en JSX. El
  // único estilo inline es el color de la zona, que es dato, no tema.
  return L.divIcon({
    className: "zone-vertex-handle",
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    html: `<span class="block h-4 w-4 cursor-grab rounded-full border-2 border-background shadow-2 ring-1 ring-hairline-strong" style="background:${color}"></span>`,
  });
}

export default function ZoneMap({
  zones,
  mode,
  highlightId = null,
  draft = null,
  draftColor,
  onDraftChange,
  pin = null,
  onPin,
  flyTo = null,
  fitKey,
  className,
  label,
}: ZoneMapProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<L.Map | null>(null);
  const zonesLayerRef = React.useRef<L.LayerGroup | null>(null);
  const draftLayerRef = React.useRef<L.LayerGroup | null>(null);
  const pinLayerRef = React.useRef<L.LayerGroup | null>(null);

  // Callbacks en refs: el handler de clic del mapa se registra una vez y
  // lee siempre la versión más reciente sin re-suscribirse.
  const modeRef = React.useRef(mode);
  const draftRef = React.useRef(draft);
  const onDraftChangeRef = React.useRef(onDraftChange);
  const onPinRef = React.useRef(onPin);
  modeRef.current = mode;
  draftRef.current = draft;
  onDraftChangeRef.current = onDraftChange;
  onPinRef.current = onPin;

  // Montaje del mapa.
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;
    const map = L.map(el, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
      attributionControl: true,
      // El scroll de la página no debe pelearse con el zoom del mapa dentro
      // de un Sheet; el usuario hace zoom con los botones o Ctrl+rueda.
      scrollWheelZoom: false,
    });
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
    zonesLayerRef.current = L.layerGroup().addTo(map);
    draftLayerRef.current = L.layerGroup().addTo(map);
    pinLayerRef.current = L.layerGroup().addTo(map);

    map.on("click", (e: L.LeafletMouseEvent) => {
      const m = modeRef.current;
      if (m === "draw") {
        const next: LngLat[] = [...(draftRef.current ?? []), [e.latlng.lng, e.latlng.lat]];
        onDraftChangeRef.current?.(next);
      } else if (m === "pin") {
        onPinRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng });
      }
    });
    mapRef.current = map;

    // Dentro de un Sheet el contenedor cambia de tamaño tras la animación.
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    const t = window.setTimeout(() => map.invalidateSize(), 350);

    return () => {
      window.clearTimeout(t);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Cursor según modo.
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.style.cursor = mode === "view" ? "" : "crosshair";
  }, [mode]);

  // Zonas guardadas.
  React.useEffect(() => {
    const layer = zonesLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    for (const z of zones) {
      if (!z.geometry) continue;
      const dim = highlightId && highlightId !== z.id;
      const poly = L.polygon(geometryToLatLngs(z.geometry), {
        color: z.color,
        weight: dim ? 1 : 2,
        opacity: dim ? 0.35 : z.active ? 0.9 : 0.5,
        fillColor: z.color,
        fillOpacity: dim ? 0.06 : z.active ? 0.22 : 0.1,
        dashArray: z.active ? undefined : "6 4",
        // Los clics sobre un polígono burbujean al mapa (Leaflet lo hace por
        // defecto), así que el pin y el dibujo funcionan también encima de
        // otra zona, y el tooltip sigue disponible.
        interactive: true,
      });
      poly.bindTooltip(`${z.name} · ${z.priceLabel}${z.active ? "" : " · inactiva"}`, { sticky: true });
      layer.addLayer(poly);
    }
  }, [zones, highlightId]);

  // Borrador en edición: polígono + vértices arrastrables.
  React.useEffect(() => {
    const layer = draftLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!draft || draft.length === 0) return;
    const color = draftColor ?? "currentColor";
    const latlngs: LatLng[] = draft.map(([lng, lat]) => [lat, lng]);
    if (latlngs.length >= 3) {
      layer.addLayer(
        L.polygon(latlngs, { color, weight: 2, fillColor: color, fillOpacity: 0.25, interactive: false }),
      );
    } else if (latlngs.length === 2) {
      layer.addLayer(L.polyline(latlngs, { color, weight: 2, dashArray: "4 4", interactive: false }));
    }
    if (mode !== "draw") return;
    draft.forEach(([lng, lat], index) => {
      const marker = L.marker([lat, lng], {
        icon: vertexIcon(color),
        draggable: true,
        keyboard: false,
        title: `Vértice ${index + 1}`,
      });
      marker.on("drag", () => {
        // Mientras arrastra solo movemos el polígono visual; el estado se
        // confirma en dragend para no re-renderizar el árbol a 60fps.
        const ll = marker.getLatLng();
        const current = draftRef.current ?? [];
        const next = current.map((v, i) => (i === index ? ([ll.lng, ll.lat] as LngLat) : v));
        layer.eachLayer((l) => {
          if (l instanceof L.Polygon || l instanceof L.Polyline) {
            l.setLatLngs(next.map(([x, y]) => [y, x] as LatLng));
          }
        });
      });
      marker.on("dragend", () => {
        const ll = marker.getLatLng();
        const current = draftRef.current ?? [];
        onDraftChangeRef.current?.(
          current.map((v, i) => (i === index ? ([ll.lng, ll.lat] as LngLat) : v)),
        );
      });
      marker.on("contextmenu", (e) => {
        L.DomEvent.stopPropagation(e);
        const current = draftRef.current ?? [];
        onDraftChangeRef.current?.(current.filter((_, i) => i !== index));
      });
      // Un clic en un vértice no debe agregar otro vértice debajo.
      marker.on("click", (e) => L.DomEvent.stopPropagation(e));
      layer.addLayer(marker);
    });
  }, [draft, draftColor, mode]);

  // Pin del probador.
  React.useEffect(() => {
    const layer = pinLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!pin) return;
    layer.addLayer(L.marker([pin.lat, pin.lng], { title: "Punto a probar", keyboard: false }));
  }, [pin]);

  // Encuadre inicial / bajo demanda.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const pts: LatLng[] = [];
    for (const z of zones) {
      if (!z.geometry) continue;
      for (const poly of geometryToLatLngs(z.geometry)) {
        for (const ring of poly) pts.push(...ring);
      }
    }
    if (draft) for (const [lng, lat] of draft) pts.push([lat, lng]);
    if (pin) pts.push([pin.lat, pin.lng]);
    const b = boundsOf(pts);
    if (!b) return;
    const fit = () => {
      map.invalidateSize();
      map.fitBounds(L.latLngBounds(b[0], b[1]), { padding: [24, 24], maxZoom: 15 });
    };
    fit();
    // Dentro de un Sheet el contenedor termina de medirse tras la animación
    // de entrada: segundo encuadre cuando ya tiene su tamaño real.
    const t = window.setTimeout(fit, 400);
    return () => window.clearTimeout(t);
    // Solo cuando cambia la llave o al montar: encuadrar en cada cambio de
    // borrador haría saltar el mapa mientras el admin dibuja.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  // Vuelo a un punto buscado.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTo) return;
    map.flyTo([flyTo.lat, flyTo.lng], flyTo.zoom ?? 14, { duration: 0.6 });
  }, [flyTo]);

  return (
    <div
      ref={containerRef}
      role="application"
      aria-label={label}
      className={cn(
        "relative z-0 h-64 w-full overflow-hidden rounded-lg border border-hairline bg-muted sm:h-80",
        className,
      )}
    />
  );
}
