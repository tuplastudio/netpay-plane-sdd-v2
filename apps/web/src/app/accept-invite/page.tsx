"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthSplitLayout } from "@/components/app/auth-split-layout";
import { AuthError, authErrorMessage } from "@/components/app/auth-card";

const schema = z
  .object({
    password: z.string().min(12, "Mínimo 12 caracteres"),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Las contraseñas no coinciden",
    path: ["confirmPassword"],
  });
type FormValues = z.infer<typeof schema>;

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInviteForm />
    </Suspense>
  );
}

function AcceptInviteForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(
    token ? null : "Link inválido. Pide una invitación nueva.",
  );

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    if (!token) {
      setFormError("Link inválido. Pide una invitación nueva.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await api.post("/auth/accept-invite", { token, password: values.password });
      toast.success("Cuenta activada");
      router.push("/login");
    } catch (err) {
      setFormError(authErrorMessage(err, "El link es inválido o ya expiró"));
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <AuthSplitLayout>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="font-display text-display-md">Activar cuenta</h1>
          <p className="text-balance text-sm text-muted-foreground">
            Elige una contraseña para completar tu invitación.
          </p>
        </div>
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
          <AuthError message={formError} title="No se pudo activar" />
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                autoFocus
                placeholder="Mínimo 12 caracteres"
                aria-invalid={!!errors.password}
                aria-describedby={errors.password ? "password-error" : undefined}
                {...register("password")}
              />
              {errors.password && (
                <p id="password-error" className="text-xs text-destructive">
                  {errors.password.message}
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="confirmPassword">Confirmar contraseña</Label>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                placeholder="Repite la contraseña"
                aria-invalid={!!errors.confirmPassword}
                aria-describedby={errors.confirmPassword ? "confirmPassword-error" : undefined}
                {...register("confirmPassword")}
              />
              {errors.confirmPassword && (
                <p id="confirmPassword-error" className="text-xs text-destructive">
                  {errors.confirmPassword.message}
                </p>
              )}
            </div>
            <Button type="submit" className="w-full" loading={submitting} disabled={!token}>
              Activar cuenta
            </Button>
          </div>
          <p className="text-center text-sm text-muted-foreground">
            ¿Ya activaste tu cuenta?{" "}
            <Link href="/login" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-foreground sm:min-h-0">
              Inicia sesión
            </Link>
          </p>
        </form>
      </div>
    </AuthSplitLayout>
  );
}
