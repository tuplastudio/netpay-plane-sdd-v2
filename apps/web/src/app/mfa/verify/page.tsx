"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) {
      toast.error("Falta el token de verificación. Inicia sesión de nuevo.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/auth/mfa/verify", { challengeToken: token, code });
      toast.success("Verificado");
      router.push("/catalog");
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      toast.error(status === 401 ? "Código inválido o expirado" : "No se pudo verificar");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="container flex min-h-[calc(100vh-4rem)] items-center justify-center py-16">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-card border bg-card p-6 shadow-sm"
      >
        <div className="text-center">
          <ShieldCheck className="mx-auto mb-2 h-8 w-8 text-primary" />
          <h1 className="text-xl font-semibold">Verificación en dos pasos</h1>
          <p className="text-sm text-muted-foreground">
            Ingresa el código de tu app autenticadora o un código de recuperación.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="code">Código</Label>
          <Input
            id="code"
            inputMode="numeric"
            autoFocus
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={16}
          />
        </div>

        <Button type="submit" className="w-full" disabled={submitting || !code}>
          {submitting ? "Verificando…" : "Verificar"}
        </Button>
      </form>
    </main>
  );
}
