"use client";

import { useEffect, useState } from "react";
import {
  Building2,
  ChevronDown,
  FileSpreadsheet,
  Info,
  Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { toast } from "sonner";

/**
 * Catálogo oficial SAT (c_RegimenFiscal). Lo enumeramos completo porque la
 * lista cambia cada que el SAT publica una actualización y queremos que la
 * UI se quede útil aunque la consulta al SAT no esté disponible. La fuente
 * primaria es `ListaDeCuentas` y `CatalogosCFDI40` del SAT.
 *
 * Persona Física → 605, 606, 612, 621, 626, 628.
 * Persona Moral → 601, 603, 620, 622.
 */
const TAX_REGIMES = [
  { value: "601", label: "601 — General de Ley Personas Morales" },
  { value: "603", label: "603 — Personas Morales con Fines no Lucrativos" },
  { value: "605", label: "605 — Sueldos y Salarios e Ingresos Asimilados a Salarios" },
  { value: "606", label: "606 — Arrendamiento" },
  { value: "612", label: "612 — Personas Físicas con Actividades Empresariales y Profesionales" },
  { value: "620", label: "620 — Sociedades Cooperativas de Producción" },
  { value: "621", label: "621 — Incorporación Fiscal" },
  { value: "622", label: "622 — Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras" },
  { value: "626", label: "626 — Régimen Simplificado de Confianza (RESICO)" },
  { value: "628", label: "628 — Hidrocarburos" },
] as const;

/**
 * Catálogo SAT c_UsoCFDI — los más comunes primero. La lista completa
 * tiene más valores (I01–I08, P01, D01–D11, etc.) pero para una compra
 * típica solo aplican los de la clave G*.
 */
const CFDI_USES = [
  { value: "G01", label: "G01 — Adquisición de mercancías" },
  { value: "G02", label: "G02 — Devoluciones, descuentos o bonificaciones" },
  { value: "G03", label: "G03 — Gastos en general" },
  { value: "P01", label: "P01 — Por definir" },
  { value: "S01", label: "S01 — Sin efectos fiscales" },
] as const;

interface BillingData {
  rfc: string;
  razonSocial: string;
  regimen: string;
  cp: string;
  usoCfdi: string;
  email: string;
}

const EMPTY: BillingData = {
  rfc: "",
  razonSocial: "",
  regimen: "",
  cp: "",
  usoCfdi: "G03",
  email: "",
};

const STORAGE_KEY = "checkout.billing.draft";

function loadDraft(): BillingData {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<BillingData>) };
  } catch {
    return EMPTY;
  }
}

/** Valida el RFC con el patrón oficial: 3-4 letras + 6 dígitos + 3 alfanum. */
function validRfc(value: string): boolean {
  const v = value.trim().toUpperCase();
  return /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(v);
}

function validCp(value: string): boolean {
  return /^\d{5}$/.test(value.trim());
}

/**
 * Bloque colapsable para pedir al cliente los **datos fiscales mínimos**
 * que requiere el SAT para emitir CFDI (RFC, razón social, régimen,
 * código postal, uso CFDI y correo). La emisión real del CFDI no es
 * responsabilidad del checkout público: cuando el cliente marca la
 * casilla, los datos se guardan en `localStorage` y se muestra un
 * mensaje claro de que el vendedor los necesita para facturar.
 */
