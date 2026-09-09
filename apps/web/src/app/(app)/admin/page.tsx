"use client";
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Bot, ShieldCheck, Copy, KeyRound, Trash2, UserPlus } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/app/page-header";
import { ConfirmDialog } from "@/components/confirm-dialog";

interface Notification {
  id: string;
  channel: string;
  status: string;
  templateKey: string;
  attempts: number;
  scheduledAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
}

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

function MfaSection() {
  const queryClient = useQueryClient();
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const [code, setCode] = useState("");

  const me = useQuery({
    queryKey: ["auth-me"],
    queryFn: async () => {
      const res = await api.get<{ data: Me }>("/auth/me");
      return res.data.data;
    },
  });

  const enroll = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ data: MfaEnrollment }>("/auth/mfa/enroll");
      return res.data.data;
    },
    onSuccess: (data) => setEnrollment(data),
    onError: () => toast.error("No se pudo iniciar el enrolamiento"),
  });

  const confirm = useMutation({
    mutationFn: async () => {
      await api.post("/auth/mfa/enroll/confirm", { code });
    },
    onSuccess: async () => {
      toast.success("MFA activado");
      setEnrollment(null);
      setCode("");
      await queryClient.invalidateQueries({ queryKey: ["auth-me"] });
    },
    onError: () => toast.error("Código inválido"),
  });

  return (
    <section className="rounded-card border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4" />
        <h2 className="font-semibold">Seguridad · Verificación en dos pasos</h2>
      </div>

      {me.data?.totpEnabled && !enrollment ? (
        <p className="text-sm text-muted-foreground">
          MFA activado para <span className="font-mono">{me.data.email}</span>.
        </p>
      ) : !enrollment ? (
        <div>
          <p className="mb-3 text-sm text-muted-foreground">
            Protege tu cuenta con una app autenticadora (Google Authenticator, Authy, etc.).
          </p>
          <Button size="sm" onClick={() => enroll.mutate()} disabled={enroll.isPending}>
            {enroll.isPending ? "Generando…" : "Activar MFA"}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-sm font-medium">1. Agrega esta clave a tu app autenticadora</p>
            <div className="flex items-center gap-2">
              <code className="rounded bg-muted px-2 py-1 text-xs">{enrollment.secretBase32}</code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void copyToClipboard(enrollment.secretBase32, "Clave")}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <a
              href={enrollment.otpauthUrl}
              className="mt-1 block truncate text-xs text-primary underline"
            >
              {enrollment.otpauthUrl}
            </a>
          </div>

          <div>
            <p className="mb-1 text-sm font-medium">
              2. Guarda tus códigos de recuperación (se muestran una sola vez)
            </p>
            <div className="grid grid-cols-2 gap-1 rounded bg-muted p-2 font-mono text-xs">
              {enrollment.recoveryCodes.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1 text-sm font-medium">3. Confirma con un código de 6 dígitos</p>
            <div className="flex gap-2">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                className="max-w-[140px]"
              />
              <Button size="sm" onClick={() => confirm.mutate()} disabled={confirm.isPending || !code}>
                {confirm.isPending ? "Confirmando…" : "Confirmar"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setEnrollment(null)}>
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

interface ApiKey {
  id: string;
  prefix: string;
  name: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
}

function ApiKeysSection() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);

  const keys = useQuery({
    queryKey: ["api-keys"],
    queryFn: async () => {
      const res = await api.get<{ data: ApiKey[] }>("/iam/api-keys");
      return res.data.data;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ data: { secret: string } }>("/iam/api-keys", {
        name,
        scopes: scopes.split(",").map((s) => s.trim()).filter(Boolean),
        expiresInDays: expiresInDays ? Number(expiresInDays) : undefined,
      });
      return res.data.data;
    },
    onSuccess: async (data) => {
      setNewSecret(data.secret);
      setName("");
      setScopes("");
      setExpiresInDays("");
      await queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: () => toast.error("No se pudo crear la API key"),
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/iam/api-keys/${id}`);
    },
    onSuccess: async () => {
      toast.success("API key revocada");
      setRevokeTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: () => toast.error("No se pudo revocar"),
  });

  return (
    <section className="rounded-card border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <KeyRound className="h-4 w-4" />
        <h2 className="font-semibold">API keys</h2>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase text-muted-foreground">
            <th className="p-2">Nombre</th>
            <th className="p-2">Prefijo</th>
            <th className="p-2">Scopes</th>
            <th className="p-2">Expira</th>
            <th className="p-2">Último uso</th>
            <th className="p-2"></th>
          </tr>
        </thead>
        <tbody>
          {keys.data?.map((k) => (
            <tr key={k.id} className="border-b last:border-0">
              <td className="p-2">{k.name}</td>
              <td className="p-2 font-mono text-xs">{k.prefix}</td>
              <td className="p-2 text-xs text-muted-foreground">{k.scopes.join(", ")}</td>
              <td className="p-2 text-xs text-muted-foreground">
                {k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : "—"}
              </td>
              <td className="p-2 text-xs text-muted-foreground">
                {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "Nunca"}
              </td>
              <td className="p-2 text-right">
                <Button variant="ghost" size="sm" onClick={() => setRevokeTarget(k)}>
                  <Trash2 className="h-3.5 w-3.5" />
                  Revocar
                </Button>
              </td>
            </tr>
          ))}
          {keys.data?.length === 0 && (
            <tr>
              <td colSpan={6} className="p-3 text-center text-sm text-muted-foreground">
                Sin API keys.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="mt-4 border-t pt-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Nombre</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Integración X" />
          </div>
          <div className="space-y-1.5">
            <Label>Scopes (separados por coma)</Label>
            <Input
              value={scopes}
              onChange={(e) => setScopes(e.target.value)}
              placeholder="catalog.read, orders.write"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Expira en (días, opcional)</Label>
            <Input value={expiresInDays} onChange={(e) => setExpiresInDays(e.target.value)} placeholder="90" />
          </div>
        </div>
        <Button
          className="mt-3"
          size="sm"
          onClick={() => create.mutate()}
          disabled={!name || !scopes || create.isPending}
        >
          {create.isPending ? "Creando…" : "Crear API key"}
        </Button>
      </div>

      {newSecret && (
        <div className="mt-4 rounded-lg border bg-muted p-3 text-xs">
          <p className="mb-1 font-medium">
            Copia esta key ahora: no se muestra de nuevo.
          </p>
          <div className="flex items-center gap-2">
            <code className="break-all">{newSecret}</code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void copyToClipboard(newSecret, "API key")}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title={`¿Revocar "${revokeTarget?.name}"?`}
        description="Cualquier integración usando esta key deja de funcionar de inmediato. No se puede deshacer."
        confirmLabel="Revocar"
        pending={revoke.isPending}
        onConfirm={() => revokeTarget && revoke.mutate(revokeTarget.id)}
      />
    </section>
  );
}

const ROLE_OPTIONS = ["VENDOR", "FINANCE", "CATALOG", "SUPPORT", "VIEWER"] as const;

function InviteUserSection() {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<(typeof ROLE_OPTIONS)[number]>("VENDOR");
  const [inviteToken, setInviteToken] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ data: { token?: string } }>("/iam/invitations", {
        email,
        fullName,
        role,
      });
      return res.data.data;
    },
    onSuccess: (data) => {
      toast.success("Invitación creada");
      setEmail("");
      setFullName("");
      if (data.token) setInviteToken(data.token);
    },
    onError: () => toast.error("No se pudo invitar"),
  });

  return (
    <section className="rounded-card border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <UserPlus className="h-4 w-4" />
        <h2 className="font-semibold">Invitar usuario</h2>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Nombre</Label>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Email</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Rol</Label>
          <select
            className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            value={role}
            onChange={(e) => setRole(e.target.value as (typeof ROLE_OPTIONS)[number])}
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>
      <Button
        className="mt-3"
        size="sm"
        onClick={() => invite.mutate()}
        disabled={!email || !fullName || invite.isPending}
      >
        {invite.isPending ? "Invitando…" : "Enviar invitación"}
      </Button>

      {inviteToken && (
        <div className="mt-4 rounded-lg border bg-muted p-3 text-xs">
          <p className="mb-1 font-medium">Modo desarrollo (sin envío real de correo):</p>
          <Link href={`/accept-invite?token=${encodeURIComponent(inviteToken)}`} className="break-all text-primary underline">
            /accept-invite?token={inviteToken}
          </Link>
        </div>
      )}
    </section>
  );
}

export default function AdminPage() {
  const notifications = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => {
      const res = await api.get<{ data: Notification[] }>("/notifications");
      return res.data.data;
    },
  });

  const audit = useQuery({
    queryKey: ["audit"],
    queryFn: async () => {
      const res = await api.get<{ data: Array<{ action: string; createdAt: string; metadata: unknown }> }>(
        "/audit/events",
      );
      return res.data.data;
    },
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Administración"
        description="Notificaciones y auditoría del tenant."
        actions={
          <Button asChild variant="outline">
            <Link href="/agent">
              <Bot className="h-4 w-4" />
              Consola del agente
            </Link>
          </Button>
        }
      />

      <MfaSection />

      <ApiKeysSection />

      <InviteUserSection />

      <section className="rounded-card border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Notificaciones</h2>
          <Button asChild variant="outline" size="sm">
            <a href="/api/v1/notifications/export.csv" download>
              <Download className="h-4 w-4" />
              Exportar CSV
            </a>
          </Button>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-muted-foreground">
              <th className="p-2">Canal</th>
              <th className="p-2">Template</th>
              <th className="p-2">Estado</th>
              <th className="p-2">Intentos</th>
              <th className="p-2">Programado</th>
            </tr>
          </thead>
          <tbody>
            {notifications.data?.map((n) => (
              <tr key={n.id} className="border-b">
                <td className="p-2">{n.channel}</td>
                <td className="p-2 font-mono text-xs">{n.templateKey}</td>
                <td className="p-2 uppercase text-xs">{n.status}</td>
                <td className="p-2 text-center">{n.attempts}</td>
                <td className="p-2 text-xs">
                  {new Date(n.scheduledAt).toLocaleString()}
                </td>
              </tr>
            ))}
            {notifications.data?.length === 0 && (
              <tr>
                <td colSpan={5} className="p-3 text-center text-sm text-muted-foreground">
                  Sin notificaciones.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="rounded-card border bg-card p-4">
        <h2 className="mb-3 font-semibold">Auditoría</h2>
        <ul className="space-y-1 text-xs">
          {audit.data?.map((e, i) => (
            <li key={i} className="border-b pb-1 last:border-0">
              <span className="font-mono">{new Date(e.createdAt).toISOString()}</span>{" "}
              <strong>{e.action}</strong>
              {e.metadata ? (
                <pre className="ml-2 inline text-muted-foreground">
                  {JSON.stringify(e.metadata)}
                </pre>
              ) : null}
            </li>
          ))}
          {audit.data?.length === 0 && (
            <li className="text-muted-foreground">Sin eventos.</li>
          )}
        </ul>
      </section>
    </div>
  );
}