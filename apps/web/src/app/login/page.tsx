"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(12),
  tenantSlug: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

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
    try {
      const res = await api.post<{
        data: { mfaRequired: boolean; mfaChallengeToken?: string };
      }>("/auth/login", values);
      if (res.data.data.mfaRequired && res.data.data.mfaChallengeToken) {
        router.push(`/mfa/verify?token=${encodeURIComponent(res.data.data.mfaChallengeToken)}`);
        return;
      }
      toast.success("Sesión iniciada");
      router.push("/catalog");
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const message =
        status === 401
          ? "Credenciales inválidas"
          : status === 429
            ? "Demasiados intentos. Intenta en 15 minutos."
            : "No se pudo iniciar sesión";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <main className="container flex min-h-[calc(100vh-4rem)] items-center justify-center py-16">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-card border bg-card p-6 shadow-sm"
      >
        <div>
          <h1 className="text-xl font-semibold">Iniciar sesión</h1>
          <p className="text-sm text-muted-foreground">
            Ingresa con tu cuenta del portal.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" {...register("email")} />
          {errors.email && (
            <p className="text-xs text-destructive">{errors.email.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Contraseña</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            {...register("password")}
          />
          {errors.password && (
            <p className="text-xs text-destructive">{errors.password.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tenantSlug">Tenant (opcional)</Label>
          <Input
            id="tenantSlug"
            placeholder="demo"
            autoComplete="organization"
            {...register("tenantSlug")}
          />
        </div>

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? "Entrando..." : "Entrar"}
        </Button>

        <p className="text-center text-xs">
          <Link href="/recover" className="text-muted-foreground underline">
            ¿Olvidaste tu contraseña?
          </Link>
        </p>

        <p className="text-center text-xs text-muted-foreground">
          Demo: <code>owner@demo.local</code> / <code>Demo1234!Demo1234!</code>
        </p>
      </form>
    </main>
  );
}