export function BillingSection() {
  const [open, setOpen] = useState(false);
  const [wants, setWants] = useState(false);
  const [data, setData] = useState<BillingData>(EMPTY);

  useEffect(() => {
    const draft = loadDraft();
    setData(draft);
    if (draft.rfc || draft.razonSocial) setOpen(true);
  }, []);

  function set<K extends keyof BillingData>(key: K, value: BillingData[K]) {
    setData((prev) => {
      const next = { ...prev, [key]: value };
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore: modo privado o cuota llena
        }
      }
      return next;
    });
  }

  function toggleWants() {
    const next = !wants;
    setWants(next);
    if (!next) {
      setData(EMPTY);
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    }
  }

  const rfcOk = data.rfc.trim() === "" || validRfc(data.rfc);
  const cpOk = data.cp.trim() === "" || validCp(data.cp);
  const emailOk = data.email.trim() === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim());
  const formValid =
    data.rfc.trim() !== "" &&
    validRfc(data.rfc) &&
    data.razonSocial.trim().length >= 2 &&
    data.regimen !== "" &&
    validCp(data.cp) &&
    data.usoCfdi !== "" &&
    emailOk;

  return (
    <section className="overflow-hidden rounded-card border bg-card shadow-airbnb">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-5 py-4 text-left hover:bg-muted/40 sm:px-6"
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
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Estos datos no generan un CFDI automático: el vendedor los usa para
            facturar después. Quedan guardados solo en tu navegador (no se
            envían a ningún servidor de pago).
          </p>

          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={wants}
              onChange={toggleWants}
              className="mt-0.5 h-4 w-4 rounded border-input accent-primary-strong"
            />
            <span>Sí, quiero que me facturen con estos datos.</span>
          </label>

          {wants ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="billing-rfc">RFC</Label>
                <Input
                  id="billing-rfc"
                  value={data.rfc}
                  onChange={(e) => set("rfc", e.target.value.toUpperCase())}
                  placeholder="XAXX010101000"
                  inputMode="text"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={!rfcOk}
                  aria-describedby={!rfcOk ? "billing-rfc-error" : "billing-rfc-hint"}
                  className="font-mono text-xs uppercase"
                  maxLength={13}
                />
                {!rfcOk ? (
                  <p id="billing-rfc-error" className="text-xs text-destructive">
                    Formato RFC inválido (3-4 letras, 6 dígitos, 3 alfanuméricos).
                  </p>
                ) : (
                  <p id="billing-rfc-hint" className="text-xs text-muted-foreground">
                    Persona moral (12) o física (13).
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="billing-razon">Razón social</Label>
                <Input
                  id="billing-razon"
                  value={data.razonSocial}
                  onChange={(e) => set("razonSocial", e.target.value)}
                  placeholder="Empresa S.A. de C.V."
                  autoComplete="off"
                  maxLength={200}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="billing-regimen">Régimen fiscal</Label>
                <Select
                  id="billing-regimen"
                  value={data.regimen}
                  onChange={(e) => set("regimen", e.target.value)}
                >
                  <option value="">Selecciona…</option>
                  {TAX_REGIMES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="billing-cp">Código postal fiscal</Label>
                <Input
                  id="billing-cp"
                  value={data.cp}
                  onChange={(e) => set("cp", e.target.value.replace(/\D/g, "").slice(0, 5))}
                  placeholder="64000"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  aria-invalid={!cpOk}
                  aria-describedby={!cpOk ? "billing-cp-error" : undefined}
                  className="tabular-nums"
                  maxLength={5}
                />
                {!cpOk ? (
                  <p id="billing-cp-error" className="text-xs text-destructive">
                    5 dígitos.
                  </p>
                ) : null}
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="billing-uso">Uso del CFDI</Label>
                <Select
                  id="billing-uso"
                  value={data.usoCfdi}
                  onChange={(e) => set("usoCfdi", e.target.value)}
                >
                  {CFDI_USES.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="billing-email">Correo para enviar el CFDI</Label>
                <Input
                  id="billing-email"
                  type="email"
                  inputMode="email"
                  value={data.email}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="[email protected]"
                  autoComplete="email"
                  aria-invalid={!emailOk}
                  aria-describedby={!emailOk ? "billing-email-error" : undefined}
                />
                {!emailOk ? (
                  <p id="billing-email-error" className="text-xs text-destructive">
                    Correo inválido.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {wants && !formValid ? (
            <p className="flex items-center gap-2 text-xs text-warning-foreground">
              <Info aria-hidden className="h-3.5 w-3.5" />
              Completa RFC, razón social, régimen, código postal y correo para
              poder facturar.
            </p>
          ) : null}

          {wants && formValid ? (
            <p className="flex items-center gap-2 text-xs text-success-foreground">
              <Building2 aria-hidden className="h-3.5 w-3.5" />
              Listo: el vendedor verá estos datos cuando le escribas para
              facturar.
            </p>
          ) : null}

          <div className="flex items-center justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                toast.message(
                  "Datos guardados en este navegador",
                  {
                    description:
                      "Cuando el vendedor te pida facturar, abre este mismo enlace y vuelve a pegar los datos, o mándale el resumen por correo.",
                    icon: <Mail aria-hidden className="h-4 w-4" />,
                  },
                )
              }
              disabled={!formValid}
            >
              <Mail aria-hidden className="h-3.5 w-3.5" />
              Listo, datos guardados
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}