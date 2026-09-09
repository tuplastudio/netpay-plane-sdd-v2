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
      toast.error("Link inválido.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/auth/accept-invite", { token, password: values.password });
      toast.success("Cuenta activada");
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
          <h1 className="text-xl font-semibold">Activar cuenta</h1>
          <p className="text-sm text-muted-foreground">Elige una contraseña para completar tu invitación.</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Contraseña</Label>
          <Input id="password" type="password" autoComplete="new-password" {...register("password")} />
          {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
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
          {submitting ? "Activando…" : "Activar cuenta"}
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
