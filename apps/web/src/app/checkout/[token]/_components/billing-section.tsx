"use client";

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronDown,
  FileSpreadsheet,
  Loader2,
  Pencil,
  ShieldAlert,
  UploadCloud,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";

/**
 * Catálogo SAT c_UsoCFDI — los más comunes primero. La constancia de
 * situación fiscal NO trae esto (es el propósito del CFDI, lo elige quien
 * factura en cada compra), así que sigue siendo el único campo manual.
 */
const CFDI_USES = [
  { value: "G01", label: "G01 — Adquisición de mercancías" },
  { value: "G02", label: "G02 — Devoluciones, descuentos o bonificaciones" },
  { value: "G03", label: "G03 — Gastos en general" },
  { value: "P01", label: "P01 — Por definir" },
  { value: "S01", label: "S01 — Sin efectos fiscales" },
] as const;

interface InvoiceResult {
  invoiceRfc: string | null;
  invoiceLegalName: string | null;
  invoicePostalCode: string | null;
  invoiceRegimenFiscal: string | null;
  invoiceCfdiUse: string | null;
  parseWarnings?: string[];
}

interface Overrides {
  rfc?: string;
  legalName?: string;
  postalCode?: string;
  regimenFiscal?: string;
}

async function uploadConstancia(
  token: string,
  file: File | null,
  cfdiUse: string,
  overrides: Overrides,
): Promise<InvoiceResult> {
  const form = new FormData();
  if (file) form.append("file", file);
  form.append("cfdiUse", cfdiUse);
  if (overrides.rfc) form.append("rfc", overrides.rfc);
  if (overrides.legalName) form.append("legalName", overrides.legalName);
  if (overrides.postalCode) form.append("postalCode", overrides.postalCode);
  if (overrides.regimenFiscal) form.append("regimenFiscal", overrides.regimenFiscal);

  const res = await fetch(`/api/v1/orders/public/${token}/invoice`, {
    method: "POST",
    credentials: "omit",
    body: form,
  });
  const json = (await res.json().catch(() => null)) as
    | { data?: InvoiceResult; message?: string; error?: { message?: string } }
    | null;
  if (!res.ok || !json?.data) {
    throw new Error(json?.error?.message ?? json?.message ?? "No se pudo procesar la constancia.");
  }
  return json.data;
}

/**
 * Facturación desde el checkout público: subir la constancia de situación
 * fiscal (PDF del SAT) BASTA — RFC, razón social, código postal y régimen
 * se leen de ahí (`orders/constancia-parser.ts`, servidor). Solo "uso de
 * CFDI" lo sigue eligiendo el cliente, porque el documento no lo trae.
 *
 * Captura manual sigue disponible como respaldo (constancia ilegible, PDF a
 * la mano en otro momento) detrás de "Prefiero capturarlo a mano".
 */
