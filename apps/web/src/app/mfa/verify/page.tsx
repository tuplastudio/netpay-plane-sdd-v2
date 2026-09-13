"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { api, syncSessionAfterAuth } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthError, authErrorMessage } from "@/components/app/auth-card";

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
      const res = await api.post<{ data: { role?: string; isSuperAdmin?: boolean } }>(
        "/auth/mfa/verify",
        { challengeToken: token, code },
      );
      await syncSessionAfterAuth({ role: res.data.data?.role });
      toast.success("Verificado");
      router.push(res.data.data?.isSuperAdmin ? "/super-admin" : "/catalog");
    } catch (err) {
      setFormError(
        authErrorMessage(err, "Inténtalo de nuevo en un momento.", {
          401: "Código inválido o expirado",
        }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-muted p-6 md:p-10">
      <Card className="mx-auto w-full max-w-sm">
        <CardHeader>
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <ShieldCheck className="h-5 w-5" aria-hidden />
          </div>
          <CardTitle className="text-2xl">Verificación en dos pasos</CardTitle>
          <CardDescription>
            Ingresa el código de tu app autenticadora o un código de recuperación.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form noValidate onSubmit={onSubmit}>
            <AuthError message={formError} title="No se pudo verificar" />
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="code">Código de verificación</Label>
                <Input
                  id="code"
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
                <p className="text-xs text-muted-foreground">
                  6 dígitos de tu app autenticadora. También aceptamos un código de recuperación.
                </p>
              </div>
              <Button type="submit" className="w-full" loading={submitting} disabled={!code}>
                Verificar
              </Button>
            </div>
            <div className="mt-4 text-center text-sm">
              ¿Problemas para verificar?{" "}
              <Link href="/login" className="underline underline-offset-4">
                Volver a iniciar sesión
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
