"use client";

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, Eye, EyeOff, KeyRound, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Section } from "@/components/app/section";
import { api } from "@/lib/api";
import { apiErrorMessage } from "./api-error";
import { cn } from "@/lib/utils";

/**
 * Reglas de complejidad del backend (`PasswordService.assertComplexity`):
 * mínimo 12 caracteres, al menos una mayúscula, una minúscula, un dígito y
 * un símbolo. Se reflejan en el cliente para dar feedback antes de mandar
 * la petición.
 */
interface Rule {
  label: string;
  ok: (pwd: string) => boolean;
}

const RULES: Rule[] = [
  { label: "Al menos 12 caracteres", ok: (p) => p.length >= 12 && p.length <= 256 },
  { label: "Una letra minúscula", ok: (p) => /[a-z]/.test(p) },
  { label: "Una letra mayúscula", ok: (p) => /[A-Z]/.test(p) },
  { label: "Un dígito", ok: (p) => /[0-9]/.test(p) },
  { label: "Un símbolo (no alfanumérico)", ok: (p) => /[^A-Za-z0-9]/.test(p) },
];

function checkRules(pwd: string) {
  return RULES.map((r) => ({ ...r, ok: r.ok(pwd) }));
}

function strength(pwd: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (!pwd) return { score: 0, label: "Vacía" };
  const rules = checkRules(pwd);
  const passed = rules.filter((r) => r.ok).length;
  if (passed <= 1) return { score: 1, label: "Muy débil" };
  if (passed === 2) return { score: 2, label: "Débil" };
  if (passed === 3) return { score: 3, label: "Aceptable" };
  if (passed === 4) return { score: 4, label: "Fuerte" };
  // passed === 5: criterios completos. La "fortaleza" final premia longitud > 16.
  return { score: 4, label: pwd.length >= 16 ? "Muy fuerte" : "Fuerte" };
}

/** Cambio de contraseña de la cuenta propia (no de los miembros del tenant). */
export function PasswordSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);

  const change = useMutation({
    mutationFn: async () => {
      await api.post("/auth/change-password", {
        currentPassword: current,
        newPassword: next,
      });
    },
    onSuccess: () => {
      toast.success("Contraseña actualizada. Vuelve a iniciar sesión en otros dispositivos.");
      setCurrent("");
      setNext("");
      setConfirm("");
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo cambiar la contraseña")),
  });

  const rules = useMemo(() => checkRules(next), [next]);
  const passed = rules.filter((r) => r.ok).length;
  const allOk = passed === RULES.length;
  const matches = next === confirm;
  const canSubmit =
    current.length > 0 && next.length > 0 && confirm.length > 0 && matches && allOk;
  const s = strength(next);
  const strengthTone = ["bg-muted", "bg-destructive", "bg-warning", "bg-info", "bg-success"][s.score]!;

  return (
    <Section
      title="Cambiar contraseña"
      headerIcon={<KeyRound className="h-4 w-4" />}
      description="Te pedirá la contraseña actual y revocará las demás sesiones abiertas en otros dispositivos."
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) change.mutate();
        }}
        noValidate
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pwd-current">Contraseña actual</Label>
            <div className="relative">
              <Input
                id="pwd-current"
                type={showCurrent ? "text" : "password"}
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                placeholder="Tu contraseña actual"
                autoComplete="current-password"
                className="pr-10"
                disabled={change.isPending}
                required
              />
              <button
                type="button"
                onClick={() => setShowCurrent((v) => !v)}
                aria-label={showCurrent ? "Ocultar contraseña actual" : "Mostrar contraseña actual"}
                className="absolute inset-y-0 right-2 my-auto h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
              >
                {showCurrent ? (
                  <EyeOff aria-hidden className="h-4 w-4" />
                ) : (
                  <Eye aria-hidden className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pwd-next">Nueva contraseña</Label>
            <div className="relative">
              <Input
                id="pwd-next"
                type={showNext ? "text" : "password"}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                placeholder="Mín. 12 caracteres, Aa1!"
                autoComplete="new-password"
                className="pr-10"
                disabled={change.isPending}
                required
                aria-describedby="pwd-next-hint"
              />
              <button
                type="button"
                onClick={() => setShowNext((v) => !v)}
                aria-label={showNext ? "Ocultar nueva contraseña" : "Mostrar nueva contraseña"}
                className="absolute inset-y-0 right-2 my-auto h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
              >
                {showNext ? (
                  <EyeOff aria-hidden className="h-4 w-4" />
                ) : (
                  <Eye aria-hidden className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pwd-confirm">Confirma la nueva contraseña</Label>
          <Input
            id="pwd-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repite la nueva contraseña"
            autoComplete="new-password"
            disabled={change.isPending}
            required
          />
        </div>

        {next.length > 0 ? (
          <div className="space-y-3 rounded-md border bg-card p-3" aria-live="polite">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Fortaleza</span>
                <span
                  className={cn(
                    "font-semibold",
                    s.score >= 4
                      ? "text-success-foreground"
                      : s.score === 3
                        ? "text-info-foreground"
                        : s.score === 2
                          ? "text-warning-foreground"
                          : "text-destructive-foreground",
                  )}
                >
                  {s.label}
                </span>
              </div>
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={4}
                aria-valuenow={s.score}
                aria-label="Fortaleza de la contraseña"
              >
                <div
                  className={cn("h-full transition-all", strengthTone)}
                  style={{ width: `${(s.score / 4) * 100}%` }}
                />
              </div>
            </div>

            <ul className="space-y-1 text-xs">
              {rules.map((r) => (
                <li key={r.label} className="flex items-center gap-2">
                  {r.ok ? (
                    <Check aria-hidden className="h-3.5 w-3.5 shrink-0 text-success" />
                  ) : (
                    <X aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span
                    className={cn(
                      "transition-colors",
                      r.ok ? "text-success-foreground" : "text-muted-foreground",
                    )}
                  >
                    {r.label}
                  </span>
                </li>
              ))}
              <li className="flex items-center gap-2">
                {confirm.length > 0 && matches ? (
                  <Check aria-hidden className="h-3.5 w-3.5 shrink-0 text-success" />
                ) : (
                  <X aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span
                  className={cn(
                    "transition-colors",
                    confirm.length > 0 && matches
                      ? "text-success-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  La confirmación coincide con la nueva contraseña.
                </span>
              </li>
            </ul>
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <Button
            type="submit"
            size="sm"
            loading={change.isPending}
            disabled={!canSubmit}
          >
            {change.isPending ? "Cambiando…" : "Cambiar contraseña"}
          </Button>
        </div>
      </form>
    </Section>
  );
}