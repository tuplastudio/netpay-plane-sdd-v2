"use client";
import { useState } from "react";
import Link from "next/link";
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

const schema = z.object({ email: z.string().email("Escribe un correo válido") });
type FormValues = z.infer<typeof schema>;

export default function RecoverPage() {
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    setFormError(null);
    try {
      await api.post("/auth/forgot-password", values);
      toast.success("Si el correo existe, enviamos instrucciones para recuperar tu cuenta.");
    } catch (err) {
      setFormError(authErrorMessage(err, "No se pudo procesar la solicitud"));
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <AuthSplitLayout>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-2xl font-bold tracking-tight">Recuperar contraseña</h1>
          <p className="text-balance text-sm text-muted-foreground">
            Te enviamos un correo con un enlace para restablecer tu contraseña.
          </p>
        </div>
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
          <AuthError message={formError} title="No se pudo enviar" />
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="email">Correo electrónico</Label>
              <Input
                id="email"
                type="email"
                inputMode="email"
                placeholder="correo@ejemplo.com"
                autoComplete="email"
                autoFocus
                aria-invalid={errors.email ? true : undefined}
                {...register("email")}
              />
              {errors.email && (
                <p className="text-xs text-destructive">{errors.email.message}</p>
              )}
            </div>
            <Button type="submit" className="w-full" loading={submitting}>
              Enviar instrucciones
            </Button>
          </div>
          <div className="text-center text-sm">
            ¿Ya tienes cuenta?{" "}
            <Link href="/login" className="underline underline-offset-4">
              Inicia sesión
            </Link>
          </div>
        </form>
      </div>
    </AuthSplitLayout>
  );
}
