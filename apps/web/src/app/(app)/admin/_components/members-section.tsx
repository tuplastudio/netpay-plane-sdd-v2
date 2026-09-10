"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, MoreHorizontal, Users } from "lucide-react";
import { api } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROLE_LABELS, StatusBadge } from "@/components/ui/status-badge";
import { Section } from "@/components/app/section";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { DateTime } from "@/components/app/date-time";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { InviteUserTrigger } from "./invite-user-sheet";
import { apiErrorMessage } from "./api-error";

/**
 * Miembros del tenant: alta de rol, remoción y revocación de invitaciones.
 *
 * Todo lo que este componente deshabilita es CORTESÍA: la regla vive en el
 * servidor (apps/commerce-api/src/auth/membership.service.ts) y cualquier
 * rechazo suyo se muestra tal cual en el `Alert` de la sección.
 */

export interface Member {
  id: string;
  kind: "MEMBERSHIP" | "INVITATION";
  userId: string | null;
  fullName: string;
  email: string;
  role: string;
  status: "ACTIVE" | "INVITED" | "DISABLED";
  isSelf: boolean;
  joinedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
}

/** Clave de caché compartida: la usa también el alta de invitaciones. */
export const MEMBERS_QUERY_KEY = ["memberships"] as const;

/**
 * Orden de presentación de los roles. OWNER y ADMIN SÍ aparecen aquí (a
 * diferencia de la invitación inicial): quien administra usuarios necesita
 * poder nombrar a otro administrador, y a otro propietario si él mismo lo es.
 * `roleOptionsFor` recorta la lista para que coincida con la regla del servidor.
 */
const ROLE_ORDER = [
  "OWNER",
  "ADMIN",
  "VENDOR",
  "FINANCE",
  "CATALOG",
  "SUPPORT",
  "VIEWER",
] as const;

/** Solo un propietario puede otorgar o retirar OWNER (scope `tenant.admin`). */
function roleOptionsFor(myRole: string | null, currentRole: string): string[] {
  const base = ROLE_ORDER.filter((r) => (r === "OWNER" ? myRole === "OWNER" : true));
  return base.includes(currentRole as (typeof ROLE_ORDER)[number])
    ? [...base]
    : [currentRole, ...base];
}

