"use client";
import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Copy, Link2, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { formatMoney } from "@/components/app/money";
import { ConfirmDialog } from "@/components/confirm-dialog";

interface Customer {
  id: string;
  fullName: string;
  email: string | null;
}

/**
 * Importe libre. Se manda como string decimal (el formato del cable no cambia)
 * y se valida con la misma regla que el servidor: decimal simple, sin
 * separador de miles y sin notación científica. Antes bastaba con que
 * `Number(v)` fuera finito, así que "1e3" pasaba aquí y allá se convertía en
 * 1000 sin que nadie lo hubiera escrito.
 */
const AMOUNT_RE = /^\d{1,10}(\.\d{1,6})?$/;

const schema = z.object({
  customerId: z.string(),
  description: z
    .string()
    .trim()
    .min(1, "Escribe el concepto del cobro.")
    .max(200, "Máximo 200 caracteres."),
  amount: z
    .string()
    .trim()
    .min(1, "Escribe el importe a cobrar.")
    .refine((v) => AMOUNT_RE.test(v), "Usa solo números y punto decimal (ej. 116.00), sin comas.")
    .refine((v) => Number(v) > 0, "El importe debe ser mayor que cero."),
});

type FormValues = z.infer<typeof schema>;

/**
 * Clave de idempotencia del intento de cobro. `crypto.randomUUID` solo existe
 * en contextos seguros (https o localhost); fuera de ahí se arma un UUID v4 con
 * `getRandomValues`, y si tampoco está se cae a un identificador de reloj +
 * `Math.random` — peor entropía, pero sigue siendo estable para el reintento,
 * que es lo que la idempotencia necesita.
 */
