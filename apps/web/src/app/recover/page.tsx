"use client";
import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AuthCard,
  AuthError,
  AuthField,
  AuthForm,
  AuthLink,
  authErrorMessage,
} from "@/components/app/auth-card";

const schema = z.object({ email: z.string().email("Escribe un correo válido") });
type FormValues = z.infer<typeof schema>;

export default function RecoverPage() {
  const [submitting, setSubmitting] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: "" } });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await api.post<{ data: { ok: boolean; token?: string } }>(
        "/auth/forgot-password",
        values,
      );
      toast.success("Si el correo existe, enviamos instrucciones para recuperar tu cuenta.");
      if (res.data.data.token) {
        setDevLink(`/reset?token=${encodeURIComponent(res.data.data.token)}`);
      }
    } catch (err) {
      setFormError(authErrorMessage(err, "No se pudo procesar la solicitud"));
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <AuthCard
      title="Recuperar cuenta"
      description="Te enviamos un link para restablecer tu contraseña."
      footer={
        <p>
          <AuthLink href="/login">Volver a iniciar sesión</AuthLink>
        </p>
      }
    >
      <AuthForm onSubmit={onSubmit}>
        <AuthError message={formError} title="No se pudo enviar" />

        <AuthField id="email" label="Correo electrónico" error={errors.email?.message}>
          {(field) => (
            <Input
              {...field}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoFocus
              {...register("email")}
            />
          )}
        </AuthField>

        <Button type="submit" className="w-full" loading={submitting}>
          Enviar instrucciones
        </Button>

        {devLink ? (
          <Alert variant="warning">
            <AlertTitle>Modo desarrollo</AlertTitle>
            <AlertDescription className="space-y-1">
              <p>No hay envío real de correo; usa este link:</p>
              <Link
                href={devLink}
                className="block break-all font-mono text-xs underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
              >
                {devLink}
              </Link>
            </AlertDescription>
          </Alert>
        ) : null}
      </AuthForm>
    </AuthCard>
  );
}
