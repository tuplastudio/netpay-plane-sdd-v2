"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MessageSquareText, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { SkeletonText } from "@/components/ui/skeleton";
import { Section } from "@/components/app/section";
import { apiErrorMessage } from "./api-error";
import { TENANT_QUERY_KEY, useTenantMe, type Tenant } from "./tenant";

/**
 * Plantillas aprobadas por Meta, por clave interna de plantilla.
 *
 * Por qué existe esta pantalla: la Política Comercial de WhatsApp sólo
 * permite texto libre dentro de la ventana de servicio de 24 h. Pasadas esas
 * horas, un mensaje que inicia el negocio —el recordatorio de una cotización
 * sin pagar, por ejemplo— tiene que salir como plantilla aprobada. Sin una
 * entrada aquí, el despachador CANCELA esa notificación con el motivo a la
 * vista en la tabla de arriba, en vez de mandarla violando la política.
 *
 * El nombre es el que quedó aprobado en el WhatsApp Manager del negocio; el
 * texto que arma el sistema viaja como primer parámetro del cuerpo.
 */

/** Claves que el negocio puede mandar fuera de ventana. Las demás plantillas
 * contestan a algo que el cliente acaba de hacer, así que siempre caen
 * dentro de la ventana y no necesitan plantilla aprobada. */
const TEMPLATE_KEYS: Array<{ value: string; label: string }> = [
  { value: "QUOTE_REMINDER", label: "Recordatorio de cotización sin pagar" },
  { value: "QUOTE_LINK", label: "Link de cotización" },
  { value: "QUOTE_UPDATED", label: "Cotización actualizada" },
  { value: "REMINDER", label: "Pedido pendiente de pago" },
];

const LANGUAGES = ["es_MX", "es", "es_ES", "en_US"];

interface Row {
  key: string;
  name: string;
  language: string;
}

function toRows(tenant: Tenant): Row[] {
  const configured = tenant.whatsappTemplates ?? {};
  return Object.entries(configured).map(([key, value]) => ({
    key,
    name: typeof value === "string" ? value : (value?.name ?? ""),
    language: typeof value === "string" ? "es_MX" : (value?.language ?? "es_MX"),
  }));
}

export function WhatsAppTemplatesSection() {
  const queryClient = useQueryClient();
  const tenant = useTenantMe();
  const [rows, setRows] = useState<Row[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (tenant.data && !dirty) setRows(toRows(tenant.data));
  }, [tenant.data, dirty]);

  const save = useMutation({
    mutationFn: async (next: Row[]) => {
      const payload: Record<string, { name: string; language: string }> = {};
      for (const row of next) {
        if (row.key && row.name.trim()) {
          payload[row.key] = { name: row.name.trim(), language: row.language };
        }
      }
      const res = await api.patch<{ data: Tenant }>("/tenants/me/settings", {
        whatsappTemplates: payload,
      });
      return res.data.data;
    },
    onSuccess: async (saved) => {
      toast.success("Plantillas actualizadas");
      setDirty(false);
      setRows(toRows(saved));
      await queryClient.invalidateQueries({ queryKey: TENANT_QUERY_KEY });
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudieron guardar las plantillas")),
  });

  function update(index: number, patch: Partial<Row>) {
    setDirty(true);
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function add() {
    const used = new Set(rows.map((r) => r.key));
    const next = TEMPLATE_KEYS.find((t) => !used.has(t.value));
    if (!next) return;
    setDirty(true);
    setRows((current) => [...current, { key: next.value, name: "", language: "es_MX" }]);
  }

  function remove(index: number) {
    setDirty(true);
    setRows((current) => current.filter((_, i) => i !== index));
  }

  return (
    <Section
      title="Plantillas aprobadas de WhatsApp"
      headerIcon={<MessageSquareText className="h-4 w-4" />}
      description="Necesarias para escribirle a un cliente que lleva más de 24 h sin responder."
      actions={
        <Button variant="outline" size="sm" onClick={add} disabled={rows.length >= TEMPLATE_KEYS.length}>
          <Plus className="h-4 w-4" />
          Agregar
        </Button>
      }
    >
      {tenant.isLoading || !tenant.data ? (
        <SkeletonText lines={3} announce label="Cargando las plantillas…" />
      ) : (
        <div className="space-y-4">
          <Alert>
            <AlertTitle>Cómo funciona</AlertTitle>
            <AlertDescription>
              WhatsApp sólo deja mandar texto libre durante las 24 h siguientes al último
              mensaje del cliente. Después, el mensaje tiene que ser una plantilla que Meta ya
              aprobó en tu WhatsApp Manager. Si no registras una aquí, esos envíos quedan
              cancelados —los ves arriba con su motivo— en lugar de salir y arriesgar la cuenta.
            </AlertDescription>
          </Alert>

          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin plantillas registradas: fuera de la ventana de 24 h no se manda nada.
            </p>
          ) : (
            <ul className="space-y-3">
              {rows.map((row, index) => (
                <li
                  key={`${row.key}-${index}`}
                  className="grid grid-cols-1 gap-3 rounded-card border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem_auto] sm:items-end"
                >
                  <div className="space-y-1.5">
                    <Label htmlFor={`key-${index}`}>Mensaje</Label>
                    <Select
                      id={`key-${index}`}
                      value={row.key}
                      onChange={(e) => update(index, { key: e.target.value })}
                    >
                      {TEMPLATE_KEYS.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`name-${index}`}>Nombre en Meta</Label>
                    <Input
                      id={`name-${index}`}
                      value={row.name}
                      placeholder="recordatorio_cotizacion"
                      onChange={(e) => update(index, { name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`lang-${index}`}>Idioma</Label>
                    <Select
                      id={`lang-${index}`}
                      value={row.language}
                      onChange={(e) => update(index, { language: e.target.value })}
                    >
                      {LANGUAGES.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(index)}
                    aria-label={`Quitar la plantilla de ${row.key}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center gap-3">
            <Button onClick={() => save.mutate(rows)} disabled={!dirty || save.isPending}>
              {save.isPending ? "Guardando…" : "Guardar plantillas"}
            </Button>
            {dirty ? (
              <Button
                variant="ghost"
                disabled={save.isPending}
                onClick={() => {
                  setDirty(false);
                  if (tenant.data) setRows(toRows(tenant.data));
                }}
              >
                Descartar
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </Section>
  );
}
