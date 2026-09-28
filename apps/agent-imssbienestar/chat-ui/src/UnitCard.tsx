import { useState } from "react";
import { abiertaAhora, frase, mapsUrl, titulo, type Unidad } from "./agent";


export function UnitCard({ unidad, km }: { unidad: Unidad; km: string | null }) {
  const [copied, setCopied] = useState(false);
  const abierta = abiertaAhora(unidad);
  const direccion = unidad.domicilio ? titulo(unidad.domicilio) + (unidad.codigoPostal ? `, CP ${unidad.codigoPostal}` : "") : null;

  return (
    <div className="unit-card">
      <div className="unit-head">
        <strong>{titulo(unidad.nombre)}</strong>
        <span className={`badge ${abierta === null ? "na" : abierta ? "open" : "closed"}`}>
          {abierta === null ? "Horario no disponible" : abierta ? "Abierta ahora" : "Cerrada ahora"}
        </span>
      </div>
      <div className="unit-sub">
        {[unidad.municipio && titulo(unidad.municipio), km && `~${km} km en línea recta`].filter(Boolean).join(" · ")}
      </div>
      <dl>
        <dt>📍</dt>
        <dd>{direccion ?? "Domicilio no disponible en el catálogo"}</dd>
        <dt>🕒</dt>
        <dd>{unidad.horarioTexto ? frase(unidad.horarioTexto) : "Sin horario en el catálogo"}</dd>
      </dl>
      <div className="tags">
        {unidad.servicios.map((s) => (
          <span key={s} className={s.includes("Battelle") ? "tag battelle" : "tag"}>
            {s}
          </span>
        ))}
      </div>
      {unidad.notas && <div className="unit-note">ℹ️ {unidad.notas}</div>}
      <div className="unit-actions">
        <a href={mapsUrl(unidad)} target="_blank" rel="noreferrer">
          Abrir en Maps
        </a>
        {direccion && (
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(direccion).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? "Copiado ✓" : "Copiar dirección"}
          </button>
        )}
      </div>
    </div>
  );
}
