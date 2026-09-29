"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { FileText, FileUp, Pencil, Save } from "lucide-react";
import { api } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DescriptionList, FieldRow } from "@/components/app/field-row";
import { Section } from "@/components/app/section";
import { apiErrorMessage } from "@/app/(app)/admin/_components/api-error";
import { FIELD_HELP, FieldHelp } from "./field-help";
import {
  CFDI_USES,
  REGIMENES_FISCALES,
  RFC_RE,
  cfdiUseLabel,
  regimenLabel,
  type CustomerDetail,
} from "./customer-types";

const schema = z.object({
  taxId: z
    .string()
    .trim()
    .toUpperCase()
    .regex(RFC_RE, "RFC inválido: 12 o 13 caracteres, ej. XAXX010101000")
    .optional()
    .or(z.literal("")),
  legalName: z.string().trim().max(300, "Máximo 300 caracteres").optional().or(z.literal("")),
  fiscalPostalCode: z
    .string()
    .trim()
    .regex(/^\d{5}$/, "El código postal fiscal son 5 dígitos")
    .optional()
    .or(z.literal("")),
  fiscalRegimenFiscal: z.string().optional().or(z.literal("")),
  fiscalCfdiUse: z.string().optional().or(z.literal("")),
});

type FormValues = z.infer<typeof schema>;

interface ConstanciaResult {
  customer: CustomerDetail;
  parsed: {
    rfc: string | null;
    legalName: string | null;
    postalCode: string | null;
    regimenFiscal: string | null;
  };
  warnings: string[];
}

function LabelWithHelp({ htmlFor, text, help }: { htmlFor: string; text: string; help: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Label htmlFor={htmlFor}>{text}</Label>
      <FieldHelp text={help} />
    </span>
  );
}

/**
 * Datos fiscales del cliente (RFC, razón social, CP fiscal, régimen y uso de
 * CFDI) con dos caminos para llenarlos: subir la constancia de situación
 * fiscal (el backend la lee y completa todo menos el uso de CFDI) o captura
 * manual con validación. Los pedidos guardan su propio snapshot fiscal; esto
 * es el "último conocido" que precarga la siguiente factura.
 */
