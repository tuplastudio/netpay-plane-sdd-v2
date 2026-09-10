"use client";

import * as React from "react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, ImageIcon, Palette, Trash2, Upload, X } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SkeletonText } from "@/components/ui/skeleton";
import { Section } from "@/components/app/section";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { apiErrorMessage } from "./api-error";
import { TENANT_QUERY_KEY, useTenantMe, type Tenant } from "./tenant";

/** Mismo criterio que `@IsHexColor()` en el DTO del backend. */
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const hexColor = z.string().regex(HEX_RE, "Usa un color hex, p. ej. #DB0025");

const schema = z.object({
  primaryColor: hexColor,
  secondaryColor: hexColor,
  accentColor: hexColor,
});

type FormValues = z.infer<typeof schema>;
type ColorKey = "primaryColor" | "secondaryColor" | "accentColor";

const COLOR_FIELDS: Array<{ key: ColorKey; label: string; hint: string }> = [
  { key: "primaryColor", label: "Color primario", hint: "Botones y acentos principales." },
  { key: "secondaryColor", label: "Color secundario", hint: "Texto de apoyo y fondos suaves." },
  { key: "accentColor", label: "Color de acento", hint: "Enlaces y detalles." },
];

function toForm(t: Tenant): FormValues {
  return {
    primaryColor: t.primaryColor,
    secondaryColor: t.secondaryColor,
    accentColor: t.accentColor,
  };
}

const EMPTY: FormValues = { primaryColor: "", secondaryColor: "", accentColor: "" };

