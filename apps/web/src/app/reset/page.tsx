"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
      toast.error("Link inválido. Solicita uno nuevo.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/auth/reset-password", { token, newPassword: values.newPassword });
      toast.success("Contraseña actualizada");
      router.push("/login");
    } catch {
      toast.error("El link es inválido o ya expiró");
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
          <h1 className="text-xl font-semibold">Nueva contraseña</h1>
          <p className="text-sm text-muted-foreground">Elige una contraseña de al menos 12 caracteres.</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="newPassword">Nueva contraseña</Label>
          <Input id="newPassword" type="password" autoComplete="new-password" {...register("newPassword")} />
          {errors.newPassword && (
            <p className="text-xs text-destructive">{errors.newPassword.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirmPassword">Confirmar contraseña</Label>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            {...register("confirmPassword")}
          />
          {errors.confirmPassword && (
            <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>
          )}
        </div>

        <Button type="submit" className="w-full" disabled={submitting || !token}>
          {submitting ? "Guardando…" : "Actualizar contraseña"}
        </Button>

        <p className="text-center text-xs text-muted-foreground">
          <Link href="/login" className="underline">
            Volver a iniciar sesión
          </Link>
        </p>
      </form>
    </main>
  );
}