export function CustomerFiscal({ customer, canWrite }: { customer: CustomerDetail; canWrite: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploadCfdiUse, setUploadCfdiUse] = useState(customer.fiscalCfdiUse ?? "");

  const complete = !!(customer.taxId && customer.legalName && customer.fiscalPostalCode && customer.fiscalRegimenFiscal);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      taxId: customer.taxId ?? "",
      legalName: customer.legalName ?? "",
      fiscalPostalCode: customer.fiscalPostalCode ?? "",
      fiscalRegimenFiscal: customer.fiscalRegimenFiscal ?? "",
      fiscalCfdiUse: customer.fiscalCfdiUse ?? "",
    },
  });

  useEffect(() => {
    reset({
      taxId: customer.taxId ?? "",
      legalName: customer.legalName ?? "",
      fiscalPostalCode: customer.fiscalPostalCode ?? "",
      fiscalRegimenFiscal: customer.fiscalRegimenFiscal ?? "",
      fiscalCfdiUse: customer.fiscalCfdiUse ?? "",
    });
    setUploadCfdiUse(customer.fiscalCfdiUse ?? "");
  }, [customer, reset]);

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["customer", customer.id] }),
      qc.invalidateQueries({ queryKey: ["customers"] }),
    ]);
  };

  const save = useMutation({
    mutationFn: async (v: FormValues) => {
      const payload: Record<string, unknown> = { expectedVersion: customer.version };
      if (v.taxId) payload.taxId = v.taxId;
      if (v.legalName) payload.legalName = v.legalName;
      if (v.fiscalPostalCode) payload.fiscalPostalCode = v.fiscalPostalCode;
      if (v.fiscalRegimenFiscal) payload.fiscalRegimenFiscal = v.fiscalRegimenFiscal;
      if (v.fiscalCfdiUse) payload.fiscalCfdiUse = v.fiscalCfdiUse;
      await api.patch(`/customers/${customer.id}`, payload);
    },
    onSuccess: async () => {
      toast.success("Datos fiscales guardados");
      setEditing(false);
      await invalidate();
    },
    onError: (e) => {
      const status = (e as { response?: { status?: number } })?.response?.status;
      toast.error(
        status === 409
          ? "Alguien más guardó este cliente. Recarga la ficha para reintentar."
          : apiErrorMessage(e, "No se pudieron guardar los datos fiscales"),
      );
    },
  });

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Elige el PDF de la constancia");
      const form = new FormData();
      form.append("file", file);
      if (uploadCfdiUse) form.append("cfdiUse", uploadCfdiUse);
      const res = await api.post<{ data: ConstanciaResult }>(
        `/customers/${customer.id}/fiscal/constancia`,
        form,
        { headers: { "content-type": "multipart/form-data" } },
      );
      return res.data.data;
    },
    onSuccess: async (data) => {
      setWarnings(data.warnings);
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      const got = [data.parsed.rfc, data.parsed.legalName, data.parsed.postalCode, data.parsed.regimenFiscal].filter(Boolean).length;
      toast.success(got > 0 ? `Constancia leída: ${got} de 4 datos` : "Constancia guardada");
      await invalidate();
    },
    onError: (e) =>
      toast.error(e instanceof Error && e.message ? e.message : apiErrorMessage(e, "No se pudo subir la constancia")),
  });

  return (
    <div className="space-y-6">
      <Section
        title="Datos fiscales"
        description="Lo que se precarga al pedir factura. Cada pedido guarda su propia copia."
        headerIcon={<FileText className="h-4 w-4" />}
        actions={
          canWrite && !editing ? (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil aria-hidden className="h-3.5 w-3.5" />
              Editar
            </Button>
          ) : undefined
        }
      >
        {!editing ? (
          <div className="space-y-4">
            <div>
              {complete ? (
                <Badge variant="success">Datos completos para facturar</Badge>
              ) : (
                <Badge variant="warning">Faltan datos para facturar</Badge>
              )}
            </div>
            <DescriptionList divided>
              <FieldRow label="RFC" mono>
                {customer.taxId}
              </FieldRow>
              <FieldRow label="Razón social">{customer.legalName}</FieldRow>
              <FieldRow label="Código postal fiscal" mono>
                {customer.fiscalPostalCode}
              </FieldRow>
              <FieldRow label="Régimen fiscal">{regimenLabel(customer.fiscalRegimenFiscal)}</FieldRow>
              <FieldRow label="Uso de CFDI habitual">{cfdiUseLabel(customer.fiscalCfdiUse)}</FieldRow>
              <FieldRow label="Constancia">
                {customer.fiscalConstanciaUrl ? (
                  <Button variant="link" size="sm" className="h-auto p-0" asChild>
                    <a href={customer.fiscalConstanciaUrl} target="_blank" rel="noreferrer">
                      Ver PDF
                    </a>
                  </Button>
                ) : null}
              </FieldRow>
            </DescriptionList>
          </div>
        ) : (
          <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <LabelWithHelp htmlFor="fiscal-taxId" text="RFC" help={FIELD_HELP.rfc} />
                <Input
                  id="fiscal-taxId"
                  className="font-mono uppercase"
                  placeholder="XAXX010101000"
                  maxLength={13}
                  aria-invalid={!!errors.taxId}
                  aria-describedby={errors.taxId ? "fiscal-taxId-error" : undefined}
                  {...register("taxId")}
                />
                {errors.taxId ? (
                  <p id="fiscal-taxId-error" className="text-xs text-destructive">
                    {errors.taxId.message}
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <LabelWithHelp htmlFor="fiscal-legalName" text="Razón social" help={FIELD_HELP.legalName} />
                <Input
                  id="fiscal-legalName"
                  placeholder="Como aparece en la constancia"
                  aria-invalid={!!errors.legalName}
                  {...register("legalName")}
                />
                {errors.legalName ? <p className="text-xs text-destructive">{errors.legalName.message}</p> : null}
              </div>
              <div className="space-y-1.5">
                <LabelWithHelp htmlFor="fiscal-cp" text="Código postal fiscal" help={FIELD_HELP.fiscalPostalCode} />
                <Input
                  id="fiscal-cp"
                  inputMode="numeric"
                  maxLength={5}
                  placeholder="06600"
                  aria-invalid={!!errors.fiscalPostalCode}
                  aria-describedby={errors.fiscalPostalCode ? "fiscal-cp-error" : undefined}
                  {...register("fiscalPostalCode")}
                />
                {errors.fiscalPostalCode ? (
                  <p id="fiscal-cp-error" className="text-xs text-destructive">
                    {errors.fiscalPostalCode.message}
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <LabelWithHelp htmlFor="fiscal-regimen" text="Régimen fiscal" help={FIELD_HELP.regimen} />
                <Select id="fiscal-regimen" {...register("fiscalRegimenFiscal")}>
                  <option value="">Sin definir</option>
                  {REGIMENES_FISCALES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <LabelWithHelp htmlFor="fiscal-cfdi" text="Uso de CFDI habitual" help={FIELD_HELP.cfdiUse} />
                <Select id="fiscal-cfdi" {...register("fiscalCfdiUse")}>
                  <option value="">Sin definir</option>
                  {CFDI_USES.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={save.isPending}>
                Cancelar
              </Button>
              <Button type="submit" size="sm" loading={save.isPending}>
                <Save aria-hidden className="h-3.5 w-3.5" />
                Guardar datos fiscales
              </Button>
            </div>
          </form>
        )}
      </Section>

      {canWrite ? (
        <Section
          title="Subir constancia de situación fiscal"
          description="PDF del SAT (máx. 8 MB). Se leen RFC, razón social, código postal y régimen; el uso de CFDI lo eliges tú."
          headerIcon={<FileUp className="h-4 w-4" />}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              upload.mutate();
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="constancia-file">Archivo PDF</Label>
                <Input
                  id="constancia-file"
                  ref={fileRef}
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-sm file:font-medium"
                />
              </div>
              <div className="space-y-1.5">
                <LabelWithHelp htmlFor="constancia-cfdi" text="Uso de CFDI (opcional)" help={FIELD_HELP.cfdiUse} />
                <Select id="constancia-cfdi" value={uploadCfdiUse} onChange={(e) => setUploadCfdiUse(e.target.value)}>
                  <option value="">Conservar el actual</option>
                  {CFDI_USES.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            {warnings.length > 0 ? (
              <Alert variant="warning">
                <AlertTitle>La constancia se guardó, pero no todo se pudo leer</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4">
                    {warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                  <p className="mt-1">Completa lo que falte con «Editar».</p>
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="flex justify-end">
              <Button type="submit" size="sm" loading={upload.isPending} disabled={!file}>
                <FileUp aria-hidden className="h-3.5 w-3.5" />
                Subir y leer constancia
              </Button>
            </div>
          </form>
        </Section>
      ) : null}
    </div>
  );
}
