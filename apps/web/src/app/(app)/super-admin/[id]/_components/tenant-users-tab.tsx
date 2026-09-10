"use client";

import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MailOpen, MoreHorizontal, UserPlus, Users } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ROLE_LABELS, StatusBadge } from "@/components/ui/status-badge";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Section } from "@/components/app/section";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { DateTime } from "@/components/app/date-time";
import { InviteUserSheet } from "./invite-user-sheet";
import {
  ALL_ROLES,
  SA_ROOT_KEY,
  type TenantDetail,
  type TenantInvitation,
  type TenantMembership,
  apiErrorMessage,
} from "../../_shared";

/**
 * Pestaña "Usuarios" del detalle de empresa: membresías con cambio de rol y
 * alta/baja, más invitaciones pendientes con revocación y alta.
 *
 * La regla anti-lockout (último propietario activo) vive en el servidor y
 * contesta 409 `{ code: "CONFLICT", message }`; aquí solo se muestra el mensaje.
 */
export function TenantUsersTab({ tenant }: { tenant: TenantDetail }) {
  const queryClient = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [roleTarget, setRoleTarget] = useState<TenantMembership | null>(null);
  const [disableTarget, setDisableTarget] = useState<TenantMembership | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<TenantInvitation | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: SA_ROOT_KEY });
  const base = `/super-admin/tenants/${tenant.id}`;

  const changeRole = useMutation({
    mutationFn: async (input: { membershipId: string; role: string }) => {
      await api.patch(`${base}/memberships/${input.membershipId}`, { role: input.role });
    },
    onSuccess: async () => {
      toast.success("Rol actualizado");
      setRoleTarget(null);
      await invalidate();
    },
    onError: (error) => {
      setRoleTarget(null);
      toast.error(apiErrorMessage(error, "No se pudo cambiar el rol"));
    },
  });

  const disableMember = useMutation({
    mutationFn: async (membershipId: string) => {
      await api.delete(`${base}/memberships/${membershipId}`);
    },
    onSuccess: async () => {
      toast.success("Usuario desactivado");
      setDisableTarget(null);
      await invalidate();
    },
    onError: (error) => {
      setDisableTarget(null);
      toast.error(apiErrorMessage(error, "No se pudo desactivar al usuario"));
    },
  });

  const reactivateMember = useMutation({
    mutationFn: async (membershipId: string) => {
      await api.patch(`${base}/memberships/${membershipId}`, { status: "ACTIVE" });
    },
    onSuccess: async () => {
      toast.success("Usuario reactivado");
      await invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo reactivar al usuario")),
  });

  const revokeInvitation = useMutation({
    mutationFn: async (invitationId: string) => {
      await api.delete(`${base}/invitations/${invitationId}`);
    },
    onSuccess: async () => {
      toast.success("Invitación revocada");
      setRevokeTarget(null);
      await invalidate();
    },
    onError: (error) => {
      setRevokeTarget(null);
      toast.error(apiErrorMessage(error, "No se pudo revocar la invitación"));
    },
  });

  const displayName = (m: TenantMembership) => m.user.fullName || m.user.email;

  const memberColumns: Array<DataTableColumn<TenantMembership>> = [
    {
      key: "name",
      header: "Nombre",
      cell: (m) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium">{m.user.fullName || "Sin nombre"}</span>
          {m.user.isSuperAdmin ? (
            <Badge variant="info" size="sm">
              Super-admin
            </Badge>
          ) : null}
        </span>
      ),
    },
    { key: "email", header: "Correo", className: "text-muted-foreground", cell: (m) => m.user.email },
    {
      key: "role",
      header: "Rol",
      width: "9rem",
      cell: (m) => ROLE_LABELS[m.role] ?? m.role,
    },
    {
      key: "status",
      header: "Estado",
      width: "8rem",
      cell: (m) => <StatusBadge status={m.status} domain="membership" />,
    },
    {
      key: "joinedAt",
      header: "Desde",
      width: "10rem",
      cell: (m) => <DateTime value={m.joinedAt} withTime={false} className="text-muted-foreground" />,
    },
    {
      key: "actions",
      header: <span className="sr-only">Acciones</span>,
      width: "4rem",
      className: "text-right",
      cell: (m) => {
        const busy =
          changeRole.isPending || disableMember.isPending || reactivateMember.isPending;
        if (m.status === "INVITED") {
          return (
            <>
              <span aria-hidden className="text-muted-foreground">
                —
              </span>
              <span className="sr-only">Sin acciones: aún no acepta la invitación</span>
            </>
          );
        }
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Acciones de ${displayName(m)}`}
                disabled={busy}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {m.status === "ACTIVE" ? (
                <>
                  <DropdownMenuItem onSelect={() => setRoleTarget(m)}>Cambiar rol…</DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => setDisableTarget(m)}
                  >
                    Desactivar
                  </DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuItem onSelect={() => reactivateMember.mutate(m.id)}>
                  Reactivar
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  const invitationColumns: Array<DataTableColumn<TenantInvitation>> = [
    { key: "fullName", header: "Nombre", cell: (i) => <span className="font-medium">{i.fullName}</span> },
    { key: "email", header: "Correo", className: "text-muted-foreground", cell: (i) => i.email },
    { key: "role", header: "Rol", width: "9rem", cell: (i) => ROLE_LABELS[i.role] ?? i.role },
    {
      key: "createdAt",
      header: "Enviada",
      width: "10rem",
      cell: (i) => <DateTime value={i.createdAt} withTime={false} className="text-muted-foreground" />,
    },
    {
      key: "expiresAt",
      header: "Vence",
      width: "11rem",
      cell: (i) => <DateTime value={i.expiresAt} className="text-muted-foreground" />,
    },
    {
      key: "actions",
      header: <span className="sr-only">Acciones</span>,
      width: "7rem",
      className: "text-right",
      cell: (i) => (
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          disabled={revokeInvitation.isPending}
          onClick={() => setRevokeTarget(i)}
        >
          Revocar
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <Section
        title="Usuarios"
        headerIcon={<Users className="h-4 w-4" />}
        description="Quién tiene acceso a esta empresa y con qué rol."
        padded={false}
        actions={
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus className="h-4 w-4" />
            Invitar usuario
          </Button>
        }
      >
        <DataTable
          columns={memberColumns}
          rows={tenant.memberships}
          caption={`Usuarios de ${tenant.name}`}
          empty={{
            icon: <Users className="h-6 w-6" />,
            title: "Sin usuarios",
            description: "Todavía nadie aceptó una invitación a esta empresa.",
            action: (
              <Button onClick={() => setInviteOpen(true)}>
                <UserPlus className="h-4 w-4" />
                Invitar usuario
              </Button>
            ),
          }}
        />
      </Section>

      <Section
        title="Invitaciones pendientes"
        headerIcon={<MailOpen className="h-4 w-4" />}
        description="Enlaces enviados que aún no se han aceptado."
        padded={false}
      >
        <DataTable
          columns={invitationColumns}
          rows={tenant.invitations}
          caption={`Invitaciones pendientes de ${tenant.name}`}
          empty={{
            icon: <MailOpen className="h-6 w-6" />,
            title: "Sin invitaciones pendientes",
            description: "Cuando invites a alguien, el enlace aparecerá aquí hasta que lo acepte.",
          }}
        />
      </Section>

      <InviteUserSheet
        tenantId={tenant.id}
        tenantName={tenant.name}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
      />

      <ChangeRoleDialog
        member={roleTarget}
        onOpenChange={(open) => !open && setRoleTarget(null)}
        pending={changeRole.isPending}
        onConfirm={(role) =>
          roleTarget && changeRole.mutate({ membershipId: roleTarget.id, role })
        }
      />

      <ConfirmDialog
        open={disableTarget !== null}
        onOpenChange={(open) => !open && setDisableTarget(null)}
        variant="destructive"
        title={`¿Desactivar a ${disableTarget ? displayName(disableTarget) : ""}?`}
        description={
          disableTarget ? (
            <>
              <span className="font-mono">{disableTarget.user.email}</span> pierde el acceso a{" "}
              {tenant.name} de inmediato y sus sesiones se cierran. Podrás reactivarla desde esta
              misma lista.
            </>
          ) : undefined
        }
        confirmLabel="Desactivar"
        pending={disableMember.isPending}
        onConfirm={() => disableTarget && disableMember.mutate(disableTarget.id)}
      />

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        variant="destructive"
        title={`¿Revocar la invitación de ${revokeTarget?.fullName ?? ""}?`}
        description={
          revokeTarget ? (
            <>
              El enlace deja de funcionar: <span className="font-mono">{revokeTarget.email}</span>{" "}
              ya no podrá crear su cuenta con él. Puedes volver a invitarla cuando quieras.
            </>
          ) : undefined
        }
        confirmLabel="Revocar"
        pending={revokeInvitation.isPending}
        onConfirm={() => revokeTarget && revokeInvitation.mutate(revokeTarget.id)}
      />
    </div>
  );
}

/**
 * Diálogo "Cambiar rol": un `Select` con todos los roles y confirmación. Se
 * monta con `key={member.id}` para que el rol elegido arranque en el vigente
 * cada vez que se abre para otra persona.
 */
function ChangeRoleDialog({
  member,
  onOpenChange,
  pending,
  onConfirm,
}: {
  member: TenantMembership | null;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onConfirm: (role: string) => void;
}) {
  return (
    <AlertDialog open={member !== null} onOpenChange={onOpenChange}>
      {member ? (
        <ChangeRoleDialogBody
          key={member.id}
          member={member}
          pending={pending}
          onConfirm={onConfirm}
        />
      ) : null}
    </AlertDialog>
  );
}

function ChangeRoleDialogBody({
  member,
  pending,
  onConfirm,
}: {
  member: TenantMembership;
  pending: boolean;
  onConfirm: (role: string) => void;
}) {
  const [role, setRole] = useState(member.role);
  const selectId = useId();
  const name = member.user.fullName || member.user.email;
  const unchanged = role === member.role;

  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Cambiar el rol de {name}</AlertDialogTitle>
        <AlertDialogDescription>
          <p>
            Hoy es <strong>{ROLE_LABELS[member.role] ?? member.role}</strong>. Sus permisos cambian
            de inmediato al confirmar.
          </p>
          <div className="mt-4 space-y-1.5">
            <Label htmlFor={selectId} className="text-foreground">
              Nuevo rol
            </Label>
            <Select id={selectId} value={role} onChange={(e) => setRole(e.target.value)}>
              {ALL_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r] ?? r}
                </option>
              ))}
            </Select>
          </div>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
        <AlertDialogAction
          variant="default"
          loading={pending}
          disabled={unchanged}
          onClick={() => onConfirm(role)}
        >
          Cambiar rol
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}
