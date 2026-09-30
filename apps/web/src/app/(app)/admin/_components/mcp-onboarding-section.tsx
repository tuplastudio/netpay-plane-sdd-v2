"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, KeyRound, Sparkles, Terminal } from "lucide-react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Section } from "@/components/app/section";
import { Tip } from "@/components/app/info-tip";
import { apiErrorMessage } from "./api-error";
import { apiKeysQueryKey } from "./api-keys-section";

/**
 * Scopes recomendados para un agente MCP genérico (Claude u otro): lo
 * esencial del flujo comercial en lectura/escritura, sin lo de más alto
 * riesgo (reembolsos, exportar pagos, integraciones, auditoría, o cualquier
 * cosa de administración de la empresa). Quien necesite más lo ajusta a mano
 * en "API keys" (abajo) — esto es el default seguro, no el único posible.
 *
 * Lo que este set NO incluye y por qué:
 * - payments.refund / payments.write: reembolsos son irreversibles; el agente
 *   puede leer pagos para contexto pero no debería cobrarse/devolver solo.
 * - integrations.write: publica eventos firmados a endpoints externos con un
 *   secreto en el body. Una key filtrada podría drenar datos.
 * - apikeys.manage / users.invite / users.manage / tenant.admin: control
 *   sobre la cuenta misma (crear/revocar keys, invitar gente, cambiar
 *   parámetros del tenant). El botón rápido no la entrega.
 * - audit.read: el log de auditoría suele tener info sensible y no aporta
 *   nada al flujo del agente.
 *
 * Quien SABE que necesita alguno de estos lo pide creando una key aparte
 * desde "API keys" abajo — pero el camino por defecto es seguro.
 */
const RECOMMENDED_SCOPES = [
  "catalog.read",
  "customers.read",
  "customers.write",
  "quotes.read",
  "quotes.write",
  "orders.read",
  "orders.write",
  "orders.cancel_own",
  "payments.read",
  "chat.read",
  "chat.write",
  "notifications.read",
];

/**
 * Nombre del paquete en npm. El paquete está bajo el scope del publicador
 * (`@cgalaviz/easysell-mcp`); el bin name (`easysell-mcp`) es lo que
 * `npx` resuelve al instalar, pero `npx <bin>` no es portable — siempre
 * usamos el nombre completo del paquete para que el comando funcione igual
 * en cualquier máquina, incluso si alguien tiene un bin local con el mismo
 * nombre en su PATH.
 */
