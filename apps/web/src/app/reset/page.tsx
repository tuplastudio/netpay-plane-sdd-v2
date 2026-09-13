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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AuthBrand, AuthError, authErrorMessage } from "@/components/app/auth-card";

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
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <AuthBrand className="justify-center mb-4" />
          <CardTitle className="text-2xl font-bold">Nueva contraseña</CardTitle>
          <CardDescription>Elige una contraseña de al menos 12 caracteres.</CardDescription>
        </CardHeader>
        <CardContent>
          <form noValidate onSubmit={onSubmit} className="grid gap-4">
            <AuthError message={formError} title="No se pudo actualizar" />
            <div className="grid gap-2">
              <label htmlFor="newPassword" className="text-sm font-medium">Nueva contraseña</label>
              <Input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                autoFocus
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
              <label htmlFor="confirmPassword" className="text-sm font-medium">Confirmar contraseña</label>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
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
            <p className="text-center text-sm text-muted-foreground">
              ¿Ya tienes cuenta?{" "}
              <Link href="/login" className="underline underline-offset-4 hover:text-foreground">
                Inicia sesión
              </Link>
            </p>
            <p className="text-center text-sm text-muted-foreground">
              ¿Tu link expiró?{" "}
              <Link href="/recover" className="underline underline-offset-4 hover:text-foreground">
                Solicita uno nuevo
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