export function BillingSection({ token }: { token: string }) {
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [cfdiUse, setCfdiUse] = useState<string>("G03");
  const [overrides, setOverrides] = useState<Overrides>({});
  const [result, setResult] = useState<InvoiceResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const submit = useMutation({
    mutationFn: () => uploadConstancia(token, file, cfdiUse, overrides),
    onSuccess: (data) => setResult(data),
  });

  function pickFile() {
    fileInputRef.current?.click();
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    setResult(null);
    if (picked && picked.type !== "application/pdf") {
      submit.reset();
      setFile(null);
      return;
    }
    setFile(picked);
  }

  const warnings = result?.parseWarnings?.filter(Boolean) ?? [];
  const done = Boolean(result);

  return (
    <section className="overflow-hidden rounded-card border bg-card shadow-airbnb">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-5 py-4 text-left hover:bg-accent sm:px-6"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <FileSpreadsheet aria-hidden className="h-4 w-4 text-muted-foreground" />
          ¿Necesitas factura?
        </span>
        <ChevronDown
          aria-hidden
          className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <div className="space-y-4 border-t px-5 py-4 sm:px-6">
          {done ? (
            <Alert variant="success">
              <CheckCircle2 aria-hidden />
              <AlertDescription className="space-y-1">
                <p className="font-medium">Listo, tus datos fiscales quedaron guardados.</p>
                <p>
                  {result?.invoiceLegalName} · RFC {result?.invoiceRfc} · CP{" "}
                  {result?.invoicePostalCode}
                  {result?.invoiceRegimenFiscal ? ` · Régimen ${result.invoiceRegimenFiscal}` : ""}
                </p>
                <p className="text-xs">El vendedor emite tu factura con estos datos.</p>
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Sube tu <strong className="text-foreground">constancia de situación fiscal</strong>{" "}
                (PDF del SAT) y listo: RFC, razón social, código postal y régimen se leen de ahí. No
                tienes que dictarlos.
              </p>

              {!manual ? (
                <div className="space-y-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf"
                    className="sr-only"
                    onChange={onFileChange}
                  />
                  <button
                    type="button"
                    onClick={pickFile}
                    className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-input px-4 py-6 text-center transition-colors hover:border-primary hover:bg-accent"
                  >
                    <UploadCloud aria-hidden className="h-6 w-6 text-muted-foreground" />
                    <span className="text-sm font-medium">
                      {file ? file.name : "Sube tu constancia (PDF)"}
                    </span>
                    <span className="text-xs text-muted-foreground">Máximo 8 MB</span>
                  </button>

                  <div className="space-y-1.5">
                    <Label htmlFor="billing-uso">Uso del CFDI</Label>
                    <Select id="billing-uso" value={cfdiUse} onChange={(e) => setCfdiUse(e.target.value)}>
                      {CFDI_USES.map((u) => (
                        <option key={u.value} value={u.value}>
                          {u.label}
                        </option>
                      ))}
                    </Select>
                  </div>

                  {submit.isError ? (
                    <Alert variant="destructive">
                      <ShieldAlert aria-hidden />
                      <AlertDescription>{(submit.error as Error).message}</AlertDescription>
                    </Alert>
                  ) : null}

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setManual(true)}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      <Pencil aria-hidden className="h-3 w-3" />
                      Prefiero capturarlo a mano
                    </button>
                    <Button
                      type="button"
                      size="sm"
                      loading={submit.isPending}
                      disabled={!file}
                      onClick={() => submit.mutate()}
                    >
                      {submit.isPending ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : null}
                      Subir y facturar
                    </Button>
                  </div>
                </div>
              ) : (
                <ManualInvoiceForm
                  cfdiUse={cfdiUse}
                  setCfdiUse={setCfdiUse}
                  overrides={overrides}
                  setOverrides={setOverrides}
                  onBack={() => setManual(false)}
                  submitting={submit.isPending}
                  error={submit.isError ? (submit.error as Error).message : null}
                  onSubmit={() => {
                    setFile(null);
                    submit.mutate();
                  }}
                />
              )}

              {warnings.length > 0 ? (
                <Alert variant="warning">
                  <ShieldAlert aria-hidden />
                  <AlertDescription>
                    La constancia no trajo todo: {warnings.join("; ")}. Revisa los datos.
                  </AlertDescription>
                </Alert>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

function ManualInvoiceForm({
  cfdiUse,
  setCfdiUse,
  overrides,
  setOverrides,
  onBack,
  onSubmit,
  submitting,
  error,
}: {
  cfdiUse: string;
  setCfdiUse: (v: string) => void;
  overrides: Overrides;
  setOverrides: (v: Overrides) => void;
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
}) {
  const rfcOk = !overrides.rfc || /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(overrides.rfc);
  const cpOk = !overrides.postalCode || /^\d{5}$/.test(overrides.postalCode);
  const formValid =
    !!overrides.rfc?.trim() &&
    rfcOk &&
    (overrides.legalName?.trim().length ?? 0) >= 2 &&
    !!overrides.postalCode &&
    cpOk;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="billing-rfc">RFC</Label>
          <Input
            id="billing-rfc"
            value={overrides.rfc ?? ""}
            onChange={(e) => setOverrides({ ...overrides, rfc: e.target.value.toUpperCase() })}
            placeholder="Ej. XAXX010101000"
            aria-invalid={!rfcOk}
            className="font-mono text-xs uppercase"
            maxLength={13}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="billing-razon">Razón social</Label>
          <Input
            id="billing-razon"
            value={overrides.legalName ?? ""}
            onChange={(e) => setOverrides({ ...overrides, legalName: e.target.value })}
            placeholder="Ej. Comercializadora del Norte, S.A. de C.V."
            maxLength={200}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="billing-cp">Código postal fiscal</Label>
          <Input
            id="billing-cp"
            value={overrides.postalCode ?? ""}
            onChange={(e) =>
              setOverrides({ ...overrides, postalCode: e.target.value.replace(/\D/g, "").slice(0, 5) })
            }
            placeholder="Ej. 64000"
            inputMode="numeric"
            aria-invalid={!cpOk}
            className="tabular-nums"
            maxLength={5}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="billing-regimen">Régimen fiscal (clave, opcional)</Label>
          <Input
            id="billing-regimen"
            value={overrides.regimenFiscal ?? ""}
            onChange={(e) =>
              setOverrides({ ...overrides, regimenFiscal: e.target.value.replace(/\D/g, "").slice(0, 3) })
            }
            placeholder="Ej. 626"
            inputMode="numeric"
            className="tabular-nums"
            maxLength={3}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="billing-uso-manual">Uso del CFDI</Label>
          <Select id="billing-uso-manual" value={cfdiUse} onChange={(e) => setCfdiUse(e.target.value)}>
            {CFDI_USES.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <ShieldAlert aria-hidden />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          <UploadCloud aria-hidden className="h-3 w-3" />
          Mejor subo la constancia
        </button>
        <Button type="button" size="sm" loading={submitting} disabled={!formValid} onClick={onSubmit}>
          Guardar datos fiscales
        </Button>
      </div>
    </div>
  );
}
