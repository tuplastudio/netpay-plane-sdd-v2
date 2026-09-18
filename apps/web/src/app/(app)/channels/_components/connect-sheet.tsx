"use client";
import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Plug, PlugZap } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CHANNEL_LABELS } from "@/components/ui/status-badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { Provider } from "./use-channels";

interface WebhookInfo {
  url: string;
  secret?: string;
}

const EMPTY_FORM = {
  provider: "META" as Provider,
  phoneNumber: "",
  token: "",
  phoneId: "",
  baseUrl: "",
  apiKey: "",
  instance: "",
};

type FormState = typeof EMPTY_FORM;

async function copyToClipboard(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copiada`);
  } catch {
    toast.message(label, { description: text });
  }
}

/**
 * Panel para vincular un número de WhatsApp. Dos pasos: el formulario de
 * credenciales y, solo para Evolution, la URL de webhook que hay que registrar
 * (incluye el secreto, que el API devuelve una única vez).
 */
export function ConnectSheet({
  open,
  onOpenChange,
  tenantSlug,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Slug del tenant, para armar la URL pública del webhook de Evolution. */
  tenantSlug: string | null | undefined;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [webhookInfo, setWebhookInfo] = useState<WebhookInfo | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const connect = useMutation({
    mutationFn: async () => {
      const credentials =
        form.provider === "META"
          ? { token: form.token, phoneId: form.phoneId }
          : { baseUrl: form.baseUrl, apiKey: form.apiKey, instance: form.instance };
      const res = await api.post<{ data: { webhookSecret?: string } }>("/whatsapp/connect", {
        provider: form.provider,
        phoneNumber: form.phoneNumber,
        credentials,
      });
      return res.data.data;
    },
    onSuccess: async (data) => {
      toast.success("Canal conectado");
      const isEvolution = form.provider === "EVOLUTION";
      if (isEvolution && tenantSlug) {
        const base = `${window.location.origin}/api/v1/whatsapp/webhook/inbound/${tenantSlug}`;
        setWebhookInfo({
          url: data.webhookSecret ? `${base}?secret=${data.webhookSecret}` : base,
          secret: data.webhookSecret,
        });
      }
      setForm(EMPTY_FORM);
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-connections"] });
      // Meta no necesita configuración adicional: cerramos. Evolution se queda
      // abierto mostrando la URL de webhook.
      if (!(isEvolution && tenantSlug)) onOpenChange(false);
    },
    onError: () => toast.error("No se pudo conectar el canal"),
  });

  const canConnect =
    form.phoneNumber.trim().length > 0 &&
    (form.provider === "META" ? form.token.trim().length > 0 : form.apiKey.trim().length > 0);

  function handleOpenChange(next: boolean) {
    if (!next) {
      // Al cerrar se descarta el borrador y la URL de webhook: el secreto no se
      // vuelve a mostrar, y así lo advierte el aviso.
      setForm(EMPTY_FORM);
      setWebhookInfo(null);
    }
    onOpenChange(next);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canConnect && !connect.isPending) connect.mutate();
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{webhookInfo ? "Configura el webhook" : "Conectar canal"}</SheetTitle>
          <SheetDescription>
            {webhookInfo
              ? "Registra esta URL en tu servidor de Evolution API para recibir mensajes."
              : "Las credenciales se guardan cifradas en el comercio y no se vuelven a mostrar."}
          </SheetDescription>
        </SheetHeader>

        {webhookInfo ? (
          <div className="mt-6 flex flex-1 flex-col gap-4">
            <Alert variant="info">
              <PlugZap />
              <AlertTitle>URL de webhook para Evolution API</AlertTitle>
              <AlertDescription className="space-y-3">
                <p>
                  Regístrala para el evento{" "}
                  <code className="font-mono text-xs">MESSAGES_UPSERT</code>.
                </p>
                <div className="flex items-start gap-2">
                  <code className="min-w-0 flex-1 break-all rounded-lg bg-background/60 p-2 font-mono text-xs">
                    {webhookInfo.url}
                  </code>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    aria-label="Copiar URL de webhook"
                    onClick={() => void copyToClipboard(webhookInfo.url, "URL de webhook")}
                  >
                    <Copy aria-hidden className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {webhookInfo.secret ? (
                  <p className="text-xs">
                    El secreto va incluido en la URL (<code className="font-mono">?secret=…</code>)
                    y no se vuelve a mostrar: guárdala antes de cerrar este panel.
                  </p>
                ) : null}
              </AlertDescription>
            </Alert>
            <div className="mt-auto flex justify-end">
              <Button onClick={() => handleOpenChange(false)}>Listo</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 flex flex-1 flex-col gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="connect-provider">Proveedor</Label>
              <Select
                id="connect-provider"
                value={form.provider}
                onChange={(e) => set("provider", e.target.value as Provider)}
              >
                <option value="META">{CHANNEL_LABELS.META} (API oficial)</option>
                <option value="EVOLUTION">{CHANNEL_LABELS.EVOLUTION} (Baileys)</option>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="connect-phone">Número de WhatsApp</Label>
              <Input
                id="connect-phone"
                inputMode="tel"
                autoComplete="off"
                placeholder="+5215500000000"
                aria-describedby="connect-phone-hint"
                value={form.phoneNumber}
                onChange={(e) => set("phoneNumber", e.target.value)}
              />
              <p id="connect-phone-hint" className="text-xs text-muted-foreground">
                Formato internacional (E.164), con código de país.
              </p>
            </div>

            {form.provider === "META" ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="connect-meta-token">Token de acceso</Label>
                  <Input
                    id="connect-meta-token"
                    type="password"
                    autoComplete="off"
                    placeholder="EAAG..."
                    value={form.token}
                    onChange={(e) => set("token", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="connect-meta-phone-id">ID del número (Phone number ID)</Label>
                  <Input
                    id="connect-meta-phone-id"
                    autoComplete="off"
                    placeholder="123456789012345"
                    value={form.phoneId}
                    onChange={(e) => set("phoneId", e.target.value)}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="connect-evo-url">URL base</Label>
                  <Input
                    id="connect-evo-url"
                    type="url"
                    autoComplete="off"
                    placeholder="https://evolution.tu-dominio.com"
                    value={form.baseUrl}
                    onChange={(e) => set("baseUrl", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="connect-evo-key">API key</Label>
                  <Input
                    id="connect-evo-key"
                    type="password"
                    autoComplete="off"
                    placeholder="Tu API key de Evolution"
                    value={form.apiKey}
                    onChange={(e) => set("apiKey", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="connect-evo-instance">Instancia</Label>
                  <Input
                    id="connect-evo-instance"
                    autoComplete="off"
                    placeholder="mi-tienda"
                    value={form.instance}
                    onChange={(e) => set("instance", e.target.value)}
                  />
                </div>
              </>
            )}

            <div className="mt-auto flex flex-wrap justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleOpenChange(false)}
                disabled={connect.isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={!canConnect} loading={connect.isPending}>
                <Plug aria-hidden className="h-4 w-4" />
                Conectar
              </Button>
            </div>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
