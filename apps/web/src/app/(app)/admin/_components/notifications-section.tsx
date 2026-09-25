"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BellRing, Download } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { StatusBadge, statusLabel } from "@/components/ui/status-badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Section } from "@/components/app/section";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { DateTime } from "@/components/app/date-time";
import { DescriptionList, FieldRow } from "@/components/app/field-row";

/** `GET /notifications` (apps/commerce-api/src/notifications/notification.controller.ts). */
interface Notification {
  id: string;
  channel: string;
  status: string;
  templateKey: string;
  attempts: number;
  scheduledAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  /** Motivo del último fallo o de la cancelación por política. */
  lastError: string | null;
}

const columns: Array<DataTableColumn<Notification>> = [
  {
    key: "channel",
    header: "Canal",
    width: "7rem",
    cell: (n) => statusLabel(n.channel, "notification"),
  },
  {
    key: "template",
    header: "Plantilla",
    className: "font-mono text-xs",
    cell: (n) => n.templateKey,
  },
  {
    key: "status",
    header: "Estado",
    width: "8rem",
    cell: (n) => <StatusBadge status={n.status} domain="notification" />,
  },
  {
    key: "attempts",
    header: "Intentos",
    numeric: true,
    width: "6rem",
    cell: (n) => n.attempts,
  },
  {
    key: "scheduledAt",
    header: "Programada",
    width: "11rem",
    cell: (n) => <DateTime value={n.scheduledAt} className="text-muted-foreground" />,
  },
  {
    key: "sentAt",
    header: "Enviada",
    width: "11rem",
    cell: (n) => <DateTime value={n.sentAt} className="text-muted-foreground" />,
  },
  {
    key: "deliveredAt",
    header: "Entregada",
    width: "11rem",
    cell: (n) => <DateTime value={n.deliveredAt} className="text-muted-foreground" />,
  },
];

export function NotificationsSection() {
  const [selected, setSelected] = useState<Notification | null>(null);
  const notifications = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => {
      const res = await api.get<{ data: Notification[] }>("/notifications");
      return res.data.data;
    },
  });

  return (
    <Section
      title="Notificaciones"
      headerIcon={<BellRing className="h-4 w-4" />}
      description="Cola de envíos del tenant y su resultado."
      padded={false}
      actions={
        <Button asChild variant="outline" size="sm">
          <a href="/api/v1/notifications/export.csv" download>
            <Download className="h-4 w-4" />
            Exportar CSV
          </a>
        </Button>
      }
    >
      <DataTable
        columns={columns}
        rows={notifications.data}
        isLoading={notifications.isLoading}
        isError={notifications.isError}
        error={notifications.error}
        onRetry={() => void notifications.refetch()}
        onRowClick={(n) => setSelected(n)}
        getRowActionLabel={(n) => `Ver detalle de ${n.templateKey}`}
        caption="Notificaciones programadas y enviadas"
        empty={{
          icon: <BellRing className="h-6 w-6" />,
          title: "Sin notificaciones",
          description:
            "Aquí aparecerán los correos y mensajes que dispare el sistema: cotizaciones emitidas, pagos confirmados y recordatorios.",
        }}
      />

      <NotificationDetailSheet
        notification={selected}
        open={selected !== null}
        onOpenChange={(o) => !o && setSelected(null)}
      />
    </Section>
  );
}

function NotificationDetailSheet({
  notification,
  open,
  onOpenChange,
}: {
  notification: Notification | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        title="Detalle de notificación"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        {notification ? (
          <>
            <SheetHeader className="border-b px-6 py-4">
              <SheetTitle className="font-mono text-sm">{notification.templateKey}</SheetTitle>
              <SheetDescription>
                <span className="font-mono text-xs">{notification.id.slice(0, 8)}…</span>
                {" · "}
                <StatusBadge status={notification.status} domain="notification" withDot />
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto p-6">
              <DescriptionList divided>
                <FieldRow label="Canal">
                  {statusLabel(notification.channel, "notification")}
                </FieldRow>
                <FieldRow label="Estado">
                  <StatusBadge status={notification.status} domain="notification" />
                </FieldRow>
                <FieldRow label="Intentos" numeric>
                  {notification.attempts}
                </FieldRow>
                <FieldRow label="Programada">
                  <DateTime value={notification.scheduledAt} />
                </FieldRow>
                <FieldRow label="Enviada">
                  <DateTime value={notification.sentAt} />
                </FieldRow>
                <FieldRow label="Entregada">
                  <DateTime value={notification.deliveredAt} />
                </FieldRow>
                <FieldRow label="Plantilla" mono>
                  {notification.templateKey}
                </FieldRow>
                <FieldRow label="ID" mono>
                  {notification.id}
                </FieldRow>
                {notification.lastError ? (
                  <FieldRow label="Motivo">{notification.lastError}</FieldRow>
                ) : null}
              </DescriptionList>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}