"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Download,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import { api } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SkeletonText } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Section } from "@/components/app/section";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { apiErrorMessage } from "./api-error";

interface Me {
  id: string;
  email: string;
  fullName: string;
  totpEnabled: boolean;
}

interface MfaEnrollment {
  secretBase32: string;
  otpauthUrl: string;
  recoveryCodes: string[];
}

async function copyToClipboard(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copiado`);
  } catch {
    toast.message(label, { description: text });
  }
}

/** "ABCD EFGH IJKL…": la clave en grupos de 4 se transcribe a mano sin perder el lugar. */
function groupSecret(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

function downloadRecoveryCodes(codes: string[], email: string) {
  const body = [
    "Atiende ya — códigos de recuperación de verificación en dos pasos",
    `Cuenta: ${email}`,
    `Generados: ${new Date().toLocaleString("es-MX")}`,
    "",
    "Cada código sirve una sola vez. Guárdalos en un lugar seguro, no en este",
    "portal: si pierdes el acceso a tu app autenticadora, son la única forma",
    "de entrar sin ella.",
    "",
    ...codes,
    "",
  ].join("\n");
  const url = URL.createObjectURL(new Blob([body], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "easy-sell-codigos-recuperacion.txt";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Imagen del QR (data URL) a partir del `otpauthUrl` del enrolamiento. */
function useQrCode(otpauthUrl: string | undefined) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!otpauthUrl) {
      setDataUrl(null);
      return;
    }
    QRCode.toDataURL(otpauthUrl, { width: 220, margin: 1 })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [otpauthUrl]);
  return dataUrl;
}

/** Segundo factor TOTP de la cuenta propia (no del tenant). */
export function MfaSection() {
  const queryClient = useQueryClient();
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const [code, setCode] = useState("");
  const [manualEntry, setManualEntry] = useState(false);
  const [codesSaved, setCodesSaved] = useState(false);

  const [disableOpen, setDisableOpen] = useState(false);
  const [disableCode, setDisableCode] = useState("");
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenCode, setRegenCode] = useState("");
  const [freshCodes, setFreshCodes] = useState<string[] | null>(null);

  const me = useQuery({
    queryKey: ["auth-me"],
    queryFn: async () => {
      const res = await api.get<{ data: Me }>("/auth/me");
      return res.data.data;
    },
  });

  const qrDataUrl = useQrCode(enrollment?.otpauthUrl);

  function resetEnrollmentState() {
    setEnrollment(null);
    setCode("");
    setManualEntry(false);
    setCodesSaved(false);
  }

  const enroll = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ data: MfaEnrollment }>("/auth/mfa/enroll");
      return res.data.data;
    },
    onSuccess: (data) => setEnrollment(data),
    onError: (error) =>
      toast.error(apiErrorMessage(error, "No se pudo iniciar el enrolamiento")),
  });

  const confirm = useMutation({
    mutationFn: async () => {
      await api.post("/auth/mfa/enroll/confirm", { code });
    },
    onSuccess: async () => {
      toast.success("MFA activado");
      resetEnrollmentState();
      await queryClient.invalidateQueries({ queryKey: ["auth-me"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Código inválido")),
  });

  const disable = useMutation({
    mutationFn: async () => {
      await api.post("/auth/mfa/disable", { code: disableCode });
    },
    onSuccess: async () => {
      toast.success("MFA desactivado");
      setDisableOpen(false);
      setDisableCode("");
      await queryClient.invalidateQueries({ queryKey: ["auth-me"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Código inválido")),
  });

  const regenerate = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ data: { recoveryCodes: string[] } }>(
        "/auth/mfa/recovery-codes/regenerate",
        { code: regenCode },
      );
      return res.data.data.recoveryCodes;
    },
    onSuccess: (codes) => {
      setFreshCodes(codes);
      setRegenCode("");
      toast.success("Códigos de recuperación regenerados");
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Código inválido")),
  });

  return (
    <Section
      title="Verificación en dos pasos"
      headerIcon={<ShieldCheck className="h-4 w-4" />}
      description="Segundo factor TOTP para tu propia cuenta."
      actions={
        me.data ? (
          <StatusBadge
            status={me.data.totpEnabled ? "ACTIVE" : "PENDING"}
            label={me.data.totpEnabled ? "Activado" : "Sin activar"}
            withDot
          />
        ) : undefined
      }
    >
      {me.isError ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>No se pudo cargar tu cuenta</AlertTitle>
          <AlertDescription>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void me.refetch()}
            >
              Reintentar
            </Button>
          </AlertDescription>
        </Alert>
      ) : me.isLoading ? (
        <SkeletonText lines={2} />
      ) : me.data?.totpEnabled && !enrollment ? (
        <div className="space-y-4">
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <CheckCircle2 aria-hidden className="h-4 w-4 shrink-0 text-success" />
            MFA activado para <span className="font-mono">{me.data.email}</span>.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setRegenOpen(true)}>
              <RefreshCw className="h-3.5 w-3.5" />
              Regenerar códigos de recuperación
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setDisableOpen(true)}
            >
              <ShieldOff className="h-3.5 w-3.5" />
              Desactivar MFA
            </Button>
          </div>
        </div>
      ) : !enrollment ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Protege tu cuenta con una app autenticadora (Google Authenticator, Authy, 1Password,
            etc.). Vas a necesitar tu teléfono a la mano.
          </p>
          <Button size="sm" loading={enroll.isPending} onClick={() => enroll.mutate()}>
            {enroll.isPending ? "Generando…" : "Activar MFA"}
          </Button>
        </div>
      ) : (
        <ol className="space-y-5">
          <li className="space-y-3">
            <p className="text-sm font-medium">1. Escanea este código con tu app autenticadora</p>
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <div className="flex h-[236px] w-[236px] shrink-0 items-center justify-center rounded-card border bg-white p-2">
                {qrDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- data URL local, no hay optimización que aplicar
                  <img
                    src={qrDataUrl}
                    alt="Código QR para vincular tu app autenticadora"
                    width={220}
                    height={220}
                  />
                ) : (
                  <SkeletonText lines={1} />
                )}
              </div>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Abre tu app, elige &quot;Agregar cuenta&quot; o el ícono de escanear y apunta al
                  código.
                </p>
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto px-0"
                  onClick={() => setManualEntry((v) => !v)}
                >
                  {manualEntry ? "Ocultar clave manual" : "¿No puedes escanear? Ingresa la clave a mano"}
                </Button>
                {manualEntry ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="break-all rounded-md bg-muted px-2 py-1 font-mono text-xs">
                      {groupSecret(enrollment.secretBase32)}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label="Copiar clave TOTP"
                      onClick={() => void copyToClipboard(enrollment.secretBase32, "Clave")}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          </li>

          <li className="space-y-2">
            <p className="text-sm font-medium">
              2. Guarda tus códigos de recuperación (se muestran una sola vez)
            </p>
            <p className="text-xs text-muted-foreground">
              Sirven para entrar si pierdes tu teléfono. Cada uno se usa una sola vez.
            </p>
            <ul className="grid grid-cols-2 gap-1 rounded-md bg-muted p-2 font-mono text-xs">
              {enrollment.recoveryCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void copyToClipboard(enrollment.recoveryCodes.join("\n"), "Códigos de recuperación")
                }
              >
                <Copy className="h-3.5 w-3.5" />
                Copiar todos
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadRecoveryCodes(enrollment.recoveryCodes, me.data?.email ?? "")}
              >
                <Download className="h-3.5 w-3.5" />
                Descargar .txt
              </Button>
            </div>
            <label className="flex items-start gap-2 pt-1 text-sm">
              <Checkbox
                checked={codesSaved}
                onChange={(e) => setCodesSaved(e.target.checked)}
                className="mt-0.5"
              />
              Ya guardé mis códigos de recuperación en un lugar seguro
            </label>
          </li>

          <li className="space-y-1.5">
            <Label htmlFor="mfa-code">3. Confirma con un código de 6 dígitos</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="mfa-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                className="max-w-[140px]"
                disabled={!codesSaved}
              />
              <Button
                size="sm"
                loading={confirm.isPending}
                disabled={!code || !codesSaved}
                onClick={() => confirm.mutate()}
              >
                {confirm.isPending ? "Confirmando…" : "Confirmar"}
              </Button>
              <Button variant="ghost" size="sm" onClick={resetEnrollmentState}>
                Cancelar
              </Button>
            </div>
            {!codesSaved ? (
              <p className="text-xs text-muted-foreground">
                Marca la casilla del paso 2 antes de confirmar.
              </p>
            ) : null}
          </li>
        </ol>
      )}

      <ConfirmDialog
        open={disableOpen}
        onOpenChange={(open) => {
          setDisableOpen(open);
          if (!open) setDisableCode("");
        }}
        title="¿Desactivar verificación en dos pasos?"
        description="Tu cuenta quedará protegida solo con tu contraseña. Confirma con un código de tu app o un código de recuperación."
        confirmLabel="Desactivar MFA"
        variant="destructive"
        pending={disable.isPending}
        confirmDisabled={disableCode.trim() === ""}
        onConfirm={() => disable.mutate()}
      >
        <div className="space-y-1.5 pt-2">
          <Label htmlFor="mfa-disable-code">Código de verificación</Label>
          <Input
            id="mfa-disable-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={disableCode}
            onChange={(e) => setDisableCode(e.target.value)}
            placeholder="123456 o código de recuperación"
          />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={regenOpen}
        onOpenChange={(open) => {
          setRegenOpen(open);
          if (!open) {
            setRegenCode("");
            setFreshCodes(null);
          }
        }}
        title={freshCodes ? "Nuevos códigos de recuperación" : "¿Regenerar códigos de recuperación?"}
        description={
          freshCodes
            ? "Los códigos anteriores dejaron de funcionar. Guarda estos ahora: no se muestran de nuevo."
            : "Los códigos que tengas guardados dejarán de funcionar. Confirma con un código de tu app."
        }
        confirmLabel={freshCodes ? "Listo, ya los guardé" : "Regenerar"}
        pending={regenerate.isPending}
        confirmDisabled={!freshCodes && regenCode.trim() === ""}
        onConfirm={() => (freshCodes ? setRegenOpen(false) : regenerate.mutate())}
      >
        {freshCodes ? (
          <div className="space-y-2 pt-2">
            <ul className="grid grid-cols-2 gap-1 rounded-md bg-muted p-2 font-mono text-xs">
              {freshCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void copyToClipboard(freshCodes.join("\n"), "Códigos de recuperación")}
              >
                <Copy className="h-3.5 w-3.5" />
                Copiar todos
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadRecoveryCodes(freshCodes, me.data?.email ?? "")}
              >
                <Download className="h-3.5 w-3.5" />
                Descargar .txt
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5 pt-2">
            <Label htmlFor="mfa-regen-code">Código de verificación</Label>
            <Input
              id="mfa-regen-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={regenCode}
              onChange={(e) => setRegenCode(e.target.value)}
              placeholder="123456"
            />
          </div>
        )}
      </ConfirmDialog>
    </Section>
  );
}
