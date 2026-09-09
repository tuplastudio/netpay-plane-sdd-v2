"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plug, Unplug, HeartPulse, MessageSquare, UserCog, Copy } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page-header";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface Connection {
  id: string;
  provider: "META" | "EVOLUTION";
  phoneNumber: string | null;
  status: string;
}

interface Conversation {
  id: string;
  externalPhone: string;
  status: string;
  handoffToHuman: boolean;
  lastMessageAt: string | null;
  connection: { provider: string; phoneNumber: string | null };
}

interface Message {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  body: string;
  status: string;
  createdAt: string;
}

async function copyToClipboard(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copiado`);
  } catch {
    toast.message(label, { description: text });
  }
}

function statusVariant(status: string): "success" | "warning" | "muted" | "destructive" {
  if (status === "ACTIVE") return "success";
  if (status === "PENDING") return "warning";
  if (status === "DISCONNECTED" || status === "ERROR") return "destructive";
  return "muted";
}

export default function ChannelsPage() {
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<"META" | "EVOLUTION">("META");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [token, setToken] = useState("");
  const [phoneId, setPhoneId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [instance, setInstance] = useState("");
  const [disconnectTarget, setDisconnectTarget] = useState<Connection | null>(null);
  const [webhookInfo, setWebhookInfo] = useState<{ url: string; secret?: string } | null>(null);

  const me = useQuery({
    queryKey: ["auth-me"],
    queryFn: async () => {
      const res = await api.get<{ data: { id: string; tenantSlug: string | null } }>("/auth/me");
      return res.data.data;
    },
  });
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);

  const connections = useQuery({
    queryKey: ["whatsapp-connections"],
    queryFn: async () => {
      const res = await api.get<{ data: Connection[] }>("/whatsapp/connections");
      return res.data.data;
    },
  });

  const conversations = useQuery({
    queryKey: ["whatsapp-conversations"],
    queryFn: async () => {
      const res = await api.get<{ data: Conversation[] }>("/whatsapp/conversations");
      return res.data.data;
    },
  });


  const messages = useQuery({
    queryKey: ["whatsapp-messages", activeConversation?.id],
    queryFn: async () => {
      const res = await api.get<{ data: Message[] }>(
        `/whatsapp/conversations/${activeConversation!.id}/messages`,
      );
      return res.data.data;
    },
    enabled: !!activeConversation,
  });

  const connect = useMutation({
    mutationFn: async () => {
      const credentials =
        provider === "META" ? { token, phoneId } : { baseUrl, apiKey, instance };
      const res = await api.post<{ data: { webhookSecret?: string } }>("/whatsapp/connect", {
        provider,
        phoneNumber,
        credentials,
      });
      return res.data.data;
    },
    onSuccess: async (data) => {
      toast.success("Conexión guardada");
      if (provider === "EVOLUTION" && me.data?.tenantSlug) {
        const base = `${window.location.origin}/api/v1/whatsapp/webhook/inbound/${me.data.tenantSlug}`;
        setWebhookInfo({
          url: data.webhookSecret ? `${base}?secret=${data.webhookSecret}` : base,
          secret: data.webhookSecret,
        });
      }
      setPhoneNumber("");
      setToken("");
      setPhoneId("");
      setBaseUrl("");
      setApiKey("");
      setInstance("");
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-connections"] });
    },
    onError: () => toast.error("No se pudo conectar"),
  });

  const disconnect = useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/whatsapp/${id}/disconnect`);
    },
    onSuccess: async () => {
      toast.success("Conexión desconectada");
      setDisconnectTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-connections"] });
    },
    onError: () => toast.error("No se pudo desconectar"),
  });

  const checkHealth = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post<{ data: { ok: boolean; latencyMs: number; error?: string } }>(
        `/whatsapp/${id}/health`,
      );
      return res.data.data;
    },
    onSuccess: (data) => {
      if (data.ok) toast.success(`Conexión saludable (${data.latencyMs}ms)`);
      else toast.error(data.error ?? "Conexión no responde");
    },
    onError: () => toast.error("No se pudo verificar"),
  });

  const handoff = useMutation({
    mutationFn: async (conversationId: string) => {
      await api.post(`/whatsapp/conversations/${conversationId}/handoff`, { userId: me.data!.id });
    },
    onSuccess: async () => {
      toast.success("Conversación transferida a un humano");
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
    },
    onError: () => toast.error("No se pudo transferir"),
  });

  const canConnect =
    phoneNumber.trim().length > 0 &&
    (provider === "META" ? token.trim().length > 0 : apiKey.trim().length > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Canales"
        description="Conecta WhatsApp (Meta o Evolution) y gestiona conversaciones con handoff a humano."
      />

      <section className="rounded-card border bg-card p-4">
        <h2 className="mb-3 font-semibold">Conexiones</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-muted-foreground">
              <th className="p-2">Proveedor</th>
              <th className="p-2">Teléfono</th>
              <th className="p-2">Estado</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {connections.data?.map((c) => (
              <tr key={c.id} className="border-b last:border-0">
                <td className="p-2 font-mono text-xs">{c.provider}</td>
                <td className="p-2">{c.phoneNumber ?? "—"}</td>
                <td className="p-2">
                  <Badge variant={statusVariant(c.status)}>{c.status}</Badge>
                </td>
                <td className="p-2 text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => checkHealth.mutate(c.id)}>
                      <HeartPulse className="h-3.5 w-3.5" />
                      Verificar
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setDisconnectTarget(c)}>
                      <Unplug className="h-3.5 w-3.5" />
                      Desconectar
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {connections.data?.length === 0 && (
              <tr>
                <td colSpan={4} className="p-3 text-center text-sm text-muted-foreground">
                  Sin conexiones. Conecta una abajo.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="mt-6 border-t pt-4">
          <h3 className="mb-3 text-sm font-medium">Conectar nuevo canal</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Proveedor</Label>
              <select
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                value={provider}
                onChange={(e) => setProvider(e.target.value as "META" | "EVOLUTION")}
              >
                <option value="META">Meta (oficial)</option>
                <option value="EVOLUTION">Evolution API</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Número (E.164)</Label>
              <Input
                placeholder="+5215500000000"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
              />
            </div>

            {provider === "META" ? (
              <>
                <div className="space-y-1.5">
                  <Label>Access token</Label>
                  <Input value={token} onChange={(e) => setToken(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Phone number ID</Label>
                  <Input value={phoneId} onChange={(e) => setPhoneId(e.target.value)} />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label>Base URL</Label>
                  <Input
                    placeholder="https://evolution.tu-dominio.com"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>API key</Label>
                  <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Instance</Label>
                  <Input value={instance} onChange={(e) => setInstance(e.target.value)} />
                </div>
              </>
            )}
          </div>
          <Button
            className="mt-3"
            onClick={() => connect.mutate()}
            disabled={!canConnect || connect.isPending}
          >
            <Plug className="h-4 w-4" />
            {connect.isPending ? "Conectando…" : "Conectar"}
          </Button>
        </div>

        {webhookInfo && (
          <div className="mt-4 rounded-lg border bg-muted p-3 text-xs">
            <p className="mb-1 font-medium">
              Configura este webhook en tu instancia de Evolution API (evento <code>MESSAGES_UPSERT</code>):
            </p>
            <div className="flex items-center gap-2">
              <code className="break-all">{webhookInfo.url}</code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void copyToClipboard(webhookInfo.url, "URL de webhook")}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            {webhookInfo.secret && (
              <p className="mt-1 text-muted-foreground">
                El secreto va incluido en la URL (?secret=…) — no se vuelve a mostrar.
              </p>
            )}
          </div>
        )}
      </section>

      <section className="rounded-card border bg-card p-4">
        <h2 className="mb-3 font-semibold">Conversaciones</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-muted-foreground">
              <th className="p-2">Teléfono</th>
              <th className="p-2">Canal</th>
              <th className="p-2">Estado</th>
              <th className="p-2">Último mensaje</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {conversations.data?.map((c) => (
              <tr key={c.id} className="border-b last:border-0">
                <td className="p-2 font-mono text-xs">{c.externalPhone}</td>
                <td className="p-2 text-xs">{c.connection.provider}</td>
                <td className="p-2">
                  <Badge variant={c.handoffToHuman ? "warning" : "muted"}>
                    {c.handoffToHuman ? "Con humano" : c.status}
                  </Badge>
                </td>
                <td className="p-2 text-xs text-muted-foreground">
                  {c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleString() : "—"}
                </td>
                <td className="p-2 text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => setActiveConversation(c)}>
                      <MessageSquare className="h-3.5 w-3.5" />
                      Ver
                    </Button>
                    {!c.handoffToHuman && (
                      <Button variant="ghost" size="sm" onClick={() => handoff.mutate(c.id)}>
                        <UserCog className="h-3.5 w-3.5" />
                        Transferir
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {conversations.data?.length === 0 && (
              <tr>
                <td colSpan={5} className="p-3 text-center text-sm text-muted-foreground">
                  Sin conversaciones todavía.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <ConfirmDialog
        open={disconnectTarget !== null}
        onOpenChange={(open) => !open && setDisconnectTarget(null)}
        title={`¿Desconectar ${disconnectTarget?.provider}?`}
        description="El canal deja de enviar y recibir mensajes hasta que se reconecte."
        confirmLabel="Desconectar"
        pending={disconnect.isPending}
        onConfirm={() => disconnectTarget && disconnect.mutate(disconnectTarget.id)}
      />

      <Sheet open={activeConversation !== null} onOpenChange={(open) => !open && setActiveConversation(null)}>
        <SheetContent side="right" className="w-full max-w-md">
          <SheetHeader>
            <SheetTitle>{activeConversation?.externalPhone}</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-3 overflow-y-auto">
            {messages.data?.map((m) => (
              <div
                key={m.id}
                className={
                  m.direction === "OUTBOUND"
                    ? "ml-auto max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
                    : "mr-auto max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm"
                }
              >
                {m.body}
                <p className="mt-1 text-[10px] opacity-70">
                  {new Date(m.createdAt).toLocaleTimeString()}
                </p>
              </div>
            ))}
            {messages.data?.length === 0 && (
              <p className="text-center text-sm text-muted-foreground">Sin mensajes.</p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
