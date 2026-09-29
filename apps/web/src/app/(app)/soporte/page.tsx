"use client";

import Link from "next/link";
import {
  AlertCircle,
  CircleHelp,
  ExternalLink,
  Phone,
  ShieldCheck,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";

/**
 * Página de ayuda y contacto. Es estática a propósito: no hay tickets ni
 * chat de soporte desde el portal todavía. Para dudas operativas del portal
 * se enlaza al agente de la empresa; para incidencias de plataforma, un
 * mailto con la info de diagnóstico ya rellenada.
 */
export default function SoportePage() {
  const mailto =
    "mailto:hola@tupla.dev" +
    "?subject=" +
    encodeURIComponent("Soporte Easy Sell") +
    "&body=" +
    encodeURIComponent(
      "Equipo de soporte,\n\n" +
        "Necesito ayuda con:\n" +
        "[describe el problema]\n\n" +
        "Pasos para reproducirlo:\n" +
        "1. \n2. \n3. \n\n" +
        "Resultado esperado:\n\n" +
        "Resultado actual:\n\n" +
        "Información del entorno:\n" +
        "- Navegador y versión:\n" +
        "- URL:\n" +
        "- Empresa (slug):\n",
    );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Soporte"
        description="Cómo pedir ayuda con el portal o con el agente de tu empresa."
        backHref="/"
        breadcrumbs={[{ label: "Soporte" }]}
      />

      <Section
        title="Antes de escribirnos"
        description="El 80% de las dudas más comunes tienen respuesta en estas secciones."
      >
        <ul className="space-y-3 text-sm">
          <li className="flex items-start gap-2">
            <CircleHelp aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <strong className="font-semibold">El agente responde del catálogo, no de soporte.</strong>{" "}
              <span className="text-muted-foreground">
                Para temas del portal (catálogo, pedidos, cobros, pagos), prueba el{" "}
                <Link className="text-primary underline-offset-2 hover:underline" href="/chat">
                  chat con el agente
                </Link>
                . Para fallos de la plataforma, sigue leyendo.
              </span>
            </div>
          </li>
          <li className="flex items-start gap-2">
            <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <strong className="font-semibold">No mandes contraseñas ni API keys por correo.</strong>{" "}
              <span className="text-muted-foreground">
                Si alguien te las pide por email, no somos nosotros. Cámbialas y revisa el{" "}
                <Link className="text-primary underline-offset-2 hover:underline" href="/admin?tab=seguridad">
                  panel de seguridad
                </Link>
                .
              </span>
            </div>
          </li>
          <li className="flex items-start gap-2">
            <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <strong className="font-semibold">Si un pago no se refleja,</strong>{" "}
              <span className="text-muted-foreground">
                entra a <Link className="text-primary underline-offset-2 hover:underline" href="/orders">Pedidos</Link>{" "}
                y abre el pedido. Ahí ves el estado real y la sesión de checkout que lo sostiene.
              </span>
            </div>
          </li>
        </ul>
      </Section>

      <Section title="Escríbenos" description="Te respondemos en horario laboral (GMT-6).">
        <Alert>
          <Phone aria-hidden />
          <AlertTitle>Por correo</AlertTitle>
          <AlertDescription>
            <p>
              Mándanos un email a{" "}
              <a className="font-mono text-primary underline-offset-2 hover:underline" href={mailto}>
                hola@tupla.dev
              </a>{" "}
              con la mayor cantidad de detalle posible (qué pasó, qué esperabas, en qué URL).
              Adjuntar una captura ayuda mucho.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              (Al hacer clic se abre tu cliente de correo con un formulario pre-llenado.)
            </p>
          </AlertDescription>
        </Alert>
      </Section>

      <Section title="Diagnóstico rápido" description="Lo que nos ayuda si lo pegas en el primer correo.">
        <ul className="space-y-1.5 text-sm text-muted-foreground">
          <li>URL exacta donde pasa.</li>
          <li>Navegador y versión (Chrome 121, Safari 17, etc.).</li>
          <li>Slug de tu empresa (lo ves en el menú superior).</li>
          <li>Hora y zona horaria.</li>
          <li>Pasos para reproducir el problema.</li>
        </ul>
      </Section>

      <Section title="Quiénes somos" padded={false}>
        <div className="p-4 text-sm text-muted-foreground sm:p-6">
          <p>
            Easy Sell es un producto de{" "}
            <a
              href="https://tupla.dev"
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
            >
              Tupla
              <ExternalLink aria-hidden className="h-3 w-3" />
            </a>
            . Incidencias de plataforma y solicitudes comerciales: el mismo correo,{" "}
            <a className="font-mono text-primary underline-offset-2 hover:underline" href={mailto}>
              hola@tupla.dev
            </a>
            .
          </p>
        </div>
      </Section>
    </div>
  );
}