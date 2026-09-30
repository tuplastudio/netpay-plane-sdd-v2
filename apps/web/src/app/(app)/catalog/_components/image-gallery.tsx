"use client";
import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  GripVertical,
  ImageIcon,
  MoreHorizontal,
  Star,
  TextCursorInput,
  Trash2,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tip } from "@/components/app/info-tip";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { apiErrorMessage, type ProductImage } from "../catalog-shared";
import { MAX_ALT_TEXT_LENGTH, imageAlt, moveItem, sortByPosition } from "./image-helpers";
import { ImageDropzone, UploadQueueList, useImageUploadQueue } from "./image-upload";

const DND_MIME = "application/x-easysell-image-id";

/**
 * Galería administrable de fotos: subida múltiple (arrastrar o elegir) con
 * progreso por archivo, orden (arrastrar o flechas), portada, texto
 * alternativo y borrado con confirmación. Sirve igual para la galería
 * general del producto (`uploadUrl` = `/catalog/products/:id/images`) y para
 * la de una variante (`/catalog/variants/:id/images`); el orden siempre se
 * manda a `/catalog/products/:productId/images/reorder`, que infiere la
 * galería por las fotos.
 */
export function ImageGallery({
  images,
  productId,
  uploadUrl,
  onChanged,
  compact = false,
  altFallback,
}: {
  images: ProductImage[];
  productId: string;
  uploadUrl: string;
  onChanged: () => Promise<unknown> | void;
  compact?: boolean;
  /** Título del producto/variante: `alt` de las fotos sin texto propio. */
  altFallback: string;
}) {
  // Orden local para reordenar de forma optimista; se resincroniza cuando
  // llega la galería nueva del servidor.
  const [order, setOrder] = React.useState<ProductImage[]>(() => sortByPosition(images));
  React.useEffect(() => setOrder(sortByPosition(images)), [images]);
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [overId, setOverId] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<ProductImage | null>(null);
  const [altTarget, setAltTarget] = React.useState<ProductImage | null>(null);

  const queue = useImageUploadQueue({ onUploaded: onChanged });

  const reorder = useMutation({
    mutationFn: async (imageIds: string[]) => {
      const res = await api.post(`/catalog/products/${productId}/images/reorder`, { imageIds });
      return res.data.data as ProductImage[];
    },
    onSuccess: async () => {
      await onChanged();
    },
    onError: (error) => {
      setOrder(sortByPosition(images));
      toast.error(apiErrorMessage(error, "No se pudo reordenar las fotos"));
    },
  });

  const setPrimary = useMutation({
    mutationFn: async (imageId: string) => {
      const res = await api.post(`/catalog/images/${imageId}/primary`);
      return res.data.data as ProductImage[];
    },
    onSuccess: async () => {
      toast.success("Portada actualizada");
      await onChanged();
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo cambiar la portada")),
  });

  const remove = useMutation({
    mutationFn: async (imageId: string) => {
      await api.delete(`/catalog/images/${imageId}`);
    },
    onSuccess: async () => {
      toast.success("Foto eliminada");
      setDeleteTarget(null);
      await onChanged();
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo eliminar la foto")),
  });

  const saveAlt = useMutation({
    mutationFn: async (input: { imageId: string; altText: string }) => {
      const res = await api.patch(`/catalog/images/${input.imageId}`, {
        altText: input.altText.trim() || null,
      });
      return res.data.data as ProductImage;
    },
    onSuccess: async () => {
      toast.success("Texto alternativo guardado");
      setAltTarget(null);
      await onChanged();
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo guardar el texto")),
  });

  const busy = reorder.isPending || setPrimary.isPending || remove.isPending;

  const move = (from: number, to: number) => {
    const next = moveItem(order, from, to);
    if (next.every((img, i) => img.id === order[i]?.id)) return;
    setOrder(next);
    reorder.mutate(next.map((img) => img.id));
  };

  const onFiles = (files: File[]) => {
    queue.addFiles(files);
    void queue.uploadAll(uploadUrl).then(({ done, failed }) => {
      if (done > 0 && failed === 0) {
        toast.success(done === 1 ? "Foto agregada" : `${done} fotos agregadas`);
      } else if (done > 0) {
        toast.warning(`${done} ${done === 1 ? "foto subida" : "fotos subidas"}; ${failed} con error.`);
      }
      if (done > 0) queue.clearFinished();
    });
  };

  const tile = compact ? "text-[10px]" : "text-xs";

  return (
    <div className="space-y-3">
      {order.length === 0 ? (
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg border bg-muted px-3 py-2 text-muted-foreground",
            compact ? "text-xs" : "text-sm",
          )}
        >
          <ImageIcon aria-hidden className="h-4 w-4 shrink-0" />
          Sin fotos todavía. La primera que subas será la portada.
        </div>
      ) : (
        <ul
          className={cn("grid gap-2", compact ? "grid-cols-4 sm:grid-cols-5" : "grid-cols-3 sm:grid-cols-4")}
          aria-label="Fotos"
        >
          {order.map((image, index) => {
            const isPrimary = index === 0;
            const alt = imageAlt(image, altFallback);
            return (
              <li
                key={image.id}
                draggable={!busy}
                onDragStart={(e) => {
                  e.dataTransfer.setData(DND_MIME, image.id);
                  e.dataTransfer.effectAllowed = "move";
                  setDragId(image.id);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setOverId(null);
                }}
                onDragOver={(e) => {
                  if (!Array.from(e.dataTransfer.types).includes(DND_MIME)) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (overId !== image.id) setOverId(image.id);
                }}
                onDrop={(e) => {
                  const fromId = e.dataTransfer.getData(DND_MIME);
                  if (!fromId) return;
                  e.preventDefault();
                  setDragId(null);
                  setOverId(null);
                  const from = order.findIndex((img) => img.id === fromId);
                  if (from >= 0) move(from, index);
                }}
                className={cn(
                  "group relative flex flex-col gap-1 rounded-lg",
                  dragId === image.id && "opacity-50",
                  overId === image.id && dragId !== image.id && "ring-2 ring-ring ring-offset-2 ring-offset-background",
                )}
              >
                <div
                  className={cn(
                    "relative aspect-square w-full overflow-hidden rounded-md border bg-muted",
                    isPrimary && "border-foreground",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- fotos de catálogo servidas por el API */}
                  <img src={image.url} alt={alt} title={alt} className="h-full w-full object-cover" />
                  {isPrimary ? (
                    <Badge size="sm" className="absolute left-1 top-1 gap-1 shadow-sm">
                      <Star aria-hidden className="h-2.5 w-2.5 fill-current" />
                      Portada
                    </Badge>
                  ) : null}
                  {!busy ? (
                    <span
                      aria-hidden
                      className="absolute right-1 top-1 rounded bg-background/80 p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <GripVertical className="h-3.5 w-3.5" />
                    </span>
                  ) : null}
                </div>
                <div className={cn("flex items-center justify-between gap-0.5", tile)}>
                  <Tip label="Mover antes">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 sm:h-7 sm:w-7"
                      aria-label={`Mover antes: foto ${index + 1}`}
                      disabled={busy || index === 0}
                      onClick={() => move(index, index - 1)}
                    >
                      <ChevronLeft aria-hidden className="h-3.5 w-3.5" />
                    </Button>
                  </Tip>
                  <DropdownMenu>
                    <Tip label="Más acciones">
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 sm:h-7 sm:w-7"
                          aria-label={`Acciones de la foto ${index + 1}`}
                          disabled={busy}
                        >
                          <MoreHorizontal aria-hidden className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                    </Tip>
                    <DropdownMenuContent align="center">
                      {!isPrimary ? (
                        <DropdownMenuItem onSelect={() => setPrimary.mutate(image.id)}>
                          <Star aria-hidden className="h-4 w-4" />
                          Hacer portada
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem onSelect={() => setAltTarget(image)}>
                        <TextCursorInput aria-hidden className="h-4 w-4" />
                        Texto alternativo
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => setDeleteTarget(image)}
                      >
                        <Trash2 aria-hidden className="h-4 w-4" />
                        Eliminar
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Tip label="Mover después">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 sm:h-7 sm:w-7"
                      aria-label={`Mover después: foto ${index + 1}`}
                      disabled={busy || index === order.length - 1}
                      onClick={() => move(index, index + 1)}
                    >
                      <ChevronRight aria-hidden className="h-3.5 w-3.5" />
                    </Button>
                  </Tip>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {altTarget ? (
        <AltTextEditor
          key={altTarget.id}
          image={altTarget}
          index={order.findIndex((img) => img.id === altTarget.id) + 1}
          saving={saveAlt.isPending}
          onCancel={() => setAltTarget(null)}
          onSave={(altText) => saveAlt.mutate({ imageId: altTarget.id, altText })}
        />
      ) : null}

      <ImageDropzone
        compact={compact}
        disabled={queue.uploading}
        onFiles={onFiles}
        label={order.length === 0 ? "Arrastra fotos aquí o haz clic para elegir" : "Agregar más fotos"}
      />
      <UploadQueueList queue={queue} />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="¿Eliminar esta foto?"
        description={
          deleteTarget && order[0]?.id === deleteTarget.id && order.length > 1
            ? "Es la portada: la siguiente foto pasará a ser la portada. Esta acción no se puede deshacer."
            : "Se borra del catálogo y del almacenamiento. Esta acción no se puede deshacer."
        }
        confirmLabel="Eliminar"
        pending={remove.isPending}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget.id);
        }}
      />
    </div>
  );
}

function AltTextEditor({
  image,
  index,
  saving,
  onCancel,
  onSave,
}: {
  image: ProductImage;
  index: number;
  saving: boolean;
  onCancel: () => void;
  onSave: (altText: string) => void;
}) {
  const id = React.useId();
  const [value, setValue] = React.useState(image.altText ?? "");
  return (
    <form
      className="space-y-2 rounded-lg border bg-muted p-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSave(value);
      }}
    >
      <Label htmlFor={id}>Texto alternativo · foto {index}</Label>
      <Input
        id={id}
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="ej. Frente del envase con etiqueta"
        aria-describedby={`${id}-hint`}
        maxLength={MAX_ALT_TEXT_LENGTH}
      />
      <p id={`${id}-hint`} className="flex justify-between gap-2 text-xs text-muted-foreground">
        <span>Describe la foto para lectores de pantalla y para el agente. Vacío = usar el título.</span>
        <span className="shrink-0 tabular-nums">
          {value.length}/{MAX_ALT_TEXT_LENGTH}
        </span>
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" loading={saving}>
          Guardar texto
        </Button>
      </div>
    </form>
  );
}
