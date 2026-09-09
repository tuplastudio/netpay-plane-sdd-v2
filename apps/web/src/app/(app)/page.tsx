"use client";

import Link from "next/link";
import {
  ArrowRight,
  Package,
  FileText,
  ShoppingCart,
  Users,
  MessageSquare,
  Bot,
  Settings,
  Sparkles,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page-header";

export default function HomePage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Bienvenido a NetPay Plane"
        description="Catálogo, cotizaciones, pedidos y pagos dummy — con un agente conversacional integrado."
        actions={
          <Button asChild>
            <Link href="/chat">
              <MessageSquare className="h-4 w-4" />
              Probar el agente
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Shortcut
          href="/catalog"
          title="Catálogo"
          desc="Productos, variantes y claves SAT."
          icon={Package}
        />
        <Shortcut
          href="/quotes"
          title="Cotizaciones"
          desc="Borrador, revisión y links públicos."
          icon={FileText}
        />
        <Shortcut
          href="/orders"
          title="Pedidos"
          desc="Checkout y dummy gateway."
          icon={ShoppingCart}
        />
        <Shortcut
          href="/customers"
          title="Clientes"
          desc="Contactos e identidad."
          icon={Users}
        />
        <Shortcut
          href="/chat"
          title="Chat con el agente"
          desc="Cotiza y resuelve por chat."
          icon={MessageSquare}
        />
        <Shortcut
          href="/agent"
          title="Consola del agente"
          desc="Conocimiento, modelo y herramientas."
          icon={Bot}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" />
              Cómo funciona
            </CardTitle>
            <CardDescription>
              El portal es la consola de tu tienda. El agente habla con tus clientes, cotiza
              contra el backend y manda el enlace de pago.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
            <Step
              num="1"
              title="Carga tu catálogo"
              desc="Productos, variantes, stock y claves SAT."
            />
            <Step
              num="2"
              title="Conecta canales"
              desc="Web, WhatsApp Meta o Evolution/Baileys."
            />
            <Step
              num="3"
              title="Cobra en dummy"
              desc="El agente emite cotización y el dummy gateway simula el pago."
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Estado del sistema
            </CardTitle>
            <CardDescription>Variables operativas del entorno actual.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row k="PAYMENT_PROVIDER" v="DUMMY" />
            <Row k="livemode" v="false" badge="muted" />
            <Row k="MULTI-TENANT" v="aislado en SQL / cache / storage" />
            <Row k="MFA" v="requerido para owners" />
            <Row k="IDEMPOTENCY" v="obligatoria en mutaciones" />
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="text-base">¿Necesitas ajustar algo?</CardTitle>
            <CardDescription>
              Toda la configuración vive en el panel admin. Las reglas de negocio se editan
              en los Markdown de <code className="font-mono text-xs">apps/agent-service/knowledge</code>.
            </CardDescription>
          </div>
          <Zap className="hidden h-5 w-5 text-muted-foreground sm:inline-block" />
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/admin">
              <Settings className="h-4 w-4" />
              Admin
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/agent">Consola del agente</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/catalog">Ver catálogo</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Shortcut({
  href,
  title,
  desc,
  icon: Icon,
}: {
  href: string;
  title: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Link
      href={href}
      className="group rounded-card border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:bg-accent/40"
    >
      <div className="flex items-center justify-between">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
      <h3 className="mt-3 font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
    </Link>
  );
}

function Step({ num, title, desc }: { num: string; title: string; desc: string }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <span className="text-xs font-semibold text-primary">Paso {num}</span>
      <p className="mt-1 font-medium">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
    </div>
  );
}

function Row({
  k,
  v,
  badge,
}: {
  k: string;
  v: string;
  badge?: "muted" | "success" | "warning" | "destructive";
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="font-mono text-xs uppercase text-muted-foreground">{k}</span>
      {badge ? (
        <Badge variant={badge}>{v}</Badge>
      ) : (
        <span className="truncate text-right">{v}</span>
      )}
    </div>
  );
}
