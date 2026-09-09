"""Matching explicable de catálogo (T-AIA-03).

Pipeline determinista: SKU exacto → filtros duros → léxico/trigram → fusión →
top-3 explicable. En V2 el matching difuso **nunca autoselecciona**: si no hay
SKU exacto único, el agente pregunta (SPEC-AIA "Matching y decisión").

Los precios se muestran tal como vienen del catálogo del backend; el total
siempre lo calcula la calculadora oficial, no este módulo.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .text import (
    expand_synonyms,
    looks_like_sku,
    normalize,
    parse_quantity,
    tokenize,
    trigram_similarity,
)

# Umbral bajo: preferimos mostrar opciones a no mostrar nada.
MIN_SCORE = 0.18
# Diferencia mínima entre el 1.º y el 2.º para considerar la elección obvia.
DOMINANCE_GAP = 0.35


@dataclass
class CatalogVariant:
    """Variante tal como la expone el backend comercial."""

    id: str
    sku: str
    title: str
    description: str = ""
    price: str = "0.00"
    sat_product_code: str = ""
    sat_unit_code: str = "H87"
    stock: float | None = None
    status: str = "ACTIVE"
    product_title: str = ""
    attributes: dict[str, str] = field(default_factory=dict)

    @property
    def searchable(self) -> str:
        return " ".join(
            [self.sku, self.product_title, self.title, self.description, *self.attributes.values()]
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "sku": self.sku,
            "title": self.title,
            "productTitle": self.product_title,
            "description": self.description,
            "price": self.price,
            "satProductCode": self.sat_product_code,
            "satUnitCode": self.sat_unit_code,
            "stock": self.stock,
            "status": self.status,
            "attributes": self.attributes,
        }


@dataclass
class MatchResult:
    """Candidato con evidencia (SPEC-AIA: matchType, matchedFields, conflicts)."""

    variant_id: str
    score: float
    reasons: list[str]
    match_type: str = "lexical"
    matched_fields: list[str] = field(default_factory=list)
    conflicts: list[str] = field(default_factory=list)
    variant: CatalogVariant | None = None
    # Relevancia antes de penalizar por stock o estado: ordena la lista, de
    # modo que lo que el cliente pidió por nombre aparezca primero aunque esté
    # agotado, con su conflicto declarado.
    base_score: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "variantId": self.variant_id,
            "score": round(self.score, 4),
            "reasons": self.reasons,
            "matchType": self.match_type,
            "matchedFields": self.matched_fields,
            "conflicts": self.conflicts,
        }
        if self.variant:
            payload["variant"] = self.variant.to_dict()
        return payload


@dataclass
class MatchDecision:
    """Resultado del pipeline: candidatos + si se puede autoseleccionar."""

    candidates: list[MatchResult]
    auto_selected: MatchResult | None
    quantity: str | None
    unit: str | None
    needs_clarification: bool
    reason: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "candidates": [c.to_dict() for c in self.candidates],
            "autoSelected": self.auto_selected.to_dict() if self.auto_selected else None,
            "quantity": self.quantity,
            "unit": self.unit,
            "needsClarification": self.needs_clarification,
            "reason": self.reason,
        }


def match_products(
    query: str,
    catalog: list[CatalogVariant],
    *,
    top_k: int = 3,
) -> list[MatchResult]:
    """Devuelve candidatos ordenados con razones legibles para un humano."""
    q_norm = normalize(query)
    q_tokens = expand_synonyms(tokenize(query))
    sku_hint = looks_like_sku(query)
    if not q_norm:
        return []

    scored: list[MatchResult] = []
    for variant in catalog:
        reasons: list[str] = []
        matched_fields: list[str] = []
        conflicts: list[str] = []
        match_type = "lexical"
        score = 0.0

        sku_norm = normalize(variant.sku)
        title_norm = normalize(f"{variant.product_title} {variant.title}")
        variant_tokens = expand_synonyms(tokenize(variant.searchable))

        # 1) SKU exacto: la única vía a autoselección.
        q_words = set(q_norm.split())
        if sku_norm and (
            q_norm == sku_norm or sku_norm in q_words or (sku_hint and normalize(sku_hint) == sku_norm)
        ):
            score = 1.0
            match_type = "exact_sku"
            matched_fields.append("sku")
            reasons.append(f"SKU exacto {variant.sku}")
        else:
            shared = q_tokens & variant_tokens
            if shared:
                coverage = len(shared) / max(1, len(q_tokens))
                score = coverage * 0.72
                matched_fields.append("title" if q_tokens & expand_synonyms(tokenize(title_norm)) else "description")
                reasons.append(f"coincide en: {', '.join(sorted(shared)[:4])}")
            trigram = trigram_similarity(q_norm, title_norm)
            if trigram > 0.2:
                score = max(score, trigram * 0.65)
                if "title" not in matched_fields:
                    matched_fields.append("title")
                reasons.append(f"parecido de escritura {trigram:.2f}")
                match_type = "fuzzy" if not shared else "lexical"
            if q_norm and q_norm in title_norm:
                score = max(score, 0.86)
                reasons.append("el título contiene la búsqueda")
                if "title" not in matched_fields:
                    matched_fields.append("title")

        # 2) Filtros duros y conflictos: penalizan el orden, no ocultan el
        #    producto. El cliente merece saber que existe pero está agotado
        #    o descontinuado (SPEC-AIA: explicar, nunca sustituir en silencio).
        base_score = score
        relevant = score >= MIN_SCORE
        if variant.status == "ARCHIVED":
            score *= 0.15
            conflicts.append("descontinuado")
            reasons.append("ya no lo manejamos")
        elif variant.status != "ACTIVE":
            score *= 0.25
            conflicts.append(f"variante {variant.status.lower()}")
        if variant.stock is not None and variant.stock <= 0:
            score *= 0.4
            conflicts.append("sin existencia")
            reasons.append("sin stock disponible ahora")

        if relevant:
            scored.append(
                MatchResult(
                    variant_id=variant.id,
                    score=min(score, 1.0),
                    base_score=min(base_score, 1.0),
                    reasons=reasons,
                    match_type=match_type,
                    matched_fields=matched_fields,
                    conflicts=conflicts,
                    variant=variant,
                )
            )

    scored.sort(
        key=lambda r: (round(r.base_score, 3), r.score, r.variant.stock or 0 if r.variant else 0),
        reverse=True,
    )
    return scored[:top_k]


def decide(query: str, catalog: list[CatalogVariant], *, top_k: int = 3) -> MatchDecision:
    """Aplica la regla V2: solo SKU exacto único autoselecciona."""
    candidates = match_products(query, catalog, top_k=top_k)
    quantity, unit, _ = parse_quantity(query)

    if not candidates:
        return MatchDecision([], None, quantity, unit, False, "sin candidatos")

    exact = [c for c in candidates if c.match_type == "exact_sku"]
    if len(exact) == 1:
        blocked = exact[0].conflicts
        if blocked:
            return MatchDecision(
                candidates, None, quantity, unit, True,
                f"SKU exacto con conflicto: {', '.join(blocked)}",
            )
        return MatchDecision(candidates, exact[0], quantity, unit, False, "SKU exacto único")

    top = candidates[0]
    runner_up = candidates[1].score if len(candidates) > 1 else 0.0
    if top.score >= 0.86 and (top.score - runner_up) >= DOMINANCE_GAP and not top.conflicts:
        # Coincidencia determinista de título completo: aún así confirmamos
        # cantidad antes de cotizar, nunca el producto por confianza difusa.
        return MatchDecision(
            candidates, None, quantity, unit, True,
            "coincidencia fuerte, se confirma con el cliente",
        )

    return MatchDecision(
        candidates, None, quantity, unit, True,
        "varias opciones posibles; se pide elección",
    )
