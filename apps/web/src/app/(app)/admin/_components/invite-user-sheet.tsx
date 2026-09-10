"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { api } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ROLE_LABELS } from "@/components/ui/status-badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { apiErrorMessage } from "./api-error";
import { MEMBERS_QUERY_KEY } from "./members-section";

/**
 * Roles que se pueden otorgar al invitar. OWNER y ADMIN quedan fuera a
 * propósito: se asignan después, desde la tabla de miembros.
 */
const ROLE_OPTIONS = ["VENDOR", "FINANCE", "CATALOG", "SUPPORT", "VIEWER"] as const;

const schema = z.object({
  fullName: z.string().trim().min(2, "Escribe el nombre completo").max(200, "Máximo 200 caracteres"),
  email: z.string().trim().email("Correo no válido"),
  role: z.enum(ROLE_OPTIONS),
});

type FormValues = z.infer<typeof schema>;

/**
 * Sheet de invitación con su propio botón disparador. Pensado para
 * montarse en la cabecera de la tabla de miembros (`/admin?tab=usuarios`)
 * — antes vivía como una sección aparte que empujaba la tabla hacia abajo.
 */
export function InviteUserSheet({ trigger }: { trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger ?? <span className="hidden" />}</SheetTrigger>
      <SheetContent
        side="right"
        title="Invitar usuario"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <InviteForm onDone={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

/** Variante con botón propio: para usar fuera de otra sección (links, etc). */
export function InviteUserTrigger({ label = "Invitar usuario" }: { label?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm">
          <UserPlus aria-hidden className="h-3.5 w-3.5" />
          {label}
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        title="Invitar usuario"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <InviteForm onDone={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

function InviteForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [inviteToken, setInviteToken] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: "", email: "", role: "VENDOR" },
  });

  const invite = useMutation({
    mutationFn: async (values: FormValues) => {
      const res = await api.post<{ data: { token?: string } }>("/iam/invitations", {
        email: values.email,
        fullName: values.fullName,
        role: values.role,
      });
      return res.data.data;
    },
    onSuccess: async (data) => {
      toast.success("Invitación creada");
      reset();
      // En modo desarrollo sin envío real de correo el backend devuelve el
      // token para abrir el flujo de aceptación manualmente.
      setInviteToken(data.token ?? null);
      await queryClient.invalidateQueries({ queryKey: MEMBERS_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: ["audit"] });
    },
    onError: (error) => {
      toast.error(apiErrorMessage(error, "No se pudo invitar"));
    },
  });

  return (
    <>
      <SheetHeader className="border-b px-6 py-4">
        <SheetTitle>Invitar usuario</SheetTitle>
        <SheetDescription>
          La invitación da acceso al tenant con el rol elegido.
        </SheetDescription>
      </SheetHeader>

      <form
        noValidate
        onSubmit={handleSubmit((values) => invite.mutate(values))}
        className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-4"
      >
        <div className="space-y-1.5">
          <Label htmlFor="invite-name">Nombre</Label>
          <Input
            id="invite-name"
            placeholder="Nombre completo"
            autoComplete="off"
            aria-invalid={!!errors.fullName}
            aria-describedby={errors.fullName ? "invite-name-error" : undefined}
            {...register("fullName")}
          />
          {errors.fullName && (
            <p id="invite-name-error" className="text-xs text-destructive">
              {errors.fullName.message}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="invite-email">Correo</Label>
          <Input
            id="invite-email"
            type="email"
            inputMode="email"
            placeholder="[email protected]"
            autoComplete="off"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "invite-email-error" : undefined}
            {...register("email")}
          />
          {errors.email && (
            <p id="invite-email-error" className="text-xs text-destructive">
              {errors.email.message}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="invite-role">Rol</Label>
          <Select id="invite-role" aria-invalid={!!errors.role} {...register("role")}>
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r] ?? r}
              </option>
            ))}
          </Select>
          {errors.role && (
            <p id="invite-role-error" className="text-xs text-destructive">
              {errors.role.message}
            </p>
          )}
        </div>

        {inviteToken ? (
          <Alert variant="info">
            <UserPlus />
            <AlertTitle>Modo desarrollo (sin envío real de correo)</AlertTitle>
            <AlertDescription>
              <Button variant="link" size="sm" className="h-auto px-0" asChild>
                <Link href={`/accept-invite?token=${encodeURIComponent(inviteToken)}`}>
                  Abrir el enlace de aceptación
                </Link>
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
      </form>

      <div className="flex items-center justify-end gap-2 border-t bg-background px-6 py-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDone}
          disabled={invite.isPending}
        >
          {inviteToken ? "Cerrar" : "Cancelar"}
        </Button>
        <Button
          type="submit"
          size="sm"
          loading={invite.isPending}
          onClick={handleSubmit((values) => invite.mutate(values))}
        >
          {invite.isPending ? "Invitando…" : inviteToken ? "Invitar otro" : "Enviar invitación"}
        </Button>
      </div>
    </>
  );
}
