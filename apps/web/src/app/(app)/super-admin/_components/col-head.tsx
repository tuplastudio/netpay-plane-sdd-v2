"use client";

import { InfoTip } from "@/components/app/info-tip";

/**
 * Encabezado de columna con ícono de ayuda para métricas no obvias (turnos,
 * tokens, costo estimado). `DataTableColumn.header` acepta ReactNode, así que
 * se pasa tal cual: `header: <ColHead label="Turnos" tip={COL_TIPS.events} />`.
 */
export function ColHead({ label, tip }: { label: string; tip: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <InfoTip label={label} text={tip} />
    </span>
  );
}

/** Textos compartidos por las tablas de uso de la consola de plataforma. */
export const COL_TIPS = {
  events: "Turnos del agente: cada respuesta generada cuenta como uno, sin importar cuántos mensajes trajo la conversación.",
  inputTokens: "Tokens que el modelo leyó (instrucciones, catálogo y mensajes previos). Suelen ser la mayor parte del consumo.",
  outputTokens: "Tokens que el modelo escribió en sus respuestas. Se cobran más caros que los de entrada.",
  tokens: "Tokens de entrada más salida del periodo.",
  cost: "Estimado en USD según la tarifa pública de cada modelo; el cargo real puede variar ligeramente.",
  costMonth: "Gasto estimado del mes en curso (USD), calculado a partir de los tokens consumidos por el agente.",
  mfa: "Verificación en dos pasos con app autenticadora. Recomendada para toda cuenta con acceso a datos de clientes.",
  superAdmin: "Puede administrar todas las empresas de la plataforma e impersonar cualquiera de ellas.",
  tenantStatus: "Activa: opera con normalidad. Suspendida: sus usuarios no pueden entrar hasta reactivarla.",
} as const;
