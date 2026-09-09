"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";

interface Order {
  id: string;
  status: string;
  total: string;
  customer: { fullName: string };
  source: string;
  paidAt: string | null;
  createdAt: string;
}

export default function OrdersPage() {
  const q = useQuery({
    queryKey: ["orders"],
    queryFn: async () => {
      const res = await api.get<{ data: Order[] }>("/orders");
      return res.data.data;
    },
  });

  return (
    <div>
      <PageHeader
        title="Pedidos"
        description="Checkout público, dummy gateway y ledger simulado."
      />

      <div className="rounded-card border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-muted-foreground">
              <th className="p-3">ID</th>
              <th className="p-3">Cliente</th>
              <th className="p-3">Estado</th>
              <th className="p-3">Total</th>
              <th className="p-3">Origen</th>
              <th className="p-3">Pagado</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {q.data?.map((o) => (
              <tr key={o.id} className="border-b">
                <td className="p-3 font-mono text-xs">{o.id.slice(0, 8)}…</td>
                <td className="p-3">{o.customer.fullName}</td>
                <td className="p-3 uppercase text-xs">{o.status}</td>
                <td className="p-3 font-mono">${o.total}</td>
                <td className="p-3 text-muted-foreground">{o.source}</td>
                <td className="p-3 text-xs">
                  {o.paidAt ? new Date(o.paidAt).toLocaleString() : "—"}
                </td>
                <td className="p-3 text-right">
                  <Link href={`/orders/${o.id}`} className="text-sm text-primary underline">
                    Ver →
                  </Link>
                </td>
              </tr>
            ))}
            {q.data?.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted-foreground">
                  Sin pedidos.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}