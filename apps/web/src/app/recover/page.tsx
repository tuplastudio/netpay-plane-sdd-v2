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

const schema = z.object({ email: z.string().email() });
type FormValues = z.infer<typeof schema>;

export default function RecoverPage() {
  const [submitting, setSubmitting] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: "" } });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      const res = await api.post<{ data: { ok: boolean; token?: string } }>(
        "/auth/forgot-password",
        values,
      );
      toast.success("Si el correo existe, enviamos instrucciones para recuperar tu cuenta.");
      if (res.data.data.token) {
        setDevLink(`/reset?token=${encodeURIComponent(res.data.data.token)}`);
      }
    } catch {
      toast.error("No se pudo procesar la solicitud");
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
          <h1 className="text-xl font-semibold">Recuperar cuenta</h1>
          <p className="text-sm text-muted-foreground">
            Te enviamos un link para restablecer tu contraseña.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" {...register("email")} />
          {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
        </div>

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? "Enviando…" : "Enviar instrucciones"}
        </Button>

        {devLink && (
          <div className="rounded-lg border bg-muted p-3 text-xs">
            <p className="mb-1 font-medium">Modo desarrollo (sin envío real de correo):</p>
            <Link href={devLink} className="break-all text-primary underline">
              {devLink}
            </Link>
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground">
          <Link href="/login" className="underline">
            Volver a iniciar sesión
          </Link>
        </p>
      </form>
    </main>
  );
}
