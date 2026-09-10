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

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
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
    <AuthCard
      title="Nueva contraseña"
      description="Elige una contraseña de al menos 12 caracteres."
      footer={
        <>
          <p>
            <AuthLink href="/login">Volver a iniciar sesión</AuthLink>
          </p>
          <p>
            ¿Tu link expiró? <AuthLink href="/recover">Solicita uno nuevo</AuthLink>
          </p>
        </>
      }
    >
      <AuthForm onSubmit={onSubmit}>
        <AuthError message={formError} title="No se pudo actualizar" />

        <AuthField
          id="newPassword"
          label="Nueva contraseña"
          hint="Mínimo 12 caracteres."
          error={errors.newPassword?.message}
        >
          {(field) => (
            <Input
              {...field}
              type="password"
              autoComplete="new-password"
              autoFocus
              {...register("newPassword")}
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
          Actualizar contraseña
        </Button>
      </AuthForm>
    </AuthCard>
  );
}
