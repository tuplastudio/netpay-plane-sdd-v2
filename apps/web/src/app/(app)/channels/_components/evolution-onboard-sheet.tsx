"use client";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Loader2,
  Plug,
  QrCode,
  RefreshCw,
  Smartphone,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  useEvolutionCleanup,
  useEvolutionQr,
  useEvolutionState,
  useFinalizeEvolution,
  useProvisionEvolution,
} from "./use-channels";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step =
  | { kind: "form" }
  | { kind: "qr"; instanceName: string; qrBase64: string | null }
  | { kind: "connected"; instanceName: string };

/**
 * Alta de número de WhatsApp con Evolution API desde el portal.
 *
 * El flujo evita entrar al panel de Evolution: el operador escribe solo el
 * número que va a usar el cliente (opcional), el backend crea la instancia en
 * Evolution, registra el webhook y devuelve un QR. Mientras la instancia está
 * `connecting` se le muestra el QR y se va refrescando; cuando el cliente lo
 * escanea y el estado pasa a `open`, el portal "finaliza" el alta y la fila
 * de `WhatsAppConnection` queda `ACTIVE`.
 *
 * Es la contraparte visual de `EvolutionOnboardingService` en el API.
 */
export function EvolutionOnboardSheet({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>({ kind: "form" });
  const [phoneHint, setPhoneHint] = useState("");

  const provision = useProvisionEvolution((data) => {
    setStep({ kind: "qr", instanceName: data.instanceName, qrBase64: data.qrCodeBase64 });
  });
  const refreshQr = useEvolutionQr();
  const stateQuery = useEvolutionState();
  const finalize = useFinalizeEvolution(() => {
    void queryClient.invalidateQueries({ queryKey: ["whatsapp-connections"] });
  });
  const cleanup = useEvolutionCleanup();

  // Polling: cada 5s pedimos el QR fresco y el estado a Evolution. Cuando el
  // estado pasa a `open` dejamos de pedir el QR y disparamos `finalize` una
  // sola vez.
  useEffect(() => {
    if (step.kind !== "qr") return;
    let cancelled = false;
    const tick = async () => {
      const state = await stateQuery.mutateAsync(step.instanceName).catch(() => null);
      if (cancelled || !state) return;
      if (state.state === "open") {
        finalize.mutate({ instanceName: step.instanceName, phoneNumber: phoneHint || undefined });
        setStep({ kind: "connected", instanceName: step.instanceName });
        return;
      }
      if (state.state === "close" || state.state === "refused") {
        // El cliente cerró o rechazó el QR: avisamos y dejamos el panel como
        // caída (no cerramos para que el operador pueda reintentar).
        return;
      }
      // Sigue `connecting` -> pedimos QR fresco (rota cada ~60s).
      if (stateQuery.variables !== step.instanceName) {
        const qr = await refreshQr.mutateAsync(step.instanceName).catch(() => null);
        if (!cancelled && qr) {
          setStep((prev) =>
            prev.kind === "qr" && prev.instanceName === step.instanceName
              ? { ...prev, qrBase64: qr }
              : prev,
          );
        }
      }
    };
    const interval = window.setInterval(tick, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.kind === "qr" ? step.instanceName : null]);

  function handleOpenChange(next: boolean) {
    if (!next && step.kind !== "form" && step.kind !== "connected") {
      // Cierre con QR a medio mostrar: limpiamos la instancia.
      cleanup.mutate(step.instanceName);
    }
    if (!next) {
      setStep({ kind: "form" });
      setPhoneHint("");
    }
    onOpenChange(next);
  }

  function startProvision() {
    provision.mutate({ phoneNumber: phoneHint || undefined });
  }

  const qrSrc = useMemo(() => {
    if (step.kind !== "qr" || !step.qrBase64) return null;
    return step.qrBase64.startsWith("data:")
      ? step.qrBase64
      : `data:image/png;base64,${step.qrBase64}`;
  }, [step]);

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>
            {step.kind === "connected" ? "Canal conectado" : "Alta de WhatsApp con Evolution"}
          </SheetTitle>
          <SheetDescription>
            {step.kind === "form"
              ? "Crea una instancia nueva en Evolution desde el portal. Solo necesitas escanear el QR."
              : step.kind === "connected"
                ? "La instancia ya está abierta y recibiendo mensajes en este comercio."
                : "El cliente debe escanear el código desde su WhatsApp. La página se actualizará sola."}
          </SheetDescription>
        </SheetHeader>

        {step.kind === "form" ? (
          <div className="mt-6 flex flex-1 flex-col gap-4">
            <Alert variant="info">
              <Plug />
              <AlertTitle>¿Cómo funciona?</AlertTitle>
              <AlertDescription className="space-y-1 text-sm">
                <p>
                  Daremos de alta una instancia <code className="font-mono">WHATSAPP-BAILEYS</code>{" "}
                  en tu Evolution, configuraremos el webhook entrante y te mostraremos el QR listo
                  para escanear.
                </p>
                <p className="text-muted-foreground">
                  Sin tocar el panel de Evolution ni escribir credenciales a mano.
                </p>
              </AlertDescription>
            </Alert>

            <div className="space-y-1.5">
              <Label htmlFor="evo-phone">Número que va a usar el cliente</Label>
              <Input
                id="evo-phone"
                inputMode="tel"
                autoComplete="off"
                placeholder="+52 1 55 0000 0000"
                value={phoneHint}
                onChange={(e) => setPhoneHint(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Opcional. Lo autocompletamos al escanear con el número real.
              </p>
            </div>

            <div className="mt-auto flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
                Cancelar
              </Button>
              <Button onClick={startProvision} loading={provision.isPending}>
                <QrCode aria-hidden className="h-4 w-4" />
                Generar QR
              </Button>
            </div>
          </div>
        ) : step.kind === "connected" ? (
          <div className="mt-6 flex flex-1 flex-col gap-4">
            <Alert variant="success">
              <Check />
              <AlertTitle>Listo</AlertTitle>
              <AlertDescription>
                La instancia <code className="font-mono">{step.instanceName}</code> ya recibió
                mensajes. La fila aparece como <strong>Activa</strong> en la tabla de canales.
              </AlertDescription>
            </Alert>
            <div className="mt-auto flex justify-end">
              <Button onClick={() => handleOpenChange(false)}>Cerrar</Button>
            </div>
          </div>
        ) : (
          <div className="mt-6 flex flex-1 flex-col gap-4">
            <Alert>
              <Smartphone />
              <AlertTitle>Escanea este QR con el WhatsApp del cliente</AlertTitle>
              <AlertDescription className="space-y-1 text-sm">
                <p>
                  Desde el WhatsApp del número a vincular: <em>Dispositivos vinculados</em> →{" "}
                  <em>Vincular un dispositivo</em>.
                </p>
                <p className="text-muted-foreground">
                  El código rota. Esta página lo refresca sola mientras esté abierto.
                </p>
              </AlertDescription>
            </Alert>

            <div className="flex justify-center">
              {qrSrc ? (
                <img
                  src={qrSrc}
                  alt="QR de Evolution para escanear"
                  className="h-64 w-64 rounded-lg border bg-white p-2"
                />
              ) : (
                <div className="flex h-64 w-64 items-center justify-center rounded-lg border bg-muted">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>

            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <RefreshCw className={`h-3 w-3 ${refreshQr.isPending ? "animate-spin" : ""}`} />
              {stateQuery.isPending
                ? "Consultando estado…"
                : "Esperando escaneo del cliente…"}
            </div>

            <div className="mt-auto flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  cleanup.mutate(step.instanceName);
                  handleOpenChange(false);
                }}
              >
                <Trash2 aria-hidden className="h-4 w-4" />
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
