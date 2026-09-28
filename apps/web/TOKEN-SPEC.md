# Especificación de tokens — rediseño de color (referencia: apps/web/DESIGN.md, estilo Mintlify)

Objetivo: paleta con acento **menta** (#00d4a4) y neutros con leve tinte frío, ambos modos WCAG 2.2 AA
(texto ≥4.5:1, UI/foco/borde de control ≥3:1). Mobile first: 16px cuerpo, interlínea 1.5, tacto 44px.
Los nombres de token Tailwind existentes (`background`, `card`, `primary`, `cta`, `muted-foreground`, …)
SE CONSERVAN para no tocar 600+ usos. Cambian los VALORES y se agregan pocos tokens nuevos.

## Fuentes
- Inter (cuerpo, UI) — ya está (`--font-inter`). Quitar `font-display` Geist 500 como fuente distinta:
  DESIGN.md usa Inter 600 para titulares. `font-display` pasa a apuntar a Inter (alias) para no romper usos.
- **Geist Mono** (`--font-mono`, `font-mono`): código, ids, SKUs, firmas. Agregar con `next/font/google` (`Geist_Mono`).
- Sin itálicas. Énfasis = peso 500/600.

## Tipografía (cuerpo)
- `body { font-size: 16px; line-height: 1.5; letter-spacing: 0 }` (antes 15/1.3/-0.01em).
- Display: pesos 600, tracking negativo suave (-0.02em … -0.03em), NO -0.05em ni interlínea <1.05.
  - display-xxl 44→72px/1.05 · display-xl 36→56px/1.10 · display-lg 32→48px/1.10 · display-md 26→36px/1.20
  - headline 22px/1.30/600 · subhead 18px/1.5/400 · body-lg 18/1.5 · body 16/1.5 · body-sm 14/1.5/400
  - body-sm-medium 14/1.5/500 · caption 13/1.4 · micro 12/1.4/500 · micro-uppercase 11/1.4/600/+0.5px
  - code-md 14/1.5 mono · code-sm 13/1.4 mono
- Móvil (<480): display-xxl 36px, display-xl 32px, etc. Tocar `clamp()`.

## Paleta — MODO CLARO (`.light`)
| Rol | Hex | Token(s) |
|---|---|---|
| canvas | #ffffff | `--background`, `--canvas`, `--popover` |
| surface (surface-1) | #f4f6f5 | `--card`, `--muted` (muted = #f7f8f8 más suave) |
| surface-2 | #e9ecea | `--secondary`, `--accent` (hover) = #e2e6e4 |
| hairline | #e2e6e4 | `--border` |
| hairline-soft | #edf0ee | `--border-soft` |
| hairline-strong | #b9c0bd | `--border-strong` |
| borde de control | #7a827f (3.9:1 canvas · 3.3:1 surface-2) | `--input` |
| ink | #0f1211 | `--foreground`, `--card-foreground`, `--primary-strong`, `--cta` (píldora negra) |
| on-primary | #ffffff | `--primary-foreground`, `--cta-foreground` |
| charcoal (cuerpo) | #2a2f2d | `--body-text` |
| steel (secundario) | #5a625f (6.3 · 5.8 · 5.3) | `--muted-foreground` |
| stone (deshabilitado/decorativo, NO texto en surface-2) | #6f7774 | `--muted-soft` |
| **mint (acento relleno)** | #00d4a4 con tinta #0f1211 (9.8:1) | `--brand`, `--brand-foreground` = ink |
| **mint deep (texto/enlace/foco)** | #0a6b54 (6.5 · 6.0 · 5.4) | `--primary`, `--ring`, `--legal-link`, `--brand-text` |
| mint soft (fondo éxito) | #e3f8f1 | `--brand-soft`, `--success-subtle` |
| success | #0f7a4f texto/punto | `--success`, `--success-foreground` = #0b6641 |
| warning | #a4500a texto · fondo #fdf1e0 | `--warning`, `--warning-foreground` = #8a4308, `--warning-subtle` |
| error | #c62a36 (5.6 · 5.1 · 4.7) · fondo #fdeaec · texto #b0212c | `--destructive`, `--destructive-subtle`, `--destructive-subtle-foreground` |
| info / tag blue | #2b62b8 (5.9) · fondo #e8f0fc | `--info`, `--info-subtle`, `--info-foreground` = #23529c |
| neutral | #5a625f · fondo #eef1f0 · texto #3f4644 | `--neutral*` |
| highlight (insignias) | #ff6a3d con tinta ink (6.6:1). Nunca texto blanco encima | `--highlight`, `--highlight-foreground` = ink |
| hero sky | gradiente 180° #dbeeff → #fff6ea; texto ink | `--gradient-hero-sky` |
| hero dark | gradiente 135° #0a2b26 → #0d4a3f 50% → #0e6453; texto blanco, secundario `text-white/85` | `--gradient-hero-dark` |
| sombras | 1: 0 1px 2px rgb(0 0 0/.04) · 2: 0 4px 12px rgb(0 0 0/.08) · 3: 0 24px 48px -8px rgb(0 0 0/.12) · brand: 0 8px 24px rgb(0 212 164/.08) | `--shadow-1..3`, `--shadow-brand` (mantener alias `--shadow-airbnb*`) |
| selección/foco | `--shadow-selected`: 0 0 0 2px #0a6b54 | |

## Paleta — MODO OSCURO (`:root, .dark`) — derivada (DESIGN.md la deja como "Known Gap")
| Rol | Hex | Token(s) |
|---|---|---|
| canvas | #0b0e0d | `--background`, `--canvas` |
| surface-1 | #141817 | `--card` ; `--muted` = #101312 |
| surface-2 | #1c2120 | `--secondary`, `--popover` |
| hover | #242a28 | `--accent` |
| hairline | #282e2c | `--border` ; soft #1f2523 ; strong #3a423f |
| borde de control | #6e7875 (≥3:1 sobre surface-2) | `--input` |
| ink | #f7f9f8 | `--foreground` |
| body | #e2e6e4 | `--body-text` |
| steel | #a2aaa7 (8.2 · 7.5 · 6.9 · 6.2 hover) | `--muted-foreground` |
| stone | #8a928f | `--muted-soft` |
| píldora primaria | blanca #ffffff, tinta #0b0e0d (button-on-dark) | `--primary-strong`, `--cta` ; hover #e6e9e8 ; active #d3d8d6 |
| **mint acento** | #00d4a4 (10.1:1 canvas) tinta ink oscura | `--brand`, `--brand-foreground` = #0b0e0d |
| mint texto/enlace/foco | #2fe0b4 (11.5 · 10.6 · 9.7) | `--primary`, `--ring`, `--legal-link`, `--brand-text` |
| mint soft | #0f2a24 | `--brand-soft`, `--success-subtle` |
| success | #3dd68c texto · punto | `--success`, `--success-foreground` |
| warning | #f5b544 · fondo #2a2010 | `--warning*` |
| error | #ff6b6f (7.0 · 6.5 · 5.9) · fondo #2e1517 · texto #ff8a8d | `--destructive*` (relleno sólido `--destructive` con tinta #0b0e0d) |
| info/tag | #7fb0ff · fondo #12203a | `--info*` |
| neutral | #a2aaa7 · fondo #1c2120 · texto #cfd6d3 | `--neutral*` |
| highlight | #ff7a4d con tinta oscura | `--highlight*` |
| hero dark | mismo gradiente teal→menta | |
| sombras | 2: inset 0 .5px 0 rgb(255 255 255/.08), 0 10px 30px rgb(0 0 0/.35) · brand: 0 8px 24px rgb(0 212 164/.12) | |
| foco | 0 0 0 2px #2fe0b4 | `--shadow-selected` |

## Reglas de uso (DESIGN.md)
- Menta SOLO en: CTA de acento (`variant="accent"` = `bg-brand text-brand-foreground`), checks de lista,
  borde de tarjeta destacada, punto activo de nav, anillo de foco, enlaces (mint deep). NUNCA texto de cuerpo ni fondo grande.
- CTA dominante: píldora negra (claro) / blanca (oscuro) = tokens `cta`/`primary-strong` actuales. Todo botón `rounded-full`.
- Tarjetas `rounded-lg` 12px; inputs/código/search `rounded-md` 8px; chips `rounded-sm` 6 / `rounded-xs` 4; botones pill.
  Ajustar escala: `--radius` 8px, `--radius-card` 12px, `--radius-spotlight` 16px (xl) — mantener nombres.
- Elevación plana por defecto (borde hairline), sombras solo menú/diálogo/hero.
- Degradados: `.spotlight-*` (violeta/magenta/naranja/coral) desaparecen. Alias temporal: las 4 clases → `--gradient-hero-dark`.
  Usos actuales (login brand panel, cifra Panorama, total cotización pública) pasan a `.hero-dark` (o `.hero-sky` en claro para el login si conviene).
- Sin hex crudo en TSX: todo por token. Excepto `branding-section.tsx` (color de marca de tenant, entrada del usuario).

## Mobile first (obligatorio)
- Alturas: botones/inputs 44px base, `sm:` 40px. Ítems de nav ≥44px en drawer. Iconos circulares 44 móvil / 32 escritorio.
- Canal lateral 16px; sin scroll horizontal; tablas scroll interno.
- Tipografía escribe primero el valor móvil y luego `sm:`/`md:`/`lg:`.
- Verificar en 360×740, 390×844, 768, 1024, 1280.
