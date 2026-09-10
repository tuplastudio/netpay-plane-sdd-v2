"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search, Users } from "lucide-react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROLE_LABELS, StatusBadge } from "@/components/ui/status-badge";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { DateTime } from "@/components/app/date-time";
import { type PlatformUser, formatInt, saUsersKey } from "../_shared";

const DEBOUNCE_MS = 300;

const columns: Array<DataTableColumn<PlatformUser>> = [
  {
    key: "name",
    header: "Nombre",
    cell: (u) => <span className="font-medium">{u.fullName || "Sin nombre"}</span>,
  },
  { key: "email", header: "Correo", className: "text-muted-foreground", cell: (u) => u.email },
  {
    key: "mfa",
    header: "MFA",
    width: "7rem",
    cell: (u) =>
      u.totpEnabled ? (
        <Badge variant="success" size="sm">
          Activa
        </Badge>
      ) : (
        <Badge variant="neutral" size="sm">
          Sin MFA
        </Badge>
      ),
  },
  {
    key: "superAdmin",
    header: "Super-admin",
    width: "8rem",
    cell: (u) =>
      u.isSuperAdmin ? (
        <Badge variant="info" size="sm">
          Super-admin
        </Badge>
      ) : (
        <>
          <span aria-hidden className="text-muted-foreground">
            —
          </span>
          <span className="sr-only">No</span>
        </>
      ),
  },
  {
    key: "tenants",
    header: "Empresas",
    cell: (u) =>
      u.memberships.length === 0 ? (
        <>
          <span aria-hidden className="text-muted-foreground">
            —
          </span>
          <span className="sr-only">Sin empresas</span>
        </>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {u.memberships.map((m) => (
            <li key={m.id}>
              <Link
                href={`/super-admin/${m.tenant.id}`}
                className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-background px-2 py-0.5 text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
              >
                <span className="font-medium">{m.tenant.name}</span>
                <span aria-hidden className="text-muted-foreground">
                  ·
                </span>
                <span className="text-muted-foreground">{ROLE_LABELS[m.role] ?? m.role}</span>
                <StatusBadge status={m.status} domain="membership" size="sm" />
              </Link>
            </li>
          ))}
        </ul>
      ),
  },
  {
    key: "createdAt",
    header: "Alta",
    width: "10rem",
    cell: (u) => <DateTime value={u.createdAt} withTime={false} className="text-muted-foreground" />,
  },
];

export default function SuperAdminUsersPage() {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");

  // Búsqueda con retardo: la consulta sale cuando la persona deja de escribir.
  useEffect(() => {
    const handle = setTimeout(() => setQ(search.trim()), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [search]);

  const users = useQuery({
    queryKey: saUsersKey(q),
    queryFn: async () => {
      const res = await api.get<{ data: PlatformUser[] }>("/super-admin/users", {
        params: q ? { q } : {},
      });
      return res.data.data;
    },
    // Al cambiar el término se conserva la lista anterior: sin parpadeo a skeleton.
    placeholderData: keepPreviousData,
  });

  const count = users.data?.length;

  return (
    <div>
      <PageHeader
        title="Usuarios"
        description="Todas las cuentas de la plataforma y las empresas a las que pertenecen."
      />

      <div className="space-y-6">
        <Section title="Buscar" density="compact">
          <div className="space-y-1.5">
            <Label htmlFor="users-search">Nombre o correo</Label>
            <div className="relative">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="users-search"
                type="search"
                placeholder="Escribe para filtrar…"
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </Section>

        <Section
          title="Listado"
          description={
            count === undefined
              ? undefined
              : q
                ? `${formatInt(count)} ${count === 1 ? "resultado" : "resultados"} para “${q}”`
                : `${formatInt(count)} ${count === 1 ? "usuario" : "usuarios"}`
          }
          padded={false}
        >
          <DataTable
            columns={columns}
            rows={users.data}
            isLoading={users.isLoading}
            isError={users.isError}
            error={users.error}
            onRetry={() => void users.refetch()}
            caption="Usuarios de la plataforma"
            empty={
              q
                ? {
                    icon: <Search className="h-6 w-6" />,
                    title: "Sin coincidencias",
                    description: `Ningún usuario coincide con “${q}”.`,
                  }
                : {
                    icon: <Users className="h-6 w-6" />,
                    title: "Sin usuarios",
                    description:
                      "Cuando alguien acepte una invitación aparecerá aquí con sus empresas.",
                  }
            }
          />
        </Section>
      </div>
    </div>
  );
}
