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
import { Select } from "@/components/ui/select";
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
 * Códigos de país (lada internacional) más comunes en la región donde opera
 * el negocio (LatAm + España + EE.UU./Canadá), con México primero porque es
 * el mercado por defecto de la demo. La validación de longitud del número
 * nacional es deliberadamente laxa (7-12 dígitos): este campo es solo una
 * pista para el operador, el número real lo confirma el escaneo del QR.
 */
const COUNTRY_CODES = [
  { iso: "MX", dial: "52", name: "México" },
  { iso: "US", dial: "1", name: "Estados Unidos" },
  { iso: "CA", dial: "1", name: "Canadá" },
  { iso: "GT", dial: "502", name: "Guatemala" },
  { iso: "BZ", dial: "501", name: "Belice" },
  { iso: "SV", dial: "503", name: "El Salvador" },
  { iso: "HN", dial: "504", name: "Honduras" },
  { iso: "NI", dial: "505", name: "Nicaragua" },
  { iso: "CR", dial: "506", name: "Costa Rica" },
  { iso: "PA", dial: "507", name: "Panamá" },
  { iso: "CO", dial: "57", name: "Colombia" },
  { iso: "VE", dial: "58", name: "Venezuela" },
  { iso: "EC", dial: "593", name: "Ecuador" },
  { iso: "PE", dial: "51", name: "Perú" },
  { iso: "BO", dial: "591", name: "Bolivia" },
  { iso: "PY", dial: "595", name: "Paraguay" },
  { iso: "CL", dial: "56", name: "Chile" },
  { iso: "AR", dial: "54", name: "Argentina" },
  { iso: "UY", dial: "598", name: "Uruguay" },
  { iso: "BR", dial: "55", name: "Brasil" },
  { iso: "DO", dial: "1", name: "República Dominicana" },
  { iso: "PR", dial: "1", name: "Puerto Rico" },
  { iso: "ES", dial: "34", name: "España" },
] as const;

const DEFAULT_COUNTRY = "MX";
/** Rango laxo de dígitos nacionales: cubre desde números cortos centroamericanos
 * hasta los 10-11 dígitos típicos de México/Brasil. */
const MIN_NATIONAL_DIGITS = 7;
const MAX_NATIONAL_DIGITS = 12;

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
  // Selector por ISO, no por lada: EE.UU./Canadá y Rep. Dominicana/Puerto
  // Rico comparten lada +1, así que usar el dial como `value` del <select>
  // colisionaría (el navegador no puede distinguir opciones con el mismo
  // value y "saltaría" a la primera que coincida al re-renderizar).
  const [countryIso, setCountryIso] = useState<string>(DEFAULT_COUNTRY);
  const [nationalNumber, setNationalNumber] = useState("");
  const countryDial = COUNTRY_CODES.find((c) => c.iso === countryIso)!.dial;

  // Pista en E.164 (+52...) armada de lada + número nacional. Vacía si el
  // operador no escribió nada: el campo es opcional en todo el flujo.
  const phoneHint = nationalNumber ? `+${countryDial}${nationalNumber}` : "";
  const nationalDigitsValid =
    nationalNumber.length === 0 ||
    (nationalNumber.length >= MIN_NATIONAL_DIGITS && nationalNumber.length <= MAX_NATIONAL_DIGITS);

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
      setNationalNumber("");
    }
    onOpenChange(next);
  }

  function startProvision() {
    if (!nationalDigitsValid) return;
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
              <div className="flex gap-2">
                <Select
                  id="evo-country"
                  aria-label="Código de país"
                  className="w-[9.5rem] shrink-0"
                  value={countryIso}
                  onChange={(e) => setCountryIso(e.target.value)}
                >
                  {COUNTRY_CODES.map((c) => (
                    <option key={c.iso} value={c.iso}>
                      {c.iso} +{c.dial}
                    </option>
                  ))}
                </Select>
                <Input
                  id="evo-phone"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="55 0000 0000"
                  aria-invalid={!nationalDigitsValid}
                  aria-describedby="evo-phone-hint"
                  value={nationalNumber}
                  onChange={(e) => setNationalNumber(e.target.value.replace(/\D/g, "").slice(0, MAX_NATIONAL_DIGITS))}
                />
              </div>
              <p
                id="evo-phone-hint"
                className={nationalDigitsValid ? "text-xs text-muted-foreground" : "text-xs text-destructive"}
              >
                {nationalDigitsValid
                  ? "Opcional. Lo autocompletamos al escanear con el número real."
                  : `Escribe entre ${MIN_NATIONAL_DIGITS} y ${MAX_NATIONAL_DIGITS} dígitos, sin lada.`}
              </p>
            </div>

            <div className="mt-auto flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                onClick={startProvision}
                loading={provision.isPending}
                disabled={!nationalDigitsValid}
              >
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
