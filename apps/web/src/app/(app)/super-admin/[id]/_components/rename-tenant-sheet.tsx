"use client";

import { useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SA_ROOT_KEY, apiErrorMessage } from "../../_shared";

const schema = z.object({
  name: z.string().trim().min(2, "Mínimo 2 caracteres").max(200, "Máximo 200 caracteres"),
});
type Values = z.infer<typeof schema>;

/** `PATCH /super-admin/tenants/:id { name }` en un panel lateral. */
export function RenameTenantSheet({
  tenantId,
  currentName,
  open,
  onOpenChange,
}: {
  tenantId: string;
  currentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: currentName },
  });

  // Al abrir, el campo arranca con el nombre vigente (no con el de la vez anterior).
  useEffect(() => {
    if (open) form.reset({ name: currentName });
  }, [open, currentName, form]);

  const rename = useMutation({
    mutationFn: async (v: Values) => {
      await api.patch(`/super-admin/tenants/${tenantId}`, { name: v.name });
    },
    onSuccess: async () => {
      toast.success("Empresa renombrada");
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: SA_ROOT_KEY });
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo renombrar la empresa")),
  });

  const errors = form.formState.errors;
  const onSubmit = form.handleSubmit((v) => rename.mutate(v));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Renombrar empresa</SheetTitle>
          <SheetDescription>
            Cambia el nombre visible. El slug no se modifica: lo usan el agente y las URLs
            públicas.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
          {rename.isError ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>No se pudo renombrar</AlertTitle>
              <AlertDescription>
                {apiErrorMessage(rename.error, "Inténtalo de nuevo.")}
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="rename-tenant-name">Nombre de la empresa</Label>
            <Input
              id="rename-tenant-name"
              autoComplete="organization"
              placeholder="Nombre de la empresa"
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? "rename-tenant-name-error" : undefined}
              {...form.register("name")}
            />
            {errors.name ? (
              <p id="rename-tenant-name-error" className="text-xs text-destructive">
                {errors.name.message}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={rename.isPending}>
              Guardar
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