export function MembersSection() {
  const queryClient = useQueryClient();
  const [roleTarget, setRoleTarget] = useState<{ member: Member; role: string } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const members = useQuery({
    queryKey: MEMBERS_QUERY_KEY,
    queryFn: async () => {
      const res = await api.get<{ data: Member[] }>("/iam/memberships");
      return res.data.data;
    },
  });

  const rows = members.data;

  /** Rol propio según el servidor (viene marcado con `isSelf` en la lista). */
  const myRole = useMemo(() => rows?.find((r) => r.isSelf)?.role ?? null, [rows]);

  /** Anti-lockout, versión cortesía: el último propietario activo se protege. */
  const lastActiveOwnerId = useMemo(() => {
    const owners = (rows ?? []).filter(
      (r) => r.kind === "MEMBERSHIP" && r.role === "OWNER" && r.status === "ACTIVE",
    );
    return owners.length === 1 ? (owners[0]?.id ?? null) : null;
  }, [rows]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: MEMBERS_QUERY_KEY }),
      // La bitácora de esta misma pantalla acaba de recibir el evento.
      queryClient.invalidateQueries({ queryKey: ["audit"] }),
    ]);
  };

  const changeRole = useMutation({
    mutationFn: async (input: { id: string; role: string }) => {
      await api.patch(`/iam/memberships/${input.id}`, { role: input.role });
    },
    onSuccess: async () => {
      toast.success("Rol actualizado");
      setServerError(null);
      setRoleTarget(null);
      await invalidate();
    },
    onError: (error) => {
      setRoleTarget(null);
      setServerError(apiErrorMessage(error, "No se pudo cambiar el rol."));
    },
  });

  const removeMember = useMutation({
    mutationFn: async (member: Member) => {
      const path =
        member.kind === "INVITATION"
          ? `/iam/invitations/${member.id}`
          : `/iam/memberships/${member.id}`;
      await api.delete(path);
    },
    onSuccess: async (_data, member) => {
      toast.success(
        member.kind === "INVITATION" ? "Invitación revocada" : "Miembro removido del portal",
      );
      setServerError(null);
      setRemoveTarget(null);
      await invalidate();
    },
    onError: (error, member) => {
      setRemoveTarget(null);
      setServerError(
        apiErrorMessage(
          error,
          member.kind === "INVITATION"
            ? "No se pudo revocar la invitación."
            : "No se pudo quitar a la persona del portal.",
        ),
      );
    },
  });

  /** Motivo por el que una fila no se puede editar (o null si sí se puede). */
  function lockReason(member: Member): string | null {
    if (member.kind === "INVITATION") return "Aún no acepta la invitación";
    if (member.isSelf) return "Tu propia cuenta";
    if (member.status === "DISABLED") return "Sin acceso";
    if (member.id === lastActiveOwnerId) return "Último propietario activo";
    if (member.role === "OWNER" && myRole !== "OWNER") return "Solo otro propietario";
    return null;
  }

  const columns: Array<DataTableColumn<Member>> = [
    {
      key: "person",
      header: "Persona",
      cell: (m) => (
        <span className="flex flex-col">
          <span className="font-medium">{m.fullName}</span>
          <span className="text-xs text-muted-foreground">{m.email}</span>
        </span>
      ),
    },
    {
      key: "role",
      header: "Rol",
      width: "14rem",
      cell: (m) => {
        const reason = lockReason(m);
        if (reason) {
          return (
            <span className="flex flex-col">
              <span>{ROLE_LABELS[m.role] ?? m.role}</span>
              <span className="text-xs text-muted-foreground">{reason}</span>
            </span>
          );
        }
        return (
          <Select
            aria-label={`Rol de ${m.fullName}`}
            value={m.role}
            disabled={changeRole.isPending}
            onChange={(e) => {
              const role = e.target.value;
              if (role !== m.role) setRoleTarget({ member: m, role });
            }}
          >
            {roleOptionsFor(myRole, m.role).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r] ?? r}
              </option>
            ))}
          </Select>
        );
      },
    },
    {
      key: "status",
      header: "Estado",
      width: "9rem",
      cell: (m) => <StatusBadge status={m.status} domain="membership" />,
    },
    {
      key: "since",
      header: "Alta",
      width: "13rem",
      cell: (m) =>
        m.kind === "MEMBERSHIP" ? (
          <DateTime value={m.joinedAt} withTime={false} className="text-muted-foreground" />
        ) : (
          <span className="text-xs text-muted-foreground">
            Invitada el <DateTime value={m.createdAt} withTime={false} />
          </span>
        ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Acciones</span>,
      width: "5rem",
      className: "text-right",
      cell: (m) => {
        const canRevoke = m.kind === "INVITATION";
        const canRemove =
          m.kind === "MEMBERSHIP" &&
          !m.isSelf &&
          m.status !== "DISABLED" &&
          m.id !== lastActiveOwnerId &&
          (m.role !== "OWNER" || myRole === "OWNER");

        if (!canRevoke && !canRemove) {
          return (
            <>
              <span aria-hidden className="text-muted-foreground">
                —
              </span>
              <span className="sr-only">Sin acciones disponibles</span>
            </>
          );
        }

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Acciones de ${m.fullName}`}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-destructive"
                onSelect={() => setRemoveTarget(m)}
              >
                {canRevoke ? "Revocar invitación" : "Quitar del portal"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <>
      <Section
        title="Miembros"
        headerIcon={<Users className="h-4 w-4" />}
        description="Quién tiene acceso al tenant, con qué rol y qué invitaciones siguen abiertas."
        padded={false}
        actions={<InviteUserTrigger />}
        footer={
          serverError ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>No se pudo completar la acción</AlertTitle>
              <AlertDescription>
                {serverError}
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => setServerError(null)}
                >
                  Entendido
                </Button>
              </AlertDescription>
            </Alert>
          ) : undefined
        }
      >
        <DataTable
          columns={columns}
          rows={rows}
          isLoading={members.isLoading}
          isError={members.isError}
          error={members.error}
          onRetry={() => void members.refetch()}
          caption="Miembros e invitaciones del tenant"
          empty={{
            icon: <Users className="h-6 w-6" />,
            title: "Sin miembros",
            description:
              "Pulsa “Invitar usuario” en la esquina superior derecha para sumar a la primera persona.",
          }}
        />
      </Section>

      <ConfirmDialog
        open={roleTarget !== null}
        onOpenChange={(open) => !open && setRoleTarget(null)}
        variant="default"
        title={`¿Cambiar el rol de ${roleTarget?.member.fullName ?? ""}?`}
        description={
          roleTarget ? (
            <>
              {roleTarget.member.fullName} (
              <span className="font-mono">{roleTarget.member.email}</span>) pasa de{" "}
              <strong>{ROLE_LABELS[roleTarget.member.role] ?? roleTarget.member.role}</strong> a{" "}
              <strong>{ROLE_LABELS[roleTarget.role] ?? roleTarget.role}</strong>. Sus permisos
              cambian de inmediato.
            </>
          ) : undefined
        }
        confirmLabel="Cambiar rol"
        pending={changeRole.isPending}
        onConfirm={() =>
          roleTarget && changeRole.mutate({ id: roleTarget.member.id, role: roleTarget.role })
        }
      />

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        variant="destructive"
        title={
          removeTarget?.kind === "INVITATION"
            ? `¿Revocar la invitación de ${removeTarget?.fullName ?? ""}?`
            : `¿Quitar a ${removeTarget?.fullName ?? ""} del portal?`
        }
        description={
          removeTarget ? (
            removeTarget.kind === "INVITATION" ? (
              <>
                El enlace deja de funcionar: <span className="font-mono">{removeTarget.email}</span>{" "}
                ya no podrá crear su cuenta con él. Puedes volver a invitarla cuando quieras.
              </>
            ) : (
              <>
                {removeTarget.fullName} (
                <span className="font-mono">{removeTarget.email}</span>) pierde el acceso de
                inmediato y sus sesiones se cierran. Su historial se conserva; para devolverle el
                acceso tendrás que invitarla de nuevo.
              </>
            )
          ) : undefined
        }
        confirmLabel={removeTarget?.kind === "INVITATION" ? "Revocar" : "Quitar"}
        pending={removeMember.isPending}
        onConfirm={() => removeTarget && removeMember.mutate(removeTarget)}
      />
    </>
  );
}
