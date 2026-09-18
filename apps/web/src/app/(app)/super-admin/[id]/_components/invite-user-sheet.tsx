"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { AlertCircle, Check, Copy, UserPlus } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ROLE_LABELS } from "@/components/ui/status-badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ALL_ROLES, type InvitationCreated, SA_ROOT_KEY, apiErrorMessage } from "../../_shared";

const schema = z.object({
  fullName: z.string().trim().min(2, "Mínimo 2 caracteres").max(200, "Máximo 200 caracteres"),
  email: z.string().trim().email("Correo inválido"),
  role: z.enum(ALL_ROLES),
});
type Values = z.infer<typeof schema>;

/**
 * `POST /super-admin/tenants/:id/invitations`. Si el backend devuelve el token
 * (modo desarrollo, sin envío de correo) se muestra el enlace de aceptación
 * para copiarlo, igual que en la alta de empresa.
 */
export function InviteUserSheet({
  tenantId,
  tenantName,
  open,
  onOpenChange,
}: {
  tenantId: string;
  tenantName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<InvitationCreated | null>(null);
  const [copied, setCopied] = useState(false);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: "", email: "", role: "VENDOR" },
  });

  const invite = useMutation({
    mutationFn: async (v: Values) => {
      const res = await api.post<{ data: InvitationCreated }>(
        `/super-admin/tenants/${tenantId}/invitations`,
        v,
      );
      return res.data.data;
    },
    onSuccess: async (data) => {
      toast.success("Invitación creada");
      form.reset();
      setResult(data ?? {});
      await queryClient.invalidateQueries({ queryKey: SA_ROOT_KEY });
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo crear la invitación")),
  });

  const errors = form.formState.errors;
  const onSubmit = form.handleSubmit((v) => invite.mutate(v));

  const close = (nextOpen: boolean) => {
    if (!nextOpen) {
      setResult(null);
      setCopied(false);
    }
    onOpenChange(nextOpen);
  };

  const acceptUrl = result?.token
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/accept-invite?token=${encodeURIComponent(result.token)}`
    : null;

  async function copyLink() {
    if (!acceptUrl) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(acceptUrl);
        toast.success("Enlace copiado");
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
        return;
      }
    } catch {
      // permiso denegado o documento sin foco: se cae al toast con el valor
    }
    toast.message("Enlace de aceptación", { description: acceptUrl });
  }

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Invitar usuario</SheetTitle>
          <SheetDescription>
            La persona recibe acceso a <strong>{tenantName}</strong> con el rol elegido cuando
            acepte la invitación.
          </SheetDescription>
        </SheetHeader>

        {result ? (
          <div className="mt-6 space-y-4">
            <Alert variant="info">
              <UserPlus />
              <AlertTitle>Invitación creada</AlertTitle>
              <AlertDescription>
                {acceptUrl ? (
                  <>
                    <p className="mb-2">
                      Modo desarrollo (sin envío de correo): comparte este enlace para que active
                      su cuenta.
                    </p>
                    <code className="block break-all rounded-md bg-muted p-2 font-mono text-xs text-foreground">
                      {acceptUrl}
                    </code>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={() => void copyLink()}
                    >
                      {copied ? (
                        <Check aria-hidden className="h-3.5 w-3.5 text-success" />
                      ) : (
                        <Copy aria-hidden className="h-3.5 w-3.5" />
                      )}
                      Copiar enlace
                    </Button>
                  </>
                ) : (
                  <p>La invitación quedó registrada y aparece en la lista de pendientes.</p>
                )}
              </AlertDescription>
            </Alert>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => close(false)}>
                Cerrar
              </Button>
              <Button onClick={() => setResult(null)}>Invitar a otra persona</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
            {invite.isError ? (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>No se pudo invitar</AlertTitle>
                <AlertDescription>
                  {apiErrorMessage(invite.error, "Revisa los campos marcados.")}
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="sa-invite-name">Nombre</Label>
              <Input
                id="sa-invite-name"
                autoComplete="name"
                placeholder="Nombre y apellidos"
                aria-invalid={errors.fullName ? true : undefined}
                aria-describedby={errors.fullName ? "sa-invite-name-error" : undefined}
                {...form.register("fullName")}
              />
              {errors.fullName ? (
                <p id="sa-invite-name-error" className="text-xs text-destructive">
                  {errors.fullName.message}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sa-invite-email">Correo</Label>
              <Input
                id="sa-invite-email"
                type="email"
                autoComplete="email"
                placeholder="persona@ejemplo.com"
                aria-invalid={errors.email ? true : undefined}
                aria-describedby={errors.email ? "sa-invite-email-error" : undefined}
                {...form.register("email")}
              />
              {errors.email ? (
                <p id="sa-invite-email-error" className="text-xs text-destructive">
                  {errors.email.message}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sa-invite-role">Rol</Label>
              <Select
                id="sa-invite-role"
                aria-invalid={errors.role ? true : undefined}
                {...form.register("role")}
              >
                {ALL_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r] ?? r}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                Como super-admin puedes otorgar cualquier rol, propietario incluido.
              </p>
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => close(false)}>
                Cancelar
              </Button>
              <Button type="submit" loading={invite.isPending}>
                {invite.isPending ? "Invitando…" : "Enviar invitación"}
              </Button>
            </div>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