function newIdempotencyKey(): string {
  const webCrypto = typeof globalThis === "undefined" ? undefined : globalThis.crypto;
  if (typeof webCrypto?.randomUUID === "function") return webCrypto.randomUUID();
  if (typeof webCrypto?.getRandomValues === "function") {
    const bytes = webCrypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  const rand = () => Math.random().toString(36).slice(2, 10);
  return `qc-${Date.now().toString(36)}-${rand()}${rand()}`;
}

/** Identidad del intento: mismos datos = mismo cobro = misma clave. */
function attemptSignature(values: FormValues): string {
  return JSON.stringify([values.customerId, values.description, values.amount]);
}

async function copyToClipboard(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copiado al portapapeles`);
  } catch {
    toast.message(label, { description: text });
  }
}

export default function QuickChargePage() {
  const [paymentLink, setPaymentLink] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  /**
   * Clave del intento en curso. Se acuña al enviar el formulario (antes de
   * abrir la confirmación) y sobrevive a los reintentos: si el POST se pierde
   * en la red, si el usuario vuelve a darle a "Crear cobro" o si el navegador
   * repite la petición, el servidor ve la misma clave y devuelve el pedido que
   * ya creó en vez de cobrar dos veces. Se renueva cuando cambia alguno de los
   * datos del cobro y cuando el cobro anterior terminó bien (`onSuccess`), que
   * son los dos casos en que de verdad empieza un cobro nuevo. Vive en un ref y
   * no en el estado: cambiarla no debe re-renderizar nada.
   */
  const attempt = useRef<{ key: string; signature: string; values: FormValues } | null>(null);

  /**
   * Abre (o reusa) el intento para estos datos y devuelve su clave. Guarda
   * también los valores ya validados por zod — son los que se mandan, para no
   * enviar al servidor una versión sin recortar de lo que se validó.
   */
  function startAttempt(values: FormValues): string {
    const signature = attemptSignature(values);
    if (!attempt.current || attempt.current.signature !== signature) {
      attempt.current = { key: newIdempotencyKey(), signature, values };
    }
    return attempt.current.key;
  }

  const {
    register,
    handleSubmit,
    reset,
    getValues,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onSubmit",
    defaultValues: { customerId: "", description: "", amount: "" },
  });

  const customers = useQuery({
    queryKey: ["customers-for-quick-charge"],
    queryFn: async () => {
      const res = await api.get<{ data: Customer[] }>("/customers");
      return res.data.data;
    },
  });

  const charge = useMutation({
    mutationFn: async (values: FormValues) => {
      const res = await api.post("/orders/quick-charge", {
        customerId: values.customerId || undefined,
        description: values.description,
        amountTotal: values.amount,
        idempotencyKey: startAttempt(values),
      });
      return res.data.data as { checkoutToken: string | null };
    },
    onSuccess: (data) => {
      // El cobro quedó: el siguiente empieza con una clave nueva.
      attempt.current = null;
      if (data.checkoutToken) {
        const url = `${window.location.origin}/checkout/${data.checkoutToken}`;
        setPaymentLink(url);
        void copyToClipboard(url, "Link de pago");
      }
      toast.success("Cobro creado");
      reset({ customerId: getValues("customerId"), description: "", amount: "" });
    },
    // A propósito no se limpia la clave al fallar: reintentar el mismo cobro
    // tiene que reusarla, porque el fallo pudo ser solo la respuesta perdida de
    // un pedido que el servidor sí creó.
    onError: () => toast.error("No se pudo crear el cobro"),
  });

  const watched = watch();
  const selectedCustomer = customers.data?.find((c) => c.id === watched.customerId);

  return (
    <div className="mx-auto w-full max-w-lg">
      <PageHeader
        title="Cobro rápido"
        description="Cobra un importe libre sin necesidad de una cotización o productos del catálogo."
      />

      <div className="space-y-6">
        <form
          noValidate
          onSubmit={handleSubmit((values) => {
            // La clave se acuña aquí, al abrir la confirmación: es el punto en
            // que empieza el intento. Confirmar, reintentar tras un error o un
            // doble clic que pase el `disabled` reusan esta misma clave.
            startAttempt(values);
            setConfirmOpen(true);
          })}
          aria-busy={charge.isPending || undefined}
        >
          <Section
            title="Datos del cobro"
            description="El importe incluye IVA; el impuesto se calcula hacia atrás con la tasa del comercio."
            footer={
              <Button type="submit" className="w-full" loading={charge.isPending}>
                <Zap aria-hidden className="h-4 w-4" />
                {charge.isPending ? "Creando cobro…" : "Crear cobro y generar link"}
              </Button>
            }
          >
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="customer">Cliente (opcional)</Label>
                <Select
                  id="customer"
                  aria-describedby="customer-help"
                  disabled={customers.isLoading}
                  {...register("customerId")}
                >
                  <option value="">Sin cliente (mostrador)</option>
                  {customers.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.fullName}
                      {c.email ? ` (${c.email})` : ""}
                    </option>
                  ))}
                </Select>
                <p id="customer-help" className="text-xs text-muted-foreground">
                  {customers.isError
                    ? "No se pudo cargar la lista de clientes: el cobro se creará a nombre de “Cliente mostrador”."
                    : "Sin cliente el cobro se registra a nombre de “Cliente mostrador”."}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="description">Concepto</Label>
                <Input
                  id="description"
                  placeholder="Ej. Servicio de instalación"
                  maxLength={200}
                  aria-invalid={!!errors.description}
                  aria-describedby={
                    errors.description ? "description-error" : "description-help"
                  }
                  {...register("description")}
                />
                {errors.description ? (
                  <p id="description-error" className="text-xs text-destructive">
                    {errors.description.message}
                  </p>
                ) : (
                  <p id="description-help" className="text-xs text-muted-foreground">
                    Es lo que ve el cliente en la pantalla de pago. Máximo 200 caracteres.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="amount">Importe total (IVA incluido)</Label>
                <Input
                  id="amount"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="116.00"
                  className="tabular-nums"
                  aria-invalid={!!errors.amount}
                  aria-describedby={errors.amount ? "amount-error" : "amount-help"}
                  {...register("amount")}
                />
                {errors.amount ? (
                  <p id="amount-error" className="text-xs text-destructive">
                    {errors.amount.message}
                  </p>
                ) : (
                  <p id="amount-help" className="text-xs text-muted-foreground">
                    En pesos, con punto decimal y sin separador de miles.
                  </p>
                )}
              </div>
            </div>
          </Section>
        </form>

        {paymentLink && (
          <Alert variant="success">
            <Link2 aria-hidden />
            <AlertTitle>Link de pago listo</AlertTitle>
            <AlertDescription className="space-y-2">
              <a
                href={paymentLink}
                target="_blank"
                rel="noreferrer"
                className="block break-all rounded-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
              >
                {paymentLink}
              </a>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void copyToClipboard(paymentLink, "Link de pago")}
              >
                <Copy aria-hidden className="h-3.5 w-3.5" />
                Copiar link
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="¿Crear este cobro?"
        description={
          <>
            Se generará un pedido por <strong>{formatMoney(watched.amount)}</strong> a nombre de{" "}
            <strong>{selectedCustomer?.fullName ?? "Cliente mostrador"}</strong> con el concepto “
            {watched.description}”. El link de pago queda activo de inmediato.
          </>
        }
        confirmLabel="Crear cobro"
        variant="default"
        pending={charge.isPending}
        onConfirm={() => {
          const values = attempt.current?.values;
          setConfirmOpen(false);
          if (values) charge.mutate(values);
        }}
      />
    </div>
  );
}
