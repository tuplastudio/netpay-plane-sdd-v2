"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { api, syncSessionAfterAuth } from "@/lib/api";
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

const schema = z.object({
  email: z.string().email("Escribe un correo válido"),
  password: z.string().min(12, "Mínimo 12 caracteres"),
  tenantSlug: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // El middleware mete `?next=<path>` cuando redirige aquí desde una ruta
  // protegida. Aceptamos solo paths internos (mismo origen) para no abrir
  // un open-redirect: cualquier URL externa se ignora y caemos a /catalog.
  const safeNext = (() => {
    const raw = searchParams.get("next");
    if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/catalog";
    return raw;
  })();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "", tenantSlug: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await api.post<{
        data: {
          mfaRequired: boolean;
          mfaChallengeToken?: string;
          /** Solo cuando la sesión quedó abierta (sin MFA pendiente). */
          role?: string;
        };
      }>("/auth/login", values);
      const result = res.data.data;
      if (result.mfaRequired && result.mfaChallengeToken) {
        // Con MFA pendiente la autenticación NO terminó: no hay cookie de
        // sesión todavía, así que tampoco se guarda identidad. La escribe
        // /mfa/verify cuando el segundo factor pasa.
        router.push(`/mfa/verify?token=${encodeURIComponent(result.mfaChallengeToken)}`);
        return;
      }
      // Sesión abierta: la cookie HttpOnly la puso el backend. Aquí solo se
      // cachea la identidad de pantalla; el token nunca toca el navegador.
      await syncSessionAfterAuth({
        role: result.role,
        fallback: {
          email: values.email,
          ...(result.role ? { role: result.role } : {}),
          ...(values.tenantSlug ? { tenantSlug: values.tenantSlug } : {}),
        },
      });
      toast.success("Sesión iniciada");
      router.push(safeNext);
    } catch (err) {
      setFormError(
        // El texto de respaldo no repite el título del Alert.
        authErrorMessage(err, "Inténtalo de nuevo en un momento.", {
          401: "Credenciales inválidas",
          429: "Demasiados intentos. Intenta en 15 minutos.",
        }),
      );
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <AuthCard
      title="Iniciar sesión"
      description="Ingresa con tu cuenta del portal."
      footer={
        <>
          <p>
            <AuthLink href="/recover">¿Olvidaste tu contraseña?</AuthLink>
          </p>
          <p>
            Demo: <code className="font-mono">owner@demo.local</code> /{" "}
            <code className="font-mono">Demo1234!Demo1234!</code>
          </p>
        </>
      }
    >
      <AuthForm onSubmit={onSubmit}>
        <AuthError message={formError} title="No se pudo iniciar sesión" />

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

        <AuthField id="password" label="Contraseña" error={errors.password?.message}>
          {(field) => (
            <Input
              {...field}
              type="password"
              autoComplete="current-password"
              {...register("password")}
            />
          )}
        </AuthField>

        <AuthField
          id="tenantSlug"
          label="Tenant (opcional)"
          hint="Solo si perteneces a más de un comercio."
          error={errors.tenantSlug?.message}
        >
          {(field) => (
            <Input
              {...field}
              type="text"
              placeholder="demo"
              autoComplete="organization"
              {...register("tenantSlug")}
            />
          )}
        </AuthField>

        <Button type="submit" className="w-full" loading={submitting}>
          Entrar
        </Button>
      </AuthForm>
    </AuthCard>
  );
}
