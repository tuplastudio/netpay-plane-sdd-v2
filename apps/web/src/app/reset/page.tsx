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
    newPassword: z.string().min(12, "Mínimo 12 caracteres"),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "Las contraseñas no coinciden",
    path: ["confirmPassword"],
  });
type FormValues = z.infer<typeof schema>;

export default function ResetPage() {
  return (
    <Suspense fallback={null}>
      <ResetForm />
    </Suspense>
  );
}

function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(
    token ? null : "Link inválido. Solicita uno nuevo.",
  );

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { newPassword: "", confirmPassword: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    if (!token) {
      setFormError("Link inválido. Solicita uno nuevo.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await api.post("/auth/reset-password", { token, newPassword: values.newPassword });
      toast.success("Contraseña actualizada");
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
          <h1 className="font-display text-display-md">Nueva contraseña</h1>
          <p className="text-balance text-sm text-muted-foreground">
            Elige una contraseña de al menos 12 caracteres.
          </p>
        </div>
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
          <AuthError message={formError} title="No se pudo actualizar" />
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="newPassword">Nueva contraseña</Label>
              <Input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                autoFocus
                placeholder="Mínimo 12 caracteres"
                aria-invalid={!!errors.newPassword}
                aria-describedby={errors.newPassword ? "newPassword-error" : undefined}
                {...register("newPassword")}
              />
              {errors.newPassword && (
                <p id="newPassword-error" className="text-xs text-destructive">
                  {errors.newPassword.message}
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
              Actualizar contraseña
            </Button>
          </div>
          <div className="space-y-1 text-center text-sm text-muted-foreground">
            <p>
              ¿Ya tienes cuenta?{" "}
              <Link href="/login" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-foreground sm:min-h-0">
                Inicia sesión
              </Link>
            </p>
            <p>
              ¿Tu link expiró?{" "}
              <Link href="/recover" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-foreground sm:min-h-0">
                Solicita uno nuevo
              </Link>
            </p>
          </div>
        </form>
      </div>
    </AuthSplitLayout>
  );
}
