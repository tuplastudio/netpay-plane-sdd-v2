"use client";

import { InfoTip } from "@/components/app/info-tip";

/**
 * Ícono de ayuda junto a una etiqueta de campo no obvio (RFC, régimen
 * fiscal, uso de CFDI). Alias de `InfoTip` (primitiva compartida en
 * `components/app/info-tip.tsx`); se conserva el nombre para no tocar callers.
 */
export function FieldHelp({ text }: { text: string }) {
  return <InfoTip text={text} />;
}

export const FIELD_HELP = {
  rfc:
    "Registro Federal de Contribuyentes: la clave fiscal del SAT. 12 caracteres para empresas (persona moral) y 13 para personas físicas. Solo hace falta si vas a facturarle.",
  legalName:
    "Nombre o razón social tal como aparece en la constancia de situación fiscal. Debe coincidir exactamente para que el CFDI sea válido.",
  fiscalPostalCode:
    "Código postal del domicilio fiscal (5 dígitos), el de la constancia. No es necesariamente el de entrega.",
  regimen:
    "Régimen fiscal del SAT (clave de 3 dígitos, ej. 626 RESICO). Viene impreso en la constancia; subirla lo llena solo.",
  cfdiUse:
    "Uso que el cliente le dará a la factura (catálogo c_UsoCFDI). No viene en la constancia: lo elige el cliente. G03 «Gastos en general» es el más común.",
  tags:
    "Etiquetas libres para segmentar (vip, mayoreo, moroso…). Se guardan en minúsculas y sirven para filtrar el listado.",
} as const;
