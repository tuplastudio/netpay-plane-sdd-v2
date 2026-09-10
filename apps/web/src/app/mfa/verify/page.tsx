"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
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

export default function MfaVerifyPage() {
  return (
    <Suspense fallback={null}>
      <MfaVerifyForm />
    </Suspense>
  );
}

function MfaVerifyForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(
    token ? null : "Falta el token de verificación. Inicia sesión de nuevo.",
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) {
      setFormError("Falta el token de verificación. Inicia sesión de nuevo.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await api.post<{ data: { role?: string } }>("/auth/mfa/verify", {
        challengeToken: token,
        code,
      });
      // Aquí sí terminó la autenticación: el backend abrió sesión y puso la
      // cookie HttpOnly. Recién ahora se cachea la identidad del menú; el
      // código TOTP y el de recuperación no se guardan en ningún lado.
      await syncSessionAfterAuth({ role: res.data.data?.role });
      toast.success("Verificado");
      router.push("/catalog");
    } catch (err) {
      setFormError(
        // El texto de respaldo no repite el título del Alert.
        authErrorMessage(err, "Inténtalo de nuevo en un momento.", {
          401: "Código inválido o expirado",
        }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      icon={<ShieldCheck className="h-8 w-8" aria-hidden />}
      title="Verificación en dos pasos"
      description="Ingresa el código de tu app autenticadora o un código de recuperación."
      footer={
        <p>
          <AuthLink href="/login">Volver a iniciar sesión</AuthLink>
        </p>
      }
    >
      <AuthForm onSubmit={onSubmit}>
        <AuthError message={formError} title="No se pudo verificar" />

        <AuthField
          id="code"
          label="Código de verificación"
          hint="6 dígitos de tu app autenticadora. También aceptamos un código de recuperación."
        >
          {(field) => (
            <Input
              {...field}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={16}
              className="text-center font-mono text-lg tracking-widest"
            />
          )}
        </AuthField>

        <Button type="submit" className="w-full" loading={submitting} disabled={!code}>
          Verificar
        </Button>
      </AuthForm>
    </AuthCard>
  );
}
