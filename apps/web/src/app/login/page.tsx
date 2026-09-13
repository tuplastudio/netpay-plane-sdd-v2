"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { api, syncSessionAfterAuth } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthSplitLayout } from "@/components/app/auth-split-layout";
import { AuthError, authErrorMessage } from "@/components/app/auth-card";

const schema = z.object({
  email: z.string().email("Escribe un correo válido"),
  password: z.string().min(12, "Mínimo 12 caracteres"),
});
type FormValues = z.infer<typeof schema>;

function readSafeNext(): string {
  if (typeof window === "undefined") return "/";
  const raw = new URLSearchParams(window.location.search).get("next");
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export default function LoginPage() {
  const router = useRouter();
  const [safeNext, setSafeNext] = useState("/");
  useEffect(() => {
    setSafeNext(readSafeNext());
  }, []);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await api.post<{
        data: {
          mfaRequired: boolean;
          mfaChallengeToken?: string;
          role?: string;
          isSuperAdmin?: boolean;
        };
      }>("/auth/login", values);
      const result = res.data.data;
      if (result.mfaRequired && result.mfaChallengeToken) {
        router.push(`/mfa/verify?token=${encodeURIComponent(result.mfaChallengeToken)}`);
        return;
      }
      await syncSessionAfterAuth({
        role: result.role,
        fallback: {
          email: values.email,
          ...(result.role ? { role: result.role } : {}),
        },
      });
      toast.success("Sesión iniciada");
      router.push(result.isSuperAdmin ? "/super-admin" : safeNext);
    } catch (err) {
      setFormError(
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
    <AuthSplitLayout>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-2xl font-bold tracking-tight">Iniciar sesión</h1>
          <p className="text-balance text-sm text-muted-foreground">
            Ingresa con tu correo del portal para abrir tu tienda.
          </p>
        </div>
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
          <AuthError message={formError} title="No se pudo iniciar sesión" />
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
            <div className="grid gap-2">
              <div className="flex items-center">
                <Label htmlFor="password">Contraseña</Label>
                <Link
                  href="/recover"
                  className="ml-auto text-sm underline-offset-4 hover:underline"
                >
                  ¿Olvidaste tu contraseña?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
                aria-invalid={errors.password ? true : undefined}
                {...register("password")}
              />
              {errors.password && (
                <p className="text-xs text-destructive">{errors.password.message}</p>
              )}
            </div>
            <Button type="submit" className="w-full" loading={submitting}>
              Entrar
            </Button>
          </div>
        </form>
      </div>
    </AuthSplitLayout>
  );
}