const PACKAGE_NAME = "@cgalaviz/easysell-mcp";

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copiado`);
  } catch {
    toast.message(label, { description: text });
  }
}

function CodeBlock({ code, copyLabel }: { code: string; copyLabel: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-md border bg-muted p-3 pr-10 text-xs">
        <code>{code}</code>
      </pre>
      <Tip label="Copiar">
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-1.5 top-1.5 h-7 w-7"
          aria-label={`Copiar ${copyLabel}`}
          onClick={() => void copy(code, copyLabel)}
        >
          <Copy aria-hidden className="h-3.5 w-3.5" />
        </Button>
      </Tip>
    </div>
  );
}

/**
 * Onboarding guiado: un botón crea la API key con los scopes recomendados y,
 * en el mismo paso, muestra el comando/config ya armado con el secreto real —
 * el secreto solo se ve una vez, así que este es el único momento en que
 * copiar-pegar el snippet completo tiene sentido.
 */
export function McpOnboardingSection() {
  const [secret, setSecret] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const create = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ data: { secret: string } }>("/iam/api-keys", {
        name: "MCP",
        scopes: RECOMMENDED_SCOPES,
      });
      return res.data.data;
    },
    onSuccess: async (data) => {
      setSecret(data.secret);
      await queryClient.invalidateQueries({ queryKey: apiKeysQueryKey("/iam/api-keys") });
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo crear la API key")),
  });

  const claudeCodeCmd = secret
    ? `claude mcp add easysell \\\n  --env COMMERCE_API_KEY=${secret} \\\n  -- npx ${PACKAGE_NAME}`
    : "";

  const desktopJson = secret
    ? JSON.stringify(
        {
          mcpServers: {
            easysell: {
              command: "npx",
              args: [PACKAGE_NAME],
              env: { COMMERCE_API_KEY: secret },
            },
          },
        },
        null,
        2,
      )
    : "";

  const genericEnv = secret ? `COMMERCE_API_KEY=${secret}\nnpx ${PACKAGE_NAME}` : "";

  return (
    <Section
      title="Conectar por MCP"
      headerIcon={<Sparkles className="h-4 w-4" />}
      description="Da acceso a Claude (o a cualquier agente compatible con MCP) a tu catálogo, cotizaciones, pedidos y conversaciones."
    >
      {!secret ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Crea una API key con permisos recomendados para un agente de propósito general: lectura y
            escritura del flujo comercial (catálogo, clientes, cotizaciones, pedidos, chat), sin permisos de
            alto riesgo (reembolsos, integraciones, administración de la empresa).
          </p>
          <div className="flex flex-wrap gap-1.5">
            {RECOMMENDED_SCOPES.map((s) => (
              <Badge key={s} variant="neutral" size="sm" className="font-mono font-medium">
                {s}
              </Badge>
            ))}
          </div>
          <Button loading={create.isPending} onClick={() => create.mutate()}>
            <KeyRound aria-hidden className="h-3.5 w-3.5" />
            {create.isPending ? "Creando…" : "Generar API key y conectar"}
          </Button>
          <p className="text-xs text-muted-foreground">
            ¿Necesitas otros permisos (reembolsos, integraciones, etc.)? Crea la key a mano en{" "}
            <span className="font-medium text-foreground">API keys</span> (abajo) y úsala igual en el
            comando de instalación.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <Alert variant="warning">
            <KeyRound aria-hidden />
            <AlertTitle>Copia el secreto de aquí abajo: no se vuelve a mostrar</AlertTitle>
            <AlertDescription>
              Ya viene incluido en los comandos de instalación de abajo — no hace falta copiarlo aparte,
              solo asegúrate de completar la instalación antes de cerrar esta pantalla.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <p className="text-sm font-medium">1. Instala Node.js 18 o más nuevo (si no lo tienes ya).</p>
            <p className="text-sm font-medium">2. Configura tu cliente MCP:</p>
          </div>

          <Tabs defaultValue="claude-code">
            <TabsList>
              <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
              <TabsTrigger value="claude-desktop">Claude Desktop</TabsTrigger>
              <TabsTrigger value="otro">Otro agente</TabsTrigger>
            </TabsList>
            <TabsContent value="claude-code" className="space-y-2">
              <p className="text-xs text-muted-foreground">Corre esto en tu terminal:</p>
              <CodeBlock code={claudeCodeCmd} copyLabel="Comando de Claude Code" />
            </TabsContent>
            <TabsContent value="claude-desktop" className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Menú Claude → Settings → Developer → Edit Config, y agrega esto:
              </p>
              <CodeBlock code={desktopJson} copyLabel="Configuración de Claude Desktop" />
            </TabsContent>
            <TabsContent value="otro" className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Cualquier cliente que hable MCP por stdio: arranca el proceso con esta variable de entorno.
              </p>
              <CodeBlock code={genericEnv} copyLabel="Variables de entorno" />
            </TabsContent>
          </Tabs>

          <p className="text-sm text-muted-foreground">
            <Terminal aria-hidden className="mr-1 inline h-3.5 w-3.5 align-text-bottom" />
            Al conectarse, tu agente va a poder ver y usar el catálogo, clientes, cotizaciones, pedidos,
            pagos (solo lectura) y conversaciones de esta empresa. Son ~140 herramientas listadas bajo
            el servidor MCP, y el agente las descubre por sí solo: no tenés que memorizar ninguna.
          </p>
          <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
            <p>
              <span className="font-medium text-foreground">Qué hace el agente con esta key:</span> leer
              tu catálogo y buscar por nombre/SKU, crear y editar productos y variantes, gestionar
              clientes (crear, archivar, agregar direcciones), cotizar y emitir cotizaciones, abrir
              pedidos y cobrar con link de pago, responder WhatsApp en nombre de tu tienda.
            </p>
            <p>
              <span className="font-medium text-foreground">Qué NO puede hacer (a propósito):</span>
              reembolsos, publicar eventos a integraciones externas, invitar usuarios, cambiar
              parámetros de la empresa, crear o revocar otras API keys. Para cualquiera de esas cosas,
              creá una key dedicada desde &ldquo;API keys&rdquo; abajo.
            </p>
          </div>

          <Button variant="outline" size="sm" onClick={() => setSecret(null)}>
            Ya la instalé
          </Button>
        </div>
      )}
    </Section>
  );
}
