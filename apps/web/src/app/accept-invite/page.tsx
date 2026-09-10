"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/lib/api";
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

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
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
    <AuthCard
      title="Activar cuenta"
      description="Elige una contraseña para completar tu invitación."
      footer={
        <p>
          ¿Ya activaste tu cuenta? <AuthLink href="/login">Inicia sesión</AuthLink>
        </p>
      }
    >
      <AuthForm onSubmit={onSubmit}>
        <AuthError message={formError} title="No se pudo activar" />

        <AuthField
          id="password"
          label="Contraseña"
          hint="Mínimo 12 caracteres."
          error={errors.password?.message}
        >
          {(field) => (
            <Input
              {...field}
              type="password"
              autoComplete="new-password"
              autoFocus
              {...register("password")}
            />
          )}
        </AuthField>

        <AuthField
          id="confirmPassword"
          label="Confirmar contraseña"
          error={errors.confirmPassword?.message}
        >
          {(field) => (
            <Input
              {...field}
              type="password"
              autoComplete="new-password"
              {...register("confirmPassword")}
            />
          )}
        </AuthField>

        <Button type="submit" className="w-full" loading={submitting} disabled={!token}>
          Activar cuenta
        </Button>
      </AuthForm>
    </AuthCard>
  );
}
