"use client";
import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { ImageIcon, Trash2, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { apiErrorMessage, type ProductImage } from "../catalog-shared";

const ACCEPT = "image/png,image/jpeg,image/webp";

/**
 * Galería de fotos: sube (multipart, campo `file`), muestra en cuadrícula y
 * borra una por una. Se usa igual para la galería general del producto
 * (`uploadUrl` = `/catalog/products/:id/images`) y para la propia de una
 * variante (`/catalog/variants/:id/images`); el backend acepta varias
 * llamadas — cada una agrega una foto más, nunca reemplaza las anteriores.
 */
export function ImageGallery({
  images,
  uploadUrl,
  onChanged,
  compact = false,
}: {
  images: ProductImage[];
  uploadUrl: string;
  onChanged: () => Promise<unknown> | void;
  compact?: boolean;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append("file", file, file.name);
      await api.post(uploadUrl, body, { headers: { "content-type": "multipart/form-data" } });
    },
    onSuccess: async () => {
      toast.success("Foto agregada");
      await onChanged();
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo subir la foto")),
  });

  const remove = useMutation({
    mutationFn: async (imageId: string) => {
      await api.delete(`/catalog/images/${imageId}`);
    },
    onSuccess: async () => {
      toast.success("Foto eliminada");
      await onChanged();
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo eliminar la foto")),
  });

  const pickFile = () => inputRef.current?.click();

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) upload.mutate(file);
  };

  const thumbSize = compact ? "h-14 w-14" : "h-20 w-20";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {images.map((image) => (
          <div key={image.id} className={`group relative shrink-0 ${thumbSize}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- fotos de catálogo servidas por el API, fuera de next/image */}
            <img
              src={image.url}
              alt=""
              className="h-full w-full rounded-md border object-cover"
            />
            <button
              type="button"
              aria-label="Eliminar foto"
              disabled={remove.isPending && remove.variables === image.id}
              onClick={() => remove.mutate(image.id)}
              className="absolute -right-1.5 -top-1.5 rounded-full bg-destructive p-1 text-destructive-foreground opacity-0 shadow transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground group-hover:opacity-100 disabled:opacity-60"
            >
              {remove.isPending && remove.variables === image.id ? (
                <Spinner size="sm" />
              ) : (
                <Trash2 aria-hidden className="h-3 w-3" />
              )}
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={pickFile}
          disabled={upload.isPending}
          aria-label="Agregar foto"
          className={`flex ${thumbSize} shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-dashed text-muted-foreground transition-colors hover:border-foreground hover:text-foreground disabled:opacity-60`}
        >
          {upload.isPending ? (
            <Spinner size="sm" />
          ) : images.length === 0 ? (
            <>
              <ImageIcon aria-hidden className="h-4 w-4" />
              <span className="text-[10px] leading-none">Sin fotos</span>
            </>
          ) : (
            <Upload aria-hidden className="h-4 w-4" />
          )}
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        onChange={onFileChange}
        className="hidden"
      />
      <Button type="button" size="sm" variant="outline" onClick={pickFile} loading={upload.isPending}>
        <Upload aria-hidden className="h-4 w-4" />
        Agregar foto
      </Button>
    </div>
  );
}
