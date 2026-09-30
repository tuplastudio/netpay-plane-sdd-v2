"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { apiErrorMessage } from "./api-error";
import type { ApiKey, RotatedApiKey } from "./api-key-helpers";

/** Opciones de gracia para la key vieja (horas). 0 = revocar de inmediato. */
const GRACE_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: "Revocar de inmediato" },
  { value: 1, label: "1 hora" },
  { value: 24, label: "24 horas (recomendado)" },
  { value: 72, label: "3 días" },
  { value: 168, label: "7 días" },
];

/**
 * `POST {basePath}/:id/rotate`. La confirmación deja elegir cuánto sigue
 * valiendo la key anterior, para cambiar el secreto en la integración sin
 * cortar el servicio. El secreto nuevo lo muestra el banner de la sección.
 */
export function ApiKeyRotateDialog({
  basePath,
  apiKey,
  open,
  onOpenChange,
  onRotated,
}: {
  basePath: string;
  apiKey: ApiKey | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRotated: (rotated: RotatedApiKey) => void;
}) {
  const [graceHours, setGraceHours] = useState(24);

  useEffect(() => {
    if (open) setGraceHours(24);
  }, [open]);

  const rotate = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post<{ data: RotatedApiKey }>(`${basePath}/${id}/rotate`, { graceHours });
      return res.data.data;
    },
    onSuccess: (data) => {
      toast.success("Secreto rotado");
      onOpenChange(false);
      onRotated(data);
    },
    onError: (error) => {
      onOpenChange(false);
      toast.error(apiErrorMessage(error, "No se pudo rotar la key"));
    },
  });

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      variant="default"
      title={`¿Rotar el secreto de "${apiKey?.name ?? ""}"?`}
      description="Se genera un secreto nuevo con los mismos permisos y vencimiento. Actualízalo en tu integración antes de que venza el periodo de gracia de la key actual."
      confirmLabel="Rotar secreto"
      pending={rotate.isPending}
      onConfirm={() => {
        if (!apiKey) return;
        rotate.mutate(apiKey.id);
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="rotate-grace">La key actual sigue valiendo</Label>
        <Select
          id="rotate-grace"
          value={String(graceHours)}
          onChange={(e) => setGraceHours(Number(e.target.value))}
          disabled={rotate.isPending}
        >
          {GRACE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <p className="text-xs text-muted-foreground">
          Durante la gracia las dos keys funcionan; en “Ver uso” puedes comprobar cuándo la vieja deja de
          recibir tráfico.
        </p>
      </div>
    </ConfirmDialog>
  );
}