export function BrandingSection() {
  const queryClient = useQueryClient();
  const tenant = useTenantMe();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: EMPTY });

  // Sincroniza con el servidor solo mientras no haya cambios locales: un refetch
  // en segundo plano (foco de ventana) no debe pisar lo que el usuario escribe.
  useEffect(() => {
    if (tenant.data && !isDirty) reset(toForm(tenant.data));
  }, [tenant.data, isDirty, reset]);

  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      const res = await api.patch<{ data: Tenant }>("/tenants/me/branding", {
        primaryColor: values.primaryColor,
        secondaryColor: values.secondaryColor,
        accentColor: values.accentColor,
      });
      return res.data.data;
    },
    onSuccess: async (saved) => {
      toast.success("Marca actualizada");
      reset(toForm(saved));
      await queryClient.invalidateQueries({ queryKey: TENANT_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: ["auth-me"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo actualizar la marca")),
  });

  const colors = watch(["primaryColor", "secondaryColor", "accentColor"]);

  return (
    <Section
      title="Marca"
      headerIcon={<Palette className="h-4 w-4" />}
      description="Logo y colores que ve tu equipo en el portal y tus clientes en las cotizaciones."
    >
      {tenant.isError ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>No se pudo cargar la marca</AlertTitle>
          <AlertDescription>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void tenant.refetch()}
            >
              Reintentar
            </Button>
          </AlertDescription>
        </Alert>
      ) : tenant.isLoading || !tenant.data ? (
        <SkeletonText lines={4} announce label="Cargando la marca…" />
      ) : (
        <div className="space-y-6">
          <LogoUploader tenant={tenant.data} />

          <form
            noValidate
            onSubmit={handleSubmit((values) => save.mutate(values))}
            className="space-y-4"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {COLOR_FIELDS.map((field, i) => {
                const value = colors[i] ?? "";
                const error = errors[field.key];
                const errorId = `brand-${field.key}-error`;
                const hintId = `brand-${field.key}-hint`;
                return (
                  <div key={field.key} className="space-y-1.5">
                    <Label htmlFor={`brand-${field.key}`}>{field.label}</Label>
                    <div className="flex items-center gap-2">
                      {/*
                        El selector nativo exige un hex válido; mientras el texto
                        está a medias el navegador cae a su propio negro por
                        defecto. No es un token de diseño: es el valor del dato.
                      */}
                      <Input
                        type="color"
                        aria-label={`${field.label}: selector`}
                        value={HEX_RE.test(value) ? value : "#000000"}
                        onChange={(e) =>
                          setValue(field.key, e.target.value, {
                            shouldDirty: true,
                            shouldValidate: true,
                          })
                        }
                        className="w-14 shrink-0 cursor-pointer p-1"
                      />
                      <Input
                        id={`brand-${field.key}`}
                        className="font-mono text-xs"
                        placeholder="#000000"
                        autoComplete="off"
                        spellCheck={false}
                        aria-invalid={!!error}
                        aria-describedby={error ? errorId : hintId}
                        {...register(field.key)}
                      />
                    </div>
                    {error ? (
                      <p id={errorId} className="text-xs text-destructive">
                        {error.message}
                      </p>
                    ) : (
                      <p id={hintId} className="text-xs text-muted-foreground">
                        {field.hint}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Vista previa</p>
              <div
                className="flex h-10 overflow-hidden rounded-lg border border-input"
                role="img"
                aria-label={`Paleta: ${colors.filter(Boolean).join(", ") || "sin colores"}`}
              >
                {colors.map((c, i) => (
                  <span
                    key={COLOR_FIELDS[i]?.key ?? i}
                    aria-hidden
                    className="flex-1"
                    style={HEX_RE.test(c ?? "") ? { backgroundColor: c } : undefined}
                  />
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm" loading={save.isPending} disabled={!isDirty}>
                {save.isPending ? "Guardando…" : "Guardar colores"}
              </Button>
              {isDirty ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={save.isPending}
                  onClick={() => reset(tenant.data ? toForm(tenant.data) : undefined)}
                >
                  Descartar cambios
                </Button>
              ) : null}
            </div>
          </form>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Logo
// ---------------------------------------------------------------------------

/**
 * Mismas reglas que `apps/commerce-api/src/tenants/logo-validation.ts`. Aquí
 * se filtra antes de subir para dar la respuesta al instante; el backend
 * vuelve a validar sobre los bytes reales y es quien manda.
 */
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_MIN_SIDE = 128;
const LOGO_MAX_SIDE = 4096;
const LOGO_MAX_ASPECT = 3;
const LOGO_TYPES: Record<string, string> = {
  "image/png": "PNG",
  "image/jpeg": "JPG",
  "image/webp": "WebP",
  "image/svg+xml": "SVG",
};
const LOGO_EXT_TO_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
};
const LOGO_ACCEPT = Object.keys(LOGO_TYPES).join(",");
const LOGO_RULES = "PNG, JPG, WebP o SVG · máximo 2 MB · entre 128×128 y 4096×4096 px · proporción de 1:3 a 3:1.";

function fmtMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(2).replace(/\.?0+$/, "");
}

interface PendingLogo {
  file: File;
  previewUrl: string;
  width: number;
  height: number;
}

function resolveType(file: File): string | null {
  const declared = file.type.toLowerCase();
  if (declared in LOGO_TYPES) return declared;
  // Algunos sistemas no ponen `type` (p. ej. WebP en Windows): se mira la extensión.
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return LOGO_EXT_TO_TYPE[ext] ?? null;
}

/** Lee las dimensiones con `<img>`; también funciona para SVG. */
function readDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("decode"));
    img.src = url;
  });
}

/** Devuelve el mensaje de rechazo o `null` si pasa las prevalidaciones. */
async function precheckLogo(file: File): Promise<{ error: string } | { ok: PendingLogo }> {
  if (file.type.toLowerCase() === "image/gif" || /\.gif$/i.test(file.name)) {
    return { error: "Los GIF no están permitidos (suelen ser animados): usa PNG, JPG, WebP o SVG." };
  }
  const type = resolveType(file);
  if (!type) return { error: "Formato no permitido. Sube un PNG, JPG, WebP o SVG." };
  if (file.size === 0) return { error: "El archivo está vacío." };
  if (file.size > LOGO_MAX_BYTES) {
    return { error: `El logo pesa ${fmtMb(file.size)} MB; el máximo es ${fmtMb(LOGO_MAX_BYTES)} MB.` };
  }
  const previewUrl = URL.createObjectURL(file);
  let dims: { width: number; height: number };
  try {
    dims = await readDimensions(previewUrl);
  } catch {
    URL.revokeObjectURL(previewUrl);
    return { error: "No se pudo leer la imagen; el archivo puede estar dañado." };
  }
  const vector = type === "image/svg+xml";
  const { width, height } = dims;
  // Un SVG sin width/height reporta 0 o 300×150 según el navegador: no se
  // castiga por eso; el backend lo mira con el viewBox.
  if (!vector || (width > 0 && height > 0)) {
    if (!vector && (width < LOGO_MIN_SIDE || height < LOGO_MIN_SIDE)) {
      URL.revokeObjectURL(previewUrl);
      return { error: `El logo mide ${width}×${height} px; el mínimo es ${LOGO_MIN_SIDE}×${LOGO_MIN_SIDE} px.` };
    }
    if (width > LOGO_MAX_SIDE || height > LOGO_MAX_SIDE) {
      URL.revokeObjectURL(previewUrl);
      return { error: `El logo mide ${width}×${height} px; el máximo es ${LOGO_MAX_SIDE}×${LOGO_MAX_SIDE} px.` };
    }
    if (width > 0 && height > 0) {
      const ratio = width / height;
      if (ratio > LOGO_MAX_ASPECT || ratio < 1 / LOGO_MAX_ASPECT) {
        URL.revokeObjectURL(previewUrl);
        return {
          error: `La proporción del logo (${width}×${height}) es demasiado alargada; debe estar entre 1:${LOGO_MAX_ASPECT} y ${LOGO_MAX_ASPECT}:1.`,
        };
      }
    }
  }
  return { ok: { file, previewUrl, width, height } };
}

function LogoUploader({ tenant }: { tenant: Tenant }) {
  const queryClient = useQueryClient();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [pending, setPending] = React.useState<PendingLogo | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [checking, setChecking] = React.useState(false);
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  const errorId = React.useId();
  const rulesId = React.useId();

  // El object URL del archivo pendiente se libera al cambiarlo o desmontar.
  useEffect(() => {
    return () => {
      if (pending) URL.revokeObjectURL(pending.previewUrl);
    };
  }, [pending]);

  const applyTenant = React.useCallback(
    async (saved: Tenant) => {
      queryClient.setQueryData(TENANT_QUERY_KEY, saved);
      await queryClient.invalidateQueries({ queryKey: TENANT_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: ["auth-me"] });
    },
    [queryClient],
  );

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append("file", file, file.name);
      // Axios quita este header en el navegador y deja que él ponga el
      // boundary; sin él, el default `application/json` del cliente
      // serializaría el FormData como JSON.
      const res = await api.post<{ data: Tenant }>("/tenants/me/logo", body, {
        headers: { "content-type": "multipart/form-data" },
      });
      return res.data.data;
    },
    onSuccess: async (saved) => {
      toast.success("Logo actualizado");
      setPending(null);
      setError(null);
      await applyTenant(saved);
    },
    onError: (err) => setError(apiErrorMessage(err, "No se pudo subir el logo")),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const res = await api.delete<{ data: Tenant }>("/tenants/me/logo");
      return res.data.data;
    },
    onSuccess: async (saved) => {
      toast.success("Logo eliminado");
      setConfirmRemove(false);
      await applyTenant(saved);
    },
    onError: (err) => {
      setConfirmRemove(false);
      toast.error(apiErrorMessage(err, "No se pudo quitar el logo"));
    },
  });

  const pick = React.useCallback(async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setChecking(true);
    try {
      const result = await precheckLogo(file);
      if ("error" in result) {
        setPending(null);
        setError(result.error);
      } else {
        setPending(result.ok);
      }
    } finally {
      setChecking(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (upload.isPending) return;
    const file = e.dataTransfer.files?.[0];
    if (e.dataTransfer.files && e.dataTransfer.files.length > 1) {
      setError("Sube un solo archivo.");
      return;
    }
    void pick(file);
  };

  const busy = upload.isPending || checking;
  const shownUrl = pending?.previewUrl ?? tenant.logoUrl;
  const shownLabel = pending ? `Vista previa de ${pending.file.name}` : "Logo actual";

  return (
    <div className="space-y-3">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">Logo</p>
        <p id={rulesId} className="text-xs text-muted-foreground">
          {LOGO_RULES}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Zona de carga */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-5 text-center transition-colors",
            dragging ? "border-primary bg-muted" : "border-input",
            busy && "opacity-70",
          )}
        >
          <Upload aria-hidden className="h-5 w-5 text-muted-foreground" />
          <p className="text-sm">
            Arrastra tu logo aquí{" "}
            <span className="text-muted-foreground">o</span>
          </p>
          <input
            ref={inputRef}
            type="file"
            accept={LOGO_ACCEPT}
            className="sr-only"
            aria-describedby={error ? errorId : rulesId}
            aria-invalid={!!error}
            onChange={(e) => void pick(e.target.files?.[0])}
            disabled={busy}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={checking}
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {checking ? "Revisando…" : "Elegir archivo"}
          </Button>
          {error ? (
            <p id={errorId} role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        {/* Vista previa sobre fondo claro y oscuro */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{shownLabel}</p>
          <div
            className="grid grid-cols-2 overflow-hidden rounded-lg border border-input"
            role="img"
            aria-label={shownUrl ? `${shownLabel} sobre fondo claro y oscuro` : "Sin logo"}
          >
            {(["light", "dark"] as const).map((bg) => (
              <div
                key={bg}
                aria-hidden
                className={cn(
                  "flex h-24 items-center justify-center p-3",
                  bg === "light" ? "bg-white" : "bg-neutral-900",
                )}
              >
                {shownUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- origen externo (API), sin optimizador
                  <img
                    src={shownUrl}
                    alt=""
                    className="max-h-16 max-w-full object-contain"
                  />
                ) : (
                  <ImageIcon
                    className={cn("h-6 w-6", bg === "light" ? "text-neutral-300" : "text-neutral-600")}
                  />
                )}
              </div>
            ))}
          </div>
          {pending ? (
            <p className="text-xs text-muted-foreground">
              {pending.file.name} · {fmtMb(pending.file.size)} MB
              {pending.width > 0 ? ` · ${pending.width}×${pending.height} px` : ""}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {pending ? (
          <>
            <Button
              type="button"
              size="sm"
              loading={upload.isPending}
              onClick={() => upload.mutate(pending.file)}
            >
              {upload.isPending ? "Subiendo…" : "Subir logo"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={upload.isPending}
              onClick={() => {
                setPending(null);
                setError(null);
              }}
            >
              <X aria-hidden className="h-3.5 w-3.5" />
              Cancelar
            </Button>
          </>
        ) : tenant.logoUrl ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => setConfirmRemove(true)}
          >
            <Trash2 aria-hidden className="h-3.5 w-3.5" />
            Quitar logo
          </Button>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={(open) => {
          if (!remove.isPending) setConfirmRemove(open);
        }}
        title="¿Quitar el logo?"
        description="Las cotizaciones y el portal dejarán de mostrarlo. Puedes subir otro cuando quieras."
        confirmLabel="Quitar logo"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}